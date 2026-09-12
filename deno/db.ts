import { MongoClient, Collection } from "npm:mongodb@^6.8.0";
import { parse } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

export interface VariableDefinition {
  name: string;
  label?: string;
  type: 'text' | 'select';
  defaultValue?: string;
  options?: string[];
}

export interface PromptDoc {
  _id?: any;
  shortId: string;
  kind?: string; // 'prompt' | 'note' | 'context'
  title: string;
  content: string;
  description?: string;
  category: string;
  platform: string;
  tags: string[];
  variables: VariableDefinition[];
  isPublic: boolean;
  status?: 'approved' | 'pending' | 'rejected';
  visibility?: 'public' | 'private' | 'unlisted';
  views: number;
  copies: number;
  createdAt: string;
  updatedAt: string;
}

// Load env
let env: Record<string, string> = {};
try {
  env = await parse(await Deno.readTextFile("./.env"));
} catch {
  env = Deno.env.toObject();
}

const MONGODB_URI = env.MONGOD_FULL_URI || env.MONGODB_URI || Deno.env.get("MONGODB_URI") || "";

let mongoCollection: Collection<PromptDoc> | null = null;
let useFallbackDb = false;
const LOCAL_DB_PATH = new URL("./data/prompts.json", import.meta.url);

let cachedLocalPrompts: PromptDoc[] | null = null;

export async function loadLocalPrompts(): Promise<PromptDoc[]> {
  if (cachedLocalPrompts && cachedLocalPrompts.length > 0) {
    return cachedLocalPrompts;
  }
  try {
    const text = await Deno.readTextFile(LOCAL_DB_PATH);
    const parsed: PromptDoc[] = JSON.parse(text);
    cachedLocalPrompts = parsed;
    return parsed;
  } catch (err) {
    console.warn("Could not read LOCAL_DB_PATH:", err);
    return getInitialSeedData();
  }
}

async function ensureLocalDbDir() {
  // Static fallback file exists in ./data/prompts.json
}

function getInitialSeedData(): PromptDoc[] {
  return [
    {
      shortId: "vibe101",
      kind: "prompt",
      title: "Senior Full-Stack Code Reviewer",
      description: "Comprehensive code review for clean architecture, security, performance, and best practices.",
      content: "Act as a Senior Principal Engineer. Review the following {{language}} code for:\n1. Security vulnerabilities\n2. Performance bottlenecks in {{focus_area}}\n3. Architecture & clean code principles\n\nCode snippet:\n```{{language}}\n{{code_snippet}}\n```\nProvide actionable recommendations with code examples.",
      category: "code",
      platform: "chatgpt",
      tags: ["code-review", "architecture", "refactoring"],
      variables: [
        { name: "language", type: "select", defaultValue: "typescript", options: ["typescript", "javascript", "python", "go", "rust"] },
        { name: "focus_area", type: "select", defaultValue: "async operations", options: ["async operations", "memory usage", "database queries", "API security"] },
        { name: "code_snippet", type: "text", defaultValue: "const data = await fetch('/api/user');" }
      ],
      isPublic: true,
      views: 142,
      copies: 68,
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      shortId: "midj88",
      kind: "prompt",
      title: "Cyberpunk Cinematic Scene Generator",
      description: "Generates photorealistic neon-lit cyberpunk concept art with camera details.",
      content: "Cinematic shot of {{subject}} in a futuristic rainy neon cyberpunk street, {{lighting_style}} lighting, reflections in water puddles, shot on 35mm lens, f/1.4, volumetric fog, highly detailed, photorealistic, 8k resolution --ar {{aspect_ratio}} --v 6.0",
      category: "image",
      platform: "midjourney",
      tags: ["midjourney", "cyberpunk", "photorealistic"],
      variables: [
        { name: "subject", type: "text", defaultValue: "a lone female hacker with glowing cybernetic visor" },
        { name: "lighting_style", type: "select", defaultValue: "cyan and magenta neon", options: ["cyan and magenta neon", "golden hour twilight", "dark emerald darksynth"] },
        { name: "aspect_ratio", type: "select", defaultValue: "16:9", options: ["16:9", "9:16", "1:1", "21:9"] }
      ],
      isPublic: true,
      views: 289,
      copies: 140,
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      shortId: "writ33",
      kind: "prompt",
      title: "Viral LinkedIn Post Creator",
      description: "Drafts engaging, high-hook LinkedIn posts with clear value and call-to-action.",
      content: "Write a high-converting LinkedIn post about {{topic}}.\nTarget Audience: {{target_audience}}\nTone: {{tone:inspiring|authoritative|conversational|storytelling}}\n\nStructure:\n1. Hook: Attention-grabbing first line (under 10 words)\n2. Problem & Story: Relatable struggle\n3. Solution & Takeaway: 3 actionable points\n4. CTA: Engaging question to spark comments.",
      category: "writing",
      platform: "chatgpt",
      tags: ["linkedin", "copywriting", "marketing"],
      variables: [
        { name: "topic", type: "text", defaultValue: "How AI is changing mobile app development" },
        { name: "target_audience", type: "text", defaultValue: "Software developers & product managers" },
        { name: "tone", type: "select", defaultValue: "conversational", options: ["inspiring", "authoritative", "conversational", "storytelling"] }
      ],
      isPublic: true,
      views: 95,
      copies: 41,
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    }
  ];
}

