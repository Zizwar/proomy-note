import { PromptDoc, PromptMeta } from "./db.ts";

export function generateRobotsTxt(baseUrl = "https://vibenote.sbs"): string {
  return `# Robots.txt for Vibe Note (https://vibenote.sbs)
User-agent: *
Allow: /
Allow: /p/
Allow: /feed.xml
Allow: /rss.xml
Allow: /sitemap.xml
Allow: /sitemap*.xml

Disallow: /admin
Disallow: /admin/
Disallow: /api/admin/
Disallow: /api/seed

# Search Engine Sitemaps
Sitemap: ${baseUrl}/sitemap.xml
Sitemap: ${baseUrl}/sitemap-main.xml
Sitemap: ${baseUrl}/sitemap-prompts-1.xml
Sitemap: ${baseUrl}/sitemap-prompts-2.xml
`;
}

export function generateSitemapIndexXml(baseUrl = "https://vibenote.sbs", totalPrompts = 10000, chunkSize = 5000): string {
  const now = new Date().toISOString().split("T")[0];
  const chunkCount = Math.max(1, Math.ceil(totalPrompts / chunkSize));
  
  let sitemapsXml = `  <sitemap>
    <loc>${baseUrl}/sitemap-main.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>\n`;

  for (let i = 1; i <= chunkCount; i++) {
    sitemapsXml += `  <sitemap>
    <loc>${baseUrl}/sitemap-prompts-${i}.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapsXml.trimEnd()}
</sitemapindex>`;
}

export function generateMainSitemapXml(baseUrl = "https://vibenote.sbs"): string {
  const now = new Date().toISOString().split("T")[0];
  const categories = [
    "code",
    "image",
    "writing",
    "marketing",
    "business",
    "education",
    "video",
    "music",
    "other"
  ];

  const sortViews = ["popular", "latest"];

  let urls = `  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>\n`;

  for (const cat of categories) {
    urls += `  <url>
    <loc>${baseUrl}/?category=${cat}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>\n`;
  }

  for (const sort of sortViews) {
    urls += `  <url>
    <loc>${baseUrl}/?sort=${sort}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.trimEnd()}
</urlset>`;
}

export function generatePromptsSitemapXml(prompts: (PromptDoc | PromptMeta)[], baseUrl = "https://vibenote.sbs"): string {
  const defaultDate = new Date().toISOString().split("T")[0];

  const urls = prompts.map(p => {
    let lastmod = defaultDate;
    if (p.updatedAt) {
      try {
        lastmod = new Date(p.updatedAt).toISOString().split("T")[0];
      } catch {}
    } else if (p.createdAt) {
      try {
        lastmod = new Date(p.createdAt).toISOString().split("T")[0];
      } catch {}
    }

    return `  <url>
    <loc>${baseUrl}/p/${escapeXml(p.shortId)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export function generateUnifiedSitemapXml(prompts: (PromptDoc | PromptMeta)[], baseUrl = "https://vibenote.sbs"): string {
  const now = new Date().toISOString().split("T")[0];
  const categories = [
    "code",
    "image",
    "writing",
    "marketing",
    "business",
    "education",
    "video",
    "music",
    "other"
  ];

  let staticUrls = `  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>\n`;

  for (const cat of categories) {
    staticUrls += `  <url>
    <loc>${baseUrl}/?category=${cat}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>\n`;
  }

  const promptUrls = prompts.map(p => {
    let lastmod = now;
    if (p.updatedAt) {
      try {
        lastmod = new Date(p.updatedAt).toISOString().split("T")[0];
      } catch {}
    } else if (p.createdAt) {
      try {
        lastmod = new Date(p.createdAt).toISOString().split("T")[0];
      } catch {}
    }

    return `  <url>
    <loc>${baseUrl}/p/${escapeXml(p.shortId)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls}${promptUrls}
</urlset>`;
}

export function generateRssFeedXml(prompts: PromptDoc[], baseUrl = "https://vibenote.sbs"): string {
  const now = new Date().toUTCString();

  const items = prompts.map(p => {
    const pubDate = p.createdAt ? new Date(p.createdAt).toUTCString() : now;
    const title = escapeXml(p.title || "AI Prompt");
    const desc = escapeXml(p.description || p.content.slice(0, 200));
    const link = `${baseUrl}/p/${escapeXml(p.shortId)}`;
    const category = escapeXml(p.category || "general");

    return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${desc}</description>
      <category>${category}</category>
      <pubDate>${pubDate}</pubDate>
    </item>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Vibe Note — AI Prompt Bank &amp; Variable Engine</title>
    <link>${baseUrl}</link>
    <description>Discover curated AI prompts with dynamic interactive variables for ChatGPT, Midjourney, Claude, Gemini &amp; Cursor.</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
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
