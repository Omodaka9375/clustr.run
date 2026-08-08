import { proxyFetch } from "./proxy-fetch";
import type { SourceMeta } from "../core/types";

export type UrlImportResult = {
  text: string;
  meta: SourceMeta;
};

/** Extract domain from URL. */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Fetch text content from a URL via a CORS proxy. */
export async function fetchUrlContent(url: string): Promise<string> {
  const res = await proxyFetch(url);

  const html = await res.text();
  return extractTextFromHtml(html);
}

/** Fetch URL with metadata. */
export async function fetchUrlWithMeta(url: string): Promise<UrlImportResult> {
  const res = await proxyFetch(url);

  const html = await res.text();
  const text = extractTextFromHtml(html);
  const title = extractTitle(html);
  const ogImage = extractOgImage(html);

  return {
    text,
    meta: {
      type: "url",
      url,
      title: title || getDomain(url),
      thumbnail: ogImage,
      domain: getDomain(url),
      importedAt: Date.now(),
    },
  };
}

/** Strip HTML tags and extract readable text. */
function extractTextFromHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Remove non-content elements
  const removeTags = [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "aside",
    "noscript",
    "svg",
    "iframe",
  ];
  for (const tag of removeTags) {
    const els = doc.querySelectorAll(tag);
    els.forEach((el) => el.remove());
  }

  // Prefer article/main content if available
  const article =
    doc.querySelector("article") ??
    doc.querySelector("main") ??
    doc.querySelector("[role='main']");
  const root = article ?? doc.body;

  // Extract text from content-bearing elements
  const blocks = root.querySelectorAll(
    "p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, figcaption",
  );
  if (blocks.length > 0) {
    return Array.from(blocks)
      .map((el) => el.textContent?.trim())
      .filter((t) => t && t.length > 10)
      .join("\n\n");
  }

  // Fallback: full body text
  return root.textContent?.trim() ?? "";
}

/** Extract page title from HTML. */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : "";
}

/** Extract OpenGraph image from HTML. */
function extractOgImage(html: string): string | undefined {
  const match = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
  );
  return match ? match[1] : undefined;
}

/** Fetch multiple URLs and concatenate. */
export async function fetchMultipleUrls(urls: string[]): Promise<string> {
  const results = await Promise.allSettled(urls.map(fetchUrlContent));
  const texts: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value.length > 0) {
      texts.push(`--- Source: ${urls[i]} ---\n${result.value}`);
    }
  }

  if (texts.length === 0)
    throw new Error("Could not extract content from any URL");
  return texts.join("\n\n");
}

/** Fetch multiple URLs with metadata. */
export async function fetchMultipleUrlsWithMeta(
  urls: string[],
): Promise<UrlImportResult[]> {
  const results = await Promise.allSettled(urls.map(fetchUrlWithMeta));
  const successful: UrlImportResult[] = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.text.length > 0) {
      successful.push(result.value);
    }
  }

  if (successful.length === 0)
    throw new Error("Could not extract content from any URL");
  return successful;
}