export async function initDatabase() {
  await ensureLocalDbDir();

  if (!MONGODB_URI) {
    console.log("⚠️ No MONGODB_URI set, using local fallback database.");
    useFallbackDb = true;
    return;
  }

  try {
    console.log("🔌 Connecting to MongoDB Atlas...");
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 4000,
    });
    await client.connect();
    const db = client.db("vibenote");
    mongoCollection = db.collection<PromptDoc>("prompts");
    console.log("✅ Successfully connected to MongoDB Atlas!");
    await seedDatabase();
  } catch (err: any) {
    console.warn(`⚠️ MongoDB Atlas connection failed (${err.message}). Using local JSON storage fallback.`);
    useFallbackDb = true;
  }
}

export async function seedDatabase(force = false): Promise<{ seeded: number; total: number }> {
  let count = 0;
  if (!useFallbackDb && mongoCollection) {
    try {
      count = await mongoCollection.countDocuments();
      if (count < 100 || force) {
        console.log("🌱 Seeding 10,000+ prompts into MongoDB Atlas...");
        const list = await loadLocalPrompts();
        if (list.length > 0) {
          const ops = list.map(p => ({
            updateOne: {
              filter: { shortId: p.shortId },
              update: { $set: p },
              upsert: true,
            }
          }));
          for (let i = 0; i < ops.length; i += 1000) {
            await mongoCollection.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
          }
          console.log(`✅ Successfully seeded ${list.length} prompts into MongoDB Atlas!`);
          return { seeded: list.length, total: list.length };
        }
      }
    } catch (sErr) {
      console.warn("Seeding warning:", sErr);
    }
  }
  return { seeded: 0, total: count };
}

