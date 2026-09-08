import {
  initDatabase,
  getPublicPrompts,
  getPromptByShortId,
  savePrompt,
  incrementStats,
  seedDatabase,
  getAdminPendingPrompts,
  getAdminAllPrompts,
  updatePromptStatus,
  deletePrompt,
  getAllApprovedPromptMetas,
  getLatestApprovedPrompts,
  PromptDoc,
  PromptMeta
} from "./db.ts";
import { renderHomePage, renderPromptDetailPage, render404Page } from "./views/renderHtml.ts";
import { renderAdminLoginPage, renderAdminDashboardPage } from "./views/renderAdmin.ts";
import { checkAdminPassword, createAdminSession, clearAdminSession, isAdminAuthenticated } from "./adminAuth.ts";
import { extractVariables } from "./variableParser.ts";
import {
  generateRobotsTxt,
  generateUnifiedSitemapXml,
  generateMainSitemapXml,
  generatePromptsSitemapXml,
  generateSitemapIndexXml,
  generateRssFeedXml
} from "./seo.ts";

// Initialize database
await initDatabase();

const PORT = Number(Deno.env.get("PORT") || 3333);

// In-memory cache for SEO assets (reduces DB hits to near zero)
let cachedUnifiedSitemap: { xml: string; timestamp: number } | null = null;
let cachedMainSitemap: { xml: string; timestamp: number } | null = null;
let cachedRssFeed: { xml: string; timestamp: number } | null = null;
const SITEMAP_CACHE_TTL = 3600 * 1000; // 1 hour
const RSS_CACHE_TTL = 900 * 1000;       // 15 minutes

