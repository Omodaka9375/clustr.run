import { proxyFetch } from "./proxy-fetch";
import type { SourceMeta } from "../core/types";

export type YouTubeImportResult = {
  text: string;
  meta: SourceMeta;
};

/** Get YouTube thumbnail URL from video ID. */
export function getYouTubeThumbnail(
  videoId: string,
  quality: "default" | "mq" | "hq" | "sd" | "maxres" = "mq",
): string {
  const qualityMap = {
    default: "default",
    mq: "mqdefault",
    hq: "hqdefault",
    sd: "sddefault",
    maxres: "maxresdefault",
  };
  return `https://img.youtube.com/vi/${videoId}/${qualityMap[quality]}.jpg`;
}

/** Extract the video ID from various YouTube URL formats. */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  name?: { simpleText?: string };
};

/** Fetch YouTube video transcript using multiple strategies. */
export async function fetchYouTubeTranscript(url: string): Promise<string> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  // Strategy 1: Try the timedtext API directly (most stable)
  try {
    const text = await fetchViaTimedTextApi(videoId);
    if (text.length > 20) return text;
  } catch {
    // Fall through to next strategy
  }

  // Strategy 2: Scrape the page for captionTracks
  const tracks = await extractCaptionTracks(videoId);
  if (tracks.length === 0) {
    throw new Error(
      "No captions found for this video. Try a video with subtitles enabled.",
    );
  }

  // Prefer English, fall back to first available
  const track =
    tracks.find(
      (t) => t.languageCode === "en" || t.languageCode?.startsWith("en"),
    ) ?? tracks[0];

  const captionRes = await proxyFetch(track.baseUrl);

  const xml = await captionRes.text();
  return parseTranscriptXml(xml);
}

/** Strategy 1: Use YouTube's timedtext API endpoint directly. */
async function fetchViaTimedTextApi(videoId: string): Promise<string> {
  const apiUrl = `https://video.google.com/timedtext?lang=en&v=${videoId}`;
  const res = await proxyFetch(apiUrl);
  const xml = await res.text();
  if (!xml.includes("<text")) throw new Error("No transcript in response");
  return parseTranscriptXml(xml);
}

/** Strategy 2: Scrape captionTracks from the YouTube page HTML. */
async function extractCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const res = await proxyFetch(`https://www.youtube.com/watch?v=${videoId}`);

  const html = await res.text();

  // Try multiple regex patterns — YouTube changes their serialization
  const patterns = [
    /"captionTracks":\s*(\[.*?\])\s*[,}]/,
    /"captionTracks"\s*:\s*(\[\{.*?\}\])\s*[,}]/,
    /playerCaptionsTracklistRenderer.*?"captionTracks":\s*(\[.*?\])/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      return JSON.parse(match[1]) as CaptionTrack[];
    } catch {
      continue;
    }
  }

  return [];
}

/** Parse YouTube transcript XML into plain text. */
function parseTranscriptXml(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const textNodes = doc.querySelectorAll("text");

  const lines: string[] = [];
  for (const node of textNodes) {
    const raw = node.textContent?.trim();
    if (!raw) continue;
    // Decode HTML entities
    const decoded = raw
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, " ");
    lines.push(decoded);
  }

  if (lines.length === 0) throw new Error("Transcript XML contained no text");
  return lines.join(" ");
}

/** Get video title from page HTML. */
export async function fetchYouTubeTitle(url: string): Promise<string> {
  const videoId = extractVideoId(url);
  if (!videoId) return "Unknown Video";

  try {
    const res = await proxyFetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await res.text();
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    return titleMatch
      ? titleMatch[1].replace(" - YouTube", "").trim()
      : "YouTube Video";
  } catch {
    return "YouTube Video";
  }
}

/** Fetch YouTube transcript with metadata. */
export async function fetchYouTubeWithMeta(
  url: string,
): Promise<YouTubeImportResult> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const [transcript, title] = await Promise.all([
    fetchYouTubeTranscript(url),
    fetchYouTubeTitle(url),
  ]);

  return {
    text: transcript,
    meta: {
      type: "youtube",
      url,
      title,
      videoId,
      thumbnail: getYouTubeThumbnail(videoId, "mq"),
      domain: "youtube.com",
      importedAt: Date.now(),
    },
  };
}