export interface PaginatedPrompts {
  prompts: PromptDoc[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Data methods
export async function getPublicPrompts(options?: {
  category?: string;
  search?: string;
  tag?: string;
  limit?: number;
  page?: number;
  sort?: string;
}): Promise<PaginatedPrompts> {
  const category = options?.category;
  const search = options?.search?.toLowerCase();
  const tag = options?.tag?.toLowerCase();

  // Strict limit capping: max 50 per fetch
  const requestedLimit = Number(options?.limit) || 24;
  const limit = Math.min(Math.max(requestedLimit, 1), 50);
  const page = Math.max(Number(options?.page) || 1, 1);
  const skip = (page - 1) * limit;

  // Determine if we should show a diverse magazine random mix
  const isRandomView = (options?.sort === 'random' || !options?.sort) && !tag && !search && (!category || category === 'all');

  if (!useFallbackDb && mongoCollection) {
    try {
      const query: any = { isPublic: true, status: { $nin: ['pending', 'rejected'] }, visibility: { $ne: 'private' } };
      if (category && category !== 'all') {
        query.category = category;
      }
      if (tag) {
        query.tags = { $regex: tag, $options: 'i' };
      }
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { content: { $regex: search, $options: 'i' } },
          { tags: { $regex: search, $options: 'i' } },
        ];
      }
      
      const total = await mongoCollection.countDocuments(query);
      let prompts: PromptDoc[] = [];

      if (isRandomView) {
        // Diverse Magazine Feed: Interleave equal samples from every category
        const categories = ['code', 'image', 'writing', 'marketing', 'business', 'education', 'video', 'music', 'other'];
        const perCat = Math.max(Math.floor(limit / categories.length), 3);

        const categorySamples = await Promise.all(
          categories.map(cat =>
            mongoCollection!.aggregate<PromptDoc>([
              { $match: { isPublic: true, status: { $nin: ['pending', 'rejected'] }, visibility: { $ne: 'private' }, category: cat } },
              { $sample: { size: perCat } }
            ]).toArray()
          )
        );

        const mixed: PromptDoc[] = [];
        const maxLen = Math.max(...categorySamples.map((a: PromptDoc[]) => a.length));
        for (let i = 0; i < maxLen; i++) {
          for (const group of categorySamples) {
            if (group[i]) mixed.push(group[i]);
          }
        }

        prompts = mixed.slice(0, limit);
      } else {
        const sortOption: any = options?.sort === 'popular' ? { copies: -1, views: -1 } : { createdAt: -1 };
        prompts = await mongoCollection.find(query).sort(sortOption).skip(skip).limit(limit).toArray();
      }

      const totalPages = Math.ceil(total / limit) || 1;
      return { prompts, total, page, limit, totalPages };
    } catch (e) {
      console.error("MongoDB query error, falling back:", e);
    }
  }

  // Fallback DB read
  try {
    let list = await loadLocalPrompts();
    list = list.filter(p => p.isPublic !== false && p.status !== 'pending' && p.status !== 'rejected' && p.visibility !== 'private');
    if (category && category !== 'all') {
      list = list.filter(p => p.category === category);
    }
    if (tag) {
      list = list.filter(p => p.tags.some(t => t.toLowerCase() === tag || t.toLowerCase().includes(tag)));
    }
    if (search) {
      list = list.filter(p =>
        p.title.toLowerCase().includes(search) ||
        (p.description && p.description.toLowerCase().includes(search)) ||
        p.content.toLowerCase().includes(search) ||
        p.tags.some(t => t.toLowerCase().includes(search))
      );
    }

    if (isRandomView) {
      const categories = ['code', 'image', 'writing', 'marketing', 'business', 'education', 'video', 'music', 'other'];
      const grouped: Record<string, PromptDoc[]> = {};
      for (const cat of categories) grouped[cat] = [];
      for (const p of list) {
        const cat = p.category || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p);
      }
      for (const cat of categories) {
        grouped[cat].sort(() => Math.random() - 0.5);
      }
      const mixed: PromptDoc[] = [];
      for (let i = 0; i < 50; i++) {
        for (const cat of categories) {
          if (grouped[cat][i]) mixed.push(grouped[cat][i]);
        }
      }
      list = mixed;
    } else if (options?.sort === 'popular') {
      list.sort((a, b) => (b.copies || 0) - (a.copies || 0));
    } else {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = isRandomView ? list.slice(0, limit) : list.slice(skip, skip + limit);

    return { prompts: paginated, total, page, limit, totalPages };
  } catch {
    const seed = getInitialSeedData();
    return { prompts: seed, total: seed.length, page: 1, limit: 24, totalPages: 1 };
  }
}

export async function getPromptByShortId(shortId: string): Promise<PromptDoc | null> {
  if (!useFallbackDb && mongoCollection) {
    try {
      const doc = await mongoCollection.findOne({ shortId });
      if (doc) return doc;
    } catch (e) {
      console.error("MongoDB find error, falling back:", e);
    }
  }

  try {
    const list = await loadLocalPrompts();
    return list.find(p => p.shortId === shortId) || null;
  } catch {
    return null;
  }
}