Deno.serve({ port: PORT }, async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Base URL for links & canonical tags
  const forwardedHost = req.headers.get("x-forwarded-host");
  const hostHeader = forwardedHost || req.headers.get("host") || "vibenote.sbs";
  const scheme = req.headers.get("x-forwarded-proto") || (hostHeader.includes("localhost") ? "http" : "https");
  const baseUrl = `${scheme}://${hostHeader.replace(/:3333$/, '')}`;

  // CORS Headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const isGetOrHead = method === "GET" || method === "HEAD";

  try {
    // -------------------------------------------------------------
    // Route: robots.txt (Essential for Search Engine Crawlers)
    // -------------------------------------------------------------
    if (path === "/robots.txt" && isGetOrHead) {
      const robotsTxt = generateRobotsTxt(baseUrl);
      return new Response(method === "HEAD" ? null : robotsTxt, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
          ...corsHeaders,
        },
      });
    }

    // -------------------------------------------------------------
    // Route: sitemap.xml & sitemap-index.xml (SEO Sitemap Index)
    // -------------------------------------------------------------
    if ((path === "/sitemap.xml" || path === "/sitemap-index.xml") && isGetOrHead) {
      const promptMetas = await getAllApprovedPromptMetas();
      const indexXml = generateSitemapIndexXml(baseUrl, promptMetas.length, 5000);
      return new Response(method === "HEAD" ? null : indexXml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders,
        },
      });
    }

    if ((path === "/sitemap-all.xml" || path === "/sitemap-unified.xml") && isGetOrHead) {
      const now = Date.now();
      let sitemapXml = "";
      if (cachedUnifiedSitemap && now - cachedUnifiedSitemap.timestamp < SITEMAP_CACHE_TTL) {
        sitemapXml = cachedUnifiedSitemap.xml;
      } else {
        const promptMetas = await getAllApprovedPromptMetas();
        sitemapXml = generateUnifiedSitemapXml(promptMetas, baseUrl);
        cachedUnifiedSitemap = { xml: sitemapXml, timestamp: now };
      }

      return new Response(method === "HEAD" ? null : sitemapXml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
          ...corsHeaders,
        },
      });
    }

    if (path === "/sitemap-main.xml" && isGetOrHead) {
      const now = Date.now();
      let mainXml = "";
      if (cachedMainSitemap && now - cachedMainSitemap.timestamp < SITEMAP_CACHE_TTL) {
        mainXml = cachedMainSitemap.xml;
      } else {
        mainXml = generateMainSitemapXml(baseUrl);
        cachedMainSitemap = { xml: mainXml, timestamp: now };
      }

      return new Response(method === "HEAD" ? null : mainXml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders,
        },
      });
    }

    if ((path === "/sitemap-prompts.xml" || path.startsWith("/sitemap-prompts-")) && isGetOrHead) {
      const pageMatch = path.match(/\/sitemap-prompts-(\d+)\.xml/);
      const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 1;
      const chunkSize = 5000;
      const promptMetas = await getAllApprovedPromptMetas();
      const startIndex = (pageNum - 1) * chunkSize;
      const chunk = promptMetas.slice(startIndex, startIndex + chunkSize);

      const xml = generatePromptsSitemapXml(chunk, baseUrl);
      return new Response(method === "HEAD" ? null : xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders,
        },
      });
    }

    // -------------------------------------------------------------
    // Route: RSS / Atom Feed (/feed.xml, /rss.xml)
    // -------------------------------------------------------------
    if ((path === "/feed.xml" || path === "/rss.xml" || path === "/feed") && isGetOrHead) {
      const now = Date.now();
      let rssXml = "";
      if (cachedRssFeed && now - cachedRssFeed.timestamp < RSS_CACHE_TTL) {
        rssXml = cachedRssFeed.xml;
      } else {
        const latestPrompts = await getLatestApprovedPrompts(50);
        rssXml = generateRssFeedXml(latestPrompts, baseUrl);
        cachedRssFeed = { xml: rssXml, timestamp: now };
      }

      return new Response(method === "HEAD" ? null : rssXml, {
        headers: {
          "Content-Type": "application/rss+xml; charset=utf-8",
          "Cache-Control": "public, max-age=900",
          ...corsHeaders,
        },
      });
    }

    // -------------------------------------------------------------
    // Route: Favicon
    // -------------------------------------------------------------
    if (path === "/favicon.ico" && isGetOrHead) {
      const svgFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#8B5CF6"/><text x="50" y="68" font-size="50" text-anchor="middle" fill="#fff" font-family="sans-serif">⚡</text></svg>`;
      return new Response(method === "HEAD" ? null : svgFavicon, {
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", ...corsHeaders },
      });
    }

    // -------------------------------------------------------------
    // Route 1: Home Page (Web Showcase with Tag & Category Filtering)
    // -------------------------------------------------------------
    if (path === "/" && isGetOrHead) {
      const category = url.searchParams.get("category") || "all";
      const search = url.searchParams.get("search") || "";
      const tag = url.searchParams.get("tag") || "";
      const sort = url.searchParams.get("sort") || "random";
      const page = Number(url.searchParams.get("page")) || 1;
      const rawLimit = Number(url.searchParams.get("limit")) || 24;
      const limit = Math.min(Math.max(rawLimit, 1), 50);

      const paginatedData = await getPublicPrompts({ category, search, tag, sort, page, limit });
      const html = renderHomePage(paginatedData, category, search, tag, baseUrl);
      return new Response(method === "HEAD" ? null : html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=60, s-maxage=120",
          ...corsHeaders
        },
      });
    }

    // -------------------------------------------------------------
    // Route 2: Admin Authentication & Dashboard
    // -------------------------------------------------------------
    if (path === "/admin/login" && method === "GET") {
      if (isAdminAuthenticated(req)) {
        return Response.redirect(`${baseUrl}/admin`, 302);
      }
      const html = renderAdminLoginPage();
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders } });
    }

    if (path === "/admin/login" && method === "POST") {
      const formData = await req.formData().catch(() => null);
      const password = formData?.get("password")?.toString() || "";

      if (checkAdminPassword(password)) {
        const { cookieHeader } = createAdminSession();
        return new Response(null, {
          status: 302,
          headers: {
            "Location": "/admin",
            "Set-Cookie": cookieHeader,
            ...corsHeaders,
          },
        });
      }

      const html = renderAdminLoginPage("Invalid password. Please try again.");
      return new Response(html, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders } });
    }

    if (path === "/admin/logout" && method === "GET") {
      const clearCookie = clearAdminSession(req);
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/admin/login",
          "Set-Cookie": clearCookie,
          ...corsHeaders,
        },
      });
    }

    if (path === "/admin" && method === "GET") {
      if (!isAdminAuthenticated(req)) {
        return Response.redirect(`${baseUrl}/admin/login`, 302);
      }

      const currentTab = url.searchParams.get("tab") || "pending";
      const searchQuery = url.searchParams.get("search") || "";
      const statusFilter = url.searchParams.get("status") || "all";
      const categoryFilter = url.searchParams.get("category") || "all";
      const page = Number(url.searchParams.get("page")) || 1;

      const pendingPrompts = await getAdminPendingPrompts();
      const allPrompts = await getAdminAllPrompts({ status: statusFilter, category: categoryFilter, search: searchQuery, page, limit: 20 });

      const html = renderAdminDashboardPage({
        pendingPrompts,
        allPrompts,
        currentTab,
        searchQuery,
        statusFilter,
        categoryFilter,
        page,
      });

      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders } });
    }

    // Admin Action APIs
    if (path.startsWith("/api/admin/approve/") && method === "POST") {
      if (!isAdminAuthenticated(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const shortId = path.split("/")[4];
      const success = await updatePromptStatus(shortId, "approved");
      // Invalidate sitemap cache
      cachedUnifiedSitemap = null;
      cachedRssFeed = null;
      return new Response(JSON.stringify({ success }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (path.startsWith("/api/admin/unpublish/") && method === "POST") {
      if (!isAdminAuthenticated(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const shortId = path.split("/")[4];
      const success = await updatePromptStatus(shortId, "pending");
      cachedUnifiedSitemap = null;
      return new Response(JSON.stringify({ success }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (path.startsWith("/api/admin/delete/") && method === "DELETE") {
      if (!isAdminAuthenticated(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const shortId = path.split("/")[4];
      const success = await deletePrompt(shortId);
      cachedUnifiedSitemap = null;
      return new Response(JSON.stringify({ success }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (path === "/api/admin/create" && method === "POST") {
      if (!isAdminAuthenticated(req)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      const body = await req.json();
      const content = body.content || "";
      const variables = (Array.isArray(body.variables) && body.variables.length > 0) ? body.variables : extractVariables(content);

      const saved = await savePrompt({
        title: body.title || "Untitled Admin Prompt",
        kind: body.kind || "prompt",
        content: content,
        description: body.description || "",
        category: body.category || "other",
        platform: body.platform || "chatgpt",
        tags: Array.isArray(body.tags) ? body.tags : [],
        variables: variables,
        status: "approved",
        isPublic: true,
      });

      cachedUnifiedSitemap = null;
      cachedRssFeed = null;

      return new Response(JSON.stringify({ success: true, prompt: saved }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // -------------------------------------------------------------
    // Route 3: Single Prompt Page /p/:shortId or /:shortId with format handlers
    // -------------------------------------------------------------
    const isSinglePromptRoute = (path.startsWith("/p/") && isGetOrHead) || (/^\/[a-zA-Z0-9_-]{4,15}$/.test(path) && isGetOrHead && !path.startsWith("/api") && !path.startsWith("/admin") && path !== "/robots.txt" && path !== "/favicon.ico" && path !== "/feed.xml" && path !== "/rss.xml" && !path.startsWith("/sitemap"));
    if (isSinglePromptRoute) {
      const shortId = path.startsWith("/p/") ? path.split("/")[2] : path.slice(1);
      const prompt = await getPromptByShortId(shortId);
      if (!prompt) {
        const acceptHeader = (req.headers.get("accept") || "").toLowerCase();
        if (acceptHeader.includes("text/html")) {
          const notFoundHtml = render404Page(baseUrl);
          return new Response(method === "HEAD" ? null : notFoundHtml, {
            status: 404,
            headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
          });
        }
        return new Response("Prompt not found", { status: 404, headers: corsHeaders });
      }

      const formatType = (url.searchParams.get("type") || url.searchParams.get("format") || "").toLowerCase();
      const acceptHeader = (req.headers.get("accept") || "").toLowerCase();
      const isBrowserNav = acceptHeader.includes("text/html") && !formatType;

      if (!isBrowserNav) {
        // Format 1: Raw JSON
        if (formatType === "json" || acceptHeader.includes("application/json")) {
          return new Response(method === "HEAD" ? null : JSON.stringify(prompt, null, 2), {
            headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
          });
        }

        // Format 2: Raw Markdown
        if (formatType === "md" || formatType === "markdown" || acceptHeader.includes("text/markdown")) {
          const mdContent = `# ${prompt.title}

> **Category**: ${prompt.category} | **Platform**: ${prompt.platform} | **Short ID**: ${prompt.shortId}
> **Tags**: ${prompt.tags.join(', ')}

## Description
${prompt.description || 'No description provided.'}

## System Prompt Template
\`\`\`
${prompt.content}
\`\`\`
`;
          return new Response(method === "HEAD" ? null : mdContent, {
            headers: { "Content-Type": "text/markdown; charset=utf-8", ...corsHeaders },
          });
        }

        // Format 3: Dynamic SVG Card
        if (formatType === "svg" || acceptHeader.includes("image/svg+xml")) {
          const svgContent = generatePromptSvg(prompt);
          return new Response(method === "HEAD" ? null : svgContent, {
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Cache-Control": "public, max-age=86400",
              ...corsHeaders,
            },
          });
        }

        // Format 4: Raw XML
        if (formatType === "xml" || (acceptHeader.includes("application/xml") && !acceptHeader.includes("text/html"))) {
          const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<vibenote_prompt id="${escapeXml(prompt.shortId)}">
  <title>${escapeXml(prompt.title)}</title>
  <category>${escapeXml(prompt.category)}</category>
  <platform>${escapeXml(prompt.platform)}</platform>
  <description>${escapeXml(prompt.description || '')}</description>
  <content><![CDATA[${prompt.content}]]></content>
  <tags>
    ${prompt.tags.map(t => `<tag>${escapeXml(t)}</tag>`).join('\n    ')}
  </tags>
  <variables>
    ${(prompt.variables || []).map(v => `<variable name="${escapeXml(v.name)}" type="${escapeXml(v.type)}"${v.defaultValue ? ` default="${escapeXml(v.defaultValue)}"` : ''}/>`).join('\n    ')}
  </variables>
  <created_at>${prompt.createdAt}</created_at>
</vibenote_prompt>`;

          return new Response(method === "HEAD" ? null : xmlContent, {
            headers: { "Content-Type": "application/xml; charset=utf-8", ...corsHeaders },
          });
        }
      }

      // Default: HTML Web Page
      const html = renderPromptDetailPage(prompt, baseUrl);
      return new Response(method === "HEAD" ? null : html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=600",
          ...corsHeaders,
        },
      });
    }

    // -------------------------------------------------------------
    // Route 4: API Create / Share Prompt
    // -------------------------------------------------------------
    if (path === "/api/prompts" && method === "POST") {
      const body = await req.json();
      const content = body.content || "";

      // Auto-extract variables if not provided
      const variables = (Array.isArray(body.variables) && body.variables.length > 0)
        ? body.variables
        : extractVariables(content);

      // Public submissions get status: 'pending' (requires admin review)
      const saved = await savePrompt({
        title: body.title || "Untitled Prompt",
        kind: body.kind || "prompt",
        content: content,
        description: body.description || "",
        category: body.category || "other",
        platform: body.platform || "chatgpt",
        tags: Array.isArray(body.tags) ? body.tags : [],
        variables: variables,
        status: "pending",
        isPublic: false,
      });

      const shortUrl = `${baseUrl}/p/${saved.shortId}`;

      return new Response(
        JSON.stringify({
          success: true,
          shortId: saved.shortId,
          shortUrl: shortUrl,
          message: "Prompt submitted for admin review!",
          prompt: saved,
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // -------------------------------------------------------------
    // Route 5: API List Public Prompts
    // -------------------------------------------------------------
    if (path === "/api/prompts" && isGetOrHead) {
      const category = url.searchParams.get("category") || "all";
      const search = url.searchParams.get("search") || "";
      const tag = url.searchParams.get("tag") || "";
      const sort = url.searchParams.get("sort") || "random";
      const page = Number(url.searchParams.get("page")) || 1;
      const rawLimit = Number(url.searchParams.get("limit")) || 24;
      const limit = Math.min(Math.max(rawLimit, 1), 50);

      const result = await getPublicPrompts({ category, search, tag, sort, page, limit });
      return new Response(method === "HEAD" ? null : JSON.stringify(result), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // -------------------------------------------------------------
    // Route 6: API Get Single Prompt JSON
    // -------------------------------------------------------------
    if (path.match(/^\/api\/prompts\/[a-zA-Z0-9_-]+$/) && isGetOrHead) {
      const shortId = path.split("/")[3];
      const prompt = await getPromptByShortId(shortId);
      if (!prompt) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      return new Response(method === "HEAD" ? null : JSON.stringify(prompt), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // -------------------------------------------------------------
    // Route 7: Incremental Stats
    // -------------------------------------------------------------
    if (path.match(/^\/api\/prompts\/[a-zA-Z0-9_-]+\/stats$/) && method === "POST") {
      const shortId = path.split("/")[3];
      const body = await req.json().catch(() => ({}));
      const type = body.type === "copy" ? "copy" : "view";
      await incrementStats(shortId, type);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // -------------------------------------------------------------
    // Route 8: Database Seeding Route (/api/seed)
    // -------------------------------------------------------------
    if (path === "/api/seed" && isGetOrHead) {
      const force = url.searchParams.get("force") === "true";
      const result = await seedDatabase(force);
      cachedUnifiedSitemap = null;
      return new Response(method === "HEAD" ? null : JSON.stringify({ success: true, ...result }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // -------------------------------------------------------------
    // 404 Not Found Handling
    // -------------------------------------------------------------
    const acceptHeader = (req.headers.get("accept") || "").toLowerCase();
    if (acceptHeader.includes("text/html")) {
      const html404 = render404Page(baseUrl);
      return new Response(method === "HEAD" ? null : html404, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  } catch (error: any) {
    console.error("Server Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

function generatePromptSvg(prompt: PromptDoc): string {
  const title = (prompt.title || "AI Prompt").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const category = (prompt.category || 'general').toUpperCase();
  const platform = (prompt.platform || 'chatgpt').toUpperCase();
  const description = (prompt.description || prompt.content.slice(0, 150)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const contentSnippet = prompt.content.slice(0, 220).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tags = prompt.tags.slice(0, 4).join(', ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450" fill="none">
    <rect width="800" height="450" rx="16" fill="#0A0D14"/>
    <rect x="1" y="1" width="798" height="448" rx="15" fill="#121824" stroke="rgba(255,255,255,0.1)"/>
    
    <!-- Accent Gradient Header Line -->
    <rect x="0" y="0" width="800" height="6" rx="3" fill="url(#grad)"/>
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#8B5CF6"/>
        <stop offset="100%" stop-color="#06B6D4"/>
      </linearGradient>
    </defs>

    <!-- Brand Logo -->
    <text x="40" y="45" fill="#8B5CF6" font-family="'Outfit', sans-serif" font-weight="bold" font-size="20">⚡ VibeNote.sbs</text>
    <text x="760" y="45" text-anchor="end" fill="#9CA3AF" font-family="'Inter', sans-serif" font-size="14">ID: ${prompt.shortId}</text>

    <!-- Category & Platform Badges -->
    <rect x="40" y="70" width="90" height="24" rx="6" fill="rgba(6,182,212,0.15)"/>
    <text x="85" y="86" text-anchor="middle" fill="#06B6D4" font-family="'Inter', sans-serif" font-weight="bold" font-size="11">${category}</text>

    <rect x="140" y="70" width="90" height="24" rx="6" fill="rgba(139,92,246,0.15)"/>
    <text x="185" y="86" text-anchor="middle" fill="#A78BFA" font-family="'Inter', sans-serif" font-weight="bold" font-size="11">${platform}</text>

    <!-- Title -->
    <text x="40" y="130" fill="#F3F4F6" font-family="'Outfit', sans-serif" font-weight="bold" font-size="24">${title}</text>

    <!-- Description -->
    <text x="40" y="165" fill="#9CA3AF" font-family="'Inter', sans-serif" font-size="14">${description.slice(0, 90)}...</text>

    <!-- Content Code Preview Box -->
    <rect x="40" y="195" width="720" height="170" rx="10" fill="#06080D" stroke="rgba(255,255,255,0.08)"/>
    <text x="60" y="230" fill="#8B5CF6" font-family="'Inter', sans-serif" font-size="12" font-weight="bold">// Prompt Template Snippet</text>
    <text x="60" y="260" fill="#E5E7EB" font-family="monospace" font-size="13">${contentSnippet.slice(0, 80)}</text>
    <text x="60" y="285" fill="#E5E7EB" font-family="monospace" font-size="13">${contentSnippet.slice(80, 160)}</text>
    <text x="60" y="310" fill="#E5E7EB" font-family="monospace" font-size="13">${contentSnippet.slice(160, 240)}...</text>

    <!-- Footer Stats & Tags -->
    <text x="40" y="405" fill="#6B7280" font-family="'Inter', sans-serif" font-size="12">Tags: ${tags}</text>
    <text x="760" y="405" text-anchor="end" fill="#8B5CF6" font-family="'Inter', sans-serif" font-weight="bold" font-size="13">https://vibenote.sbs/p/${prompt.shortId}</text>
  </svg>`;
}

function escapeXml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
