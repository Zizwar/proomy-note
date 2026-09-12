/**
 * Vibe Note - Rate Limiter & Server Anti-Flood Protection Module
 * Protects against spamming, volumetric flooding, payload bloating, and DDoS attempts.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  error?: string;
}

interface RateRecord {
  timestamps: number[];
}

class InMemoryRateLimiter {
  private records = new Map<string, RateRecord>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs = 60_000) {
    // Periodically clean up idle records to keep memory footprint close to zero
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
    try {
      if (typeof (this.cleanupInterval as any)?.unref === "function") {
        (this.cleanupInterval as any).unref();
      } else if (typeof (Deno as any)?.unrefTimer === "function") {
        (Deno as any).unrefTimer(this.cleanupInterval);
      }
    } catch {
      // Ignore unref failures on platforms without unref
    }
  }

  public check(key: string, maxRequests: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    // Filter out timestamps outside current sliding window
    record.timestamps = record.timestamps.filter(ts => ts > windowStart);

    if (record.timestamps.length >= maxRequests) {
      const oldestInWindow = record.timestamps[0];
      const resetSeconds = Math.max(1, Math.ceil((oldestInWindow + windowMs - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetSeconds,
        error: `Rate limit reached. Please wait ${resetSeconds}s before retrying.`,
      };
    }

    // Record this request
    record.timestamps.push(now);
    const remaining = maxRequests - record.timestamps.length;
    const resetSeconds = Math.ceil(windowMs / 1000);

    return {
      allowed: true,
      remaining,
      resetSeconds,
    };
  }

  private cleanup() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    for (const [key, record] of this.records.entries()) {
      record.timestamps = record.timestamps.filter(ts => now - ts < maxAge);
      if (record.timestamps.length === 0) {
        this.records.delete(key);
      }
    }
  }
}

// Global Limiter Instances
const promptSubmissionLimiter = new InMemoryRateLimiter(); // Max 5 submissions per 10 mins
const apiGeneralLimiter = new InMemoryRateLimiter();        // Max 150 API calls per minute
const statsLimiter = new InMemoryRateLimiter();             // Max 30 stat increments per minute

/**
 * Extract client IP from reverse proxy headers or socket
 */
export function getClientIp(req: Request): string {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",");
    if (ips.length > 0 && ips[0].trim()) {
      return ips[0].trim();
    }
  }

  return "anon-client";
}

/**
 * Check prompt submission rate limit (Anti-Flood for prompt creation)
 * Allows max 5 submissions per 10 minutes per IP
 */
export function checkPromptSubmissionLimit(ip: string): RateLimitResult {
  const maxSubmissions = 5;
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const result = promptSubmissionLimiter.check(`submit:${ip}`, maxSubmissions, windowMs);
  if (!result.allowed) {
    result.error = `Anti-flood protection: too many prompt submissions from your IP. Please wait ${result.resetSeconds} seconds before submitting again.`;
  }
  return result;
}

/**
 * Check general API rate limit
 * Allows max 150 requests per minute per IP
 */
export function checkApiRateLimit(ip: string): RateLimitResult {
  const maxRequests = 150;
  const windowMs = 60 * 1000; // 1 minute
  return apiGeneralLimiter.check(`api:${ip}`, maxRequests, windowMs);
}

/**
 * Check stats tracking rate limit (prevents views/copies counter abuse)
 * Allows max 30 increments per minute per IP
 */
export function checkStatsRateLimit(ip: string): RateLimitResult {
  const maxIncrements = 30;
  const windowMs = 60 * 1000; // 1 minute
  return statsLimiter.check(`stats:${ip}`, maxIncrements, windowMs);
}

export interface ValidatedPromptPayload {
  title: string;
  kind: string;
  content: string;
  description: string;
  category: string;
  platform: string;
  tags: string[];
}

/**
 * Strict payload validation to avoid huge strings, empty titles, or DB flooding
 */
export function validatePromptPayload(body: any): { valid: boolean; error?: string; data?: ValidatedPromptPayload } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid JSON body provided." };
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim().toLowerCase() : "other";
  const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "other";
  const kind = typeof body.kind === "string" ? body.kind.trim().toLowerCase() : "prompt";

  if (!title || title.length < 3) {
    return { valid: false, error: "Title is required and must be at least 3 characters." };
  }
  if (title.length > 160) {
    return { valid: false, error: "Title exceeds maximum length of 160 characters." };
  }

  if (!content || content.length < 10) {
    return { valid: false, error: "Prompt content is required and must be at least 10 characters." };
  }
  if (content.length > 12_000) {
    return { valid: false, error: "Prompt content exceeds maximum allowed length of 12,000 characters." };
  }

  if (description.length > 600) {
    return { valid: false, error: "Description exceeds maximum length of 600 characters." };
  }

  let tags: string[] = [];
  if (Array.isArray(body.tags)) {
    tags = body.tags
      .filter((t: any) => typeof t === "string")
      .map((t: string) => t.trim().toLowerCase().slice(0, 40))
      .filter((t: string) => t.length > 0)
      .slice(0, 15);
  }

  return {
    valid: true,
    data: {
      title,
      kind: kind || "prompt",
      content,
      description,
      category: category.slice(0, 40),
      platform: platform.slice(0, 40),
      tags,
    }
  };
}