export async function savePrompt(promptData: Partial<PromptDoc>): Promise<PromptDoc> {
  const shortId = promptData.shortId || generateShortId();
  const now = new Date().toISOString();

  const status = promptData.status || 'pending';
  const isApproved = status === 'approved';
  const visibility = promptData.visibility || (isApproved ? 'public' : 'private');
  const isPublic = isApproved && visibility === 'public';

  const doc: PromptDoc = {
    shortId,
    kind: promptData.kind || "prompt",
    title: promptData.title || "Untitled Prompt",
    content: promptData.content || "",
    description: promptData.description || "",
    category: promptData.category || "other",
    platform: promptData.platform || "other",
    tags: Array.isArray(promptData.tags) ? promptData.tags : [],
    variables: Array.isArray(promptData.variables) ? promptData.variables : [],
    isPublic,
    status,
    visibility,
    views: promptData.views || 0,
    copies: promptData.copies || 0,
    createdAt: promptData.createdAt || now,
    updatedAt: now,
  };

  if (!useFallbackDb && mongoCollection) {
    try {
      await mongoCollection.updateOne(
        { shortId },
        { $set: doc },
        { upsert: true }
      );
      return doc;
    } catch (e) {
      console.error("MongoDB upsert error, saving locally:", e);
    }
  }

  // Local fallback save
  try {
    const raw = await Deno.readTextFile(LOCAL_DB_PATH);
    let list: PromptDoc[] = JSON.parse(raw);
    const idx = list.findIndex(p => p.shortId === shortId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...doc };
    } else {
      list.unshift(doc);
    }
    await Deno.writeTextFile(LOCAL_DB_PATH, JSON.stringify(list, null, 2));
  } catch (e) {
    console.error("Error writing fallback db:", e);
  }

  return doc;
}

export async function incrementStats(shortId: string, type: 'view' | 'copy') {
  if (!useFallbackDb && mongoCollection) {
    try {
      const inc: any = type === 'view' ? { views: 1 } : { copies: 1 };
      await mongoCollection.updateOne({ shortId }, { $inc: inc });
      return;
    } catch (e) {
      console.error("MongoDB inc error:", e);
    }
  }

  try {
    const raw = await Deno.readTextFile(LOCAL_DB_PATH);
    let list: PromptDoc[] = JSON.parse(raw);
    const p = list.find(x => x.shortId === shortId);
    if (p) {
      if (type === 'view') p.views = (p.views || 0) + 1;
      if (type === 'copy') p.copies = (p.copies || 0) + 1;
      await Deno.writeTextFile(LOCAL_DB_PATH, JSON.stringify(list, null, 2));
    }
  } catch {}
}

