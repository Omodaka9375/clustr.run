import type { SourceMeta } from "../core/types";

export type WikiImportResult = {
  text: string;
  meta: SourceMeta;
};

/** Extract the article title from a Wikipedia URL, or return the input as-is. */
function extractTitle(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname.endsWith("wikipedia.org")) {
      const match = url.pathname.match(/\/wiki\/(.+)/);
      if (match) return decodeURIComponent(match[1]);
    }
  } catch {
    // Not a URL — treat as article title
  }
  return trimmed;
}

/** Fetch a Wikipedia article's plain-text extract by title or URL. */
export async function fetchWikipediaArticle(
  input: string,
): Promise<WikiImportResult> {
  const title = extractTitle(input);
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  let url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  let res = await fetch(url, { headers: { Accept: "application/json" } });

  // If direct lookup fails, try a search to find the correct article title
  if (!res.ok) {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(title)}&limit=1&format=json&origin=*`;
    const searchRes = await fetch(searchUrl);
    if (searchRes.ok) {
      const [, , , urls] = (await searchRes.json()) as [
        string,
        string[],
        string[],
        string[],
      ];
      if (urls?.[0]) {
        const resolved = extractTitle(urls[0]);
        url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(resolved.replace(/ /g, "_"))}`;
        res = await fetch(url, { headers: { Accept: "application/json" } });
      }
    }
    if (!res.ok) throw new Error(`Wikipedia lookup failed (${res.status})`);
  }

  const data = (await res.json()) as {
    title: string;
    extract: string;
    thumbnail?: { source: string };
    content_urls?: { desktop?: { page?: string } };
  };

  if (!data.extract || data.extract.length < 20) {
    throw new Error(`No article found for "${title}"`);
  }

  // Summary endpoint only returns the intro. Try the full extract endpoint.
  let fullText = data.extract;
  try {
    const fullRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encoded}&prop=extracts&explaintext=1&format=json&origin=*`,
    );
    if (fullRes.ok) {
      const fullData = (await fullRes.json()) as {
        query?: { pages?: Record<string, { extract?: string }> };
      };
      const pages = fullData.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0];
        if (page?.extract && page.extract.length > fullText.length) {
          fullText = page.extract;
        }
      }
    }
  } catch {
    // Fall back to summary extract
  }

  return {
    text: fullText,
    meta: {
      type: "url",
      url:
        data.content_urls?.desktop?.page ??
        `https://en.wikipedia.org/wiki/${encoded}`,
      title: data.title,
      thumbnail: data.thumbnail?.source,
      domain: "wikipedia.org",
      importedAt: Date.now(),
    },
  };
}
