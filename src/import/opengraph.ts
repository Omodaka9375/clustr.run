import { proxyFetch } from "./proxy-fetch";

export type OpenGraphData = {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  url?: string;
};

/** Fetch OpenGraph metadata from a URL. */
export async function fetchOpenGraph(url: string): Promise<OpenGraphData> {
  try {
    const res = await proxyFetch(url);
    const html = await res.text();
    return parseOpenGraph(html, url);
  } catch {
    return {};
  }
}

/** Parse OpenGraph tags from HTML. */
function parseOpenGraph(html: string, fallbackUrl: string): OpenGraphData {
  const data: OpenGraphData = { url: fallbackUrl };

  // og:title
  const titleMatch = html.match(
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  );
  if (titleMatch) data.title = decodeHtmlEntities(titleMatch[1]);

  // Fallback to <title> tag
  if (!data.title) {
    const fallbackTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (fallbackTitle) data.title = decodeHtmlEntities(fallbackTitle[1].trim());
  }

  // og:description
  const descMatch = html.match(
    /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i,
  );
  if (descMatch) data.description = decodeHtmlEntities(descMatch[1]);

  // Fallback to meta description
  if (!data.description) {
    const fallbackDesc = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
    );
    if (fallbackDesc)
      data.description = decodeHtmlEntities(fallbackDesc[1].trim());
  }

  // og:image
  const imageMatch = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
  );
  if (imageMatch) data.image = imageMatch[1];

  // og:site_name
  const siteMatch = html.match(
    /<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i,
  );
  if (siteMatch) data.siteName = decodeHtmlEntities(siteMatch[1]);

  return data;
}

/** Decode common HTML entities. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/** Simple in-memory cache for OG data to avoid re-fetching. */
const ogCache = new Map<string, OpenGraphData>();
const OG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ogCacheTimestamps = new Map<string, number>();

/** Fetch OpenGraph data with caching. */
export async function fetchOpenGraphCached(
  url: string,
): Promise<OpenGraphData> {
  const now = Date.now();
  const cached = ogCache.get(url);
  const timestamp = ogCacheTimestamps.get(url);

  if (cached && timestamp && now - timestamp < OG_CACHE_TTL) {
    return cached;
  }

  const data = await fetchOpenGraph(url);
  ogCache.set(url, data);
  ogCacheTimestamps.set(url, now);

  // Limit cache size
  if (ogCache.size > 50) {
    const firstKey = ogCache.keys().next().value;
    if (firstKey) {
      ogCache.delete(firstKey);
      ogCacheTimestamps.delete(firstKey);
    }
  }

  return data;
}