function generateShortId(length = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function getAdminPendingPrompts(): Promise<PromptDoc[]> {
  if (!useFallbackDb && mongoCollection) {
    try {
      return await mongoCollection.find({ status: 'pending' }).sort({ createdAt: -1 }).toArray();
    } catch (e) {
      console.error("MongoDB getAdminPendingPrompts error:", e);
    }
  }

  try {
    const list = await loadLocalPrompts();
    return list.filter(p => p.status === 'pending');
  } catch {
    return [];
  }
}

export async function getAdminAllPrompts(options?: {
  status?: string;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedPrompts> {
  const status = options?.status;
  const category = options?.category;
  const search = options?.search?.toLowerCase();
  const limit = Math.min(Math.max(Number(options?.limit) || 20, 1), 100);
  const page = Math.max(Number(options?.page) || 1, 1);
  const skip = (page - 1) * limit;

  if (!useFallbackDb && mongoCollection) {
    try {
      const query: any = {};
      if (status && status !== 'all') {
        query.status = status;
      }
      if (category && category !== 'all') {
        query.category = category;
      }
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { content: { $regex: search, $options: 'i' } },
          { shortId: { $regex: search, $options: 'i' } },
        ];
      }

      const total = await mongoCollection.countDocuments(query);
      const prompts = await mongoCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
      const totalPages = Math.ceil(total / limit) || 1;

      return { prompts, total, page, limit, totalPages };
    } catch (e) {
      console.error("MongoDB getAdminAllPrompts error:", e);
    }
  }

  // Fallback DB
  try {
    let list = await loadLocalPrompts();
    if (status && status !== 'all') {
      list = list.filter(p => p.status === status);
    }
    if (category && category !== 'all') {
      list = list.filter(p => p.category === category);
    }
    if (search) {
      list = list.filter(p =>
        p.title.toLowerCase().includes(search) ||
        p.content.toLowerCase().includes(search) ||
        p.shortId.toLowerCase().includes(search)
      );
    }
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = list.slice(skip, skip + limit);
    return { prompts: paginated, total, page, limit, totalPages };
  } catch {
    return { prompts: [], total: 0, page: 1, limit: 20, totalPages: 1 };
  }
}

export async function updatePromptStatus(shortId: string, status: 'approved' | 'pending' | 'rejected'): Promise<boolean> {
  const isApproved = status === 'approved';
  const visibility = isApproved ? 'public' : 'private';
  const isPublic = isApproved;

  if (!useFallbackDb && mongoCollection) {
    try {
      await mongoCollection.updateOne({ shortId }, { $set: { status, isPublic, visibility, updatedAt: new Date().toISOString() } });
      return true;
    } catch (e) {
      console.error("MongoDB updatePromptStatus error:", e);
    }
  }

  try {
    const raw = await Deno.readTextFile(LOCAL_DB_PATH);
    let list: PromptDoc[] = JSON.parse(raw);
    const p = list.find(x => x.shortId === shortId);
    if (p) {
      p.status = status;
      p.isPublic = isPublic;
      p.visibility = visibility;
      p.updatedAt = new Date().toISOString();
      await Deno.writeTextFile(LOCAL_DB_PATH, JSON.stringify(list, null, 2));
      return true;
    }
  } catch {}
  return false;
}

export async function deletePrompt(shortId: string): Promise<boolean> {
  if (!useFallbackDb && mongoCollection) {
    try {
      await mongoCollection.deleteOne({ shortId });
      return true;
    } catch (e) {
      console.error("MongoDB deletePrompt error:", e);
    }
  }

  try {
    const raw = await Deno.readTextFile(LOCAL_DB_PATH);
    let list: PromptDoc[] = JSON.parse(raw);
    list = list.filter(p => p.shortId !== shortId);
    await Deno.writeTextFile(LOCAL_DB_PATH, JSON.stringify(list, null, 2));
    return true;
  } catch {}
  return false;
}

export interface PromptMeta {
  shortId: string;
  title?: string;
  category?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export async function getAllApprovedPromptMetas(): Promise<PromptMeta[]> {
  if (!useFallbackDb && mongoCollection) {
    try {
      const docs = await mongoCollection
        .find(
          { isPublic: true, status: { $nin: ['pending', 'rejected'] }, visibility: { $ne: 'private' } },
          { projection: { shortId: 1, title: 1, category: 1, description: 1, createdAt: 1, updatedAt: 1 } }
        )
        .sort({ createdAt: -1 })
        .toArray();
      return docs.map((d: any) => ({
        shortId: d.shortId,
        title: d.title,
        category: d.category,
        description: d.description,
        createdAt: d.createdAt || new Date().toISOString(),
        updatedAt: d.updatedAt || d.createdAt || new Date().toISOString(),
      }));
    } catch (e) {
      console.error("MongoDB getAllApprovedPromptMetas error:", e);
    }
  }

  try {
    const list = await loadLocalPrompts();
    return list
      .filter(p => p.isPublic !== false && p.status !== 'pending' && p.status !== 'rejected' && p.visibility !== 'private')
      .map(p => ({
        shortId: p.shortId,
        title: p.title,
        category: p.category,
        description: p.description,
        createdAt: p.createdAt || new Date().toISOString(),
        updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

export async function getLatestApprovedPrompts(limit = 50): Promise<PromptDoc[]> {
  if (!useFallbackDb && mongoCollection) {
    try {
      return await mongoCollection
        .find({ isPublic: true, status: { $nin: ['pending', 'rejected'] }, visibility: { $ne: 'private' } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (e) {
      console.error("MongoDB getLatestApprovedPrompts error:", e);
    }
  }

  try {
    const list = await loadLocalPrompts();
    return list
      .filter(p => p.isPublic !== false && p.status !== 'pending' && p.status !== 'rejected' && p.visibility !== 'private')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  } catch {
    return [];
  }
}

