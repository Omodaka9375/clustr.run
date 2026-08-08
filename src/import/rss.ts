import { proxyFetch } from "./proxy-fetch";
import type { SourceMeta } from "../core/types";

export type FeedItem = {
  title: string;
  content: string;
  link: string;
  date?: string;
};

export type RssImportResult = {
  text: string;
  meta: SourceMeta;
};

/** Fetch and parse an RSS or Atom feed. */
export async function fetchRssFeed(feedUrl: string): Promise<FeedItem[]> {
  const res = await proxyFetch(feedUrl);

  const xml = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  // Detect format
  const isAtom = doc.querySelector("feed") !== null;
  return isAtom ? parseAtom(doc) : parseRss(doc);
}

function parseRss(doc: Document): FeedItem[] {
  const items: FeedItem[] = [];
  const entries = doc.querySelectorAll("item");

  for (const entry of entries) {
    const title = entry.querySelector("title")?.textContent?.trim() ?? "";
    const description =
      entry.querySelector("description")?.textContent?.trim() ?? "";
    const contentEncoded =
      entry.querySelector("content\\:encoded, encoded")?.textContent?.trim() ??
      "";
    const link = entry.querySelector("link")?.textContent?.trim() ?? "";
    const pubDate = entry.querySelector("pubDate")?.textContent?.trim();

    const rawHtml = contentEncoded || description;
    const content = stripHtml(rawHtml);

    if (content.length > 0) {
      items.push({ title, content, link, date: pubDate });
    }
  }

  return items;
}

function parseAtom(doc: Document): FeedItem[] {
  const items: FeedItem[] = [];
  const entries = doc.querySelectorAll("entry");

  for (const entry of entries) {
    const title = entry.querySelector("title")?.textContent?.trim() ?? "";
    const content =
      entry.querySelector("content")?.textContent?.trim() ??
      entry.querySelector("summary")?.textContent?.trim() ??
      "";
    const link = entry.querySelector("link")?.getAttribute("href") ?? "";
    const updated = entry.querySelector("updated")?.textContent?.trim();

    const cleanContent = stripHtml(content);

    if (cleanContent.length > 0) {
      items.push({ title, content: cleanContent, link, date: updated });
    }
  }

  return items;
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent?.trim() ?? "";
}

/** Convert feed items to a single text block. */
export function feedItemsToText(items: FeedItem[], maxItems = 50): string {
  return items
    .slice(0, maxItems)
    .map((item) => {
      let block = "";
      if (item.title) block += `${item.title}\n`;
      block += item.content;
      return block;
    })
    .join("\n\n");
}

/** Extract domain from URL. */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Convert feed items to structured results with metadata. */
export function feedItemsToResults(
  items: FeedItem[],
  feedUrl: string,
  maxItems = 50,
): RssImportResult[] {
  const domain = getDomain(feedUrl);
  return items.slice(0, maxItems).map((item) => {
    let text = "";
    if (item.title) text += `${item.title}\n`;
    text += item.content;

    return {
      text,
      meta: {
        type: "rss" as const,
        url: item.link || feedUrl,
        title: item.title || domain,
        domain,
        importedAt: Date.now(),
      },
    };
  });
}

/** Fetch RSS feed with metadata. */
export async function fetchRssFeedWithMeta(
  feedUrl: string,
  maxItems = 50,
): Promise<RssImportResult[]> {
  const items = await fetchRssFeed(feedUrl);
  return feedItemsToResults(items, feedUrl, maxItems);
}
