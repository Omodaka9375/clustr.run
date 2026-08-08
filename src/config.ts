import type { AIModelConfig, AIProvider } from "./core/types";
import { getItem } from "./utils/storage";

/* ═══════════════════════════════════════════════════
 *  All tunable parameters — edit these to change
 *  default behaviour without touching other files.
 * ═══════════════════════════════════════════════════ */

/** Sliding window size for building the co-occurrence matrix. */
export const CO_OCCURRENCE_WINDOW = 5;

/** Minimum word length to keep after tokenization. */
export const MIN_WORD_LENGTH = 3;

/** Minimum term frequency to keep. */
export const MIN_WORD_FREQUENCY = 1;

/** Maximum number of top keywords shown in the analysis panel. */
export const MAX_TOP_KEYWORDS = 30;

/** Maximum nodes displayed in the graph (ranked by degree). */
export const MAX_GRAPH_NODES = 400;

/** Minimum PMI score to create an edge. */
export const MIN_EDGE_WEIGHT = 0.5;

/** Louvain resolution parameter (higher → more clusters). */
export const LOUVAIN_RESOLUTION = 1.5;

/** D3 force simulation parameters. */
export const FORCE_CHARGE_STRENGTH = -120;
export const FORCE_LINK_DISTANCE = 80;
export const FORCE_CENTER_STRENGTH = 0.05;
export const FORCE_COLLISION_RADIUS = 25;

/** Number of ticks to run simulation before first render (0 = animate from start). */
export const SIMULATION_WARMUP_TICKS = 300;

/** Node size range [min, max] in px, mapped by degree centrality. */
export const NODE_SIZE_RANGE: [number, number] = [4, 28];

/** Edge width range [min, max] in px, mapped by weight. */
export const EDGE_WIDTH_RANGE: [number, number] = [0.5, 4];

/** Label visibility threshold — only nodes with degree ≥ this show labels. */
export const LABEL_DEGREE_THRESHOLD = 2;

/** Cluster colour palette. */
export const CLUSTER_COLORS = [
  "#4ade80", // green
  "#60a5fa", // blue
  "#22d3ee", // cyan
  "#e879f9", // magenta
  "#fb923c", // orange
  "#facc15", // yellow
  "#f87171", // red
  "#a78bfa", // violet
  "#34d399", // emerald
  "#f472b6", // pink
] as const;

/** Default grey for nodes not in a major cluster. */
export const DEFAULT_NODE_COLOR = "#6b7280";

/** Sentiment thresholds. */
export const SENTIMENT_POSITIVE_THRESHOLD = 0.5;
export const SENTIMENT_NEGATIVE_THRESHOLD = -0.5;
export const SENTIMENT_COLORS = {
  positive: "#4ade80",
  neutral: "#6b7280",
  negative: "#f87171",
} as const;

/** AI temperature for analysis tasks. */
export const AI_TEMPERATURE = 0.7;

/** AI max tokens for responses. */
export const AI_MAX_TOKENS = 2048;

/** OpenRouter chat completions endpoint (all AI calls route through here). */
export const OPENROUTER_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";

/** OpenRouter public model catalog endpoint (no key required to list). */
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Vendor prefix → provider id mapping for OpenRouter model slugs. */
export const VENDOR_PREFIXES: { prefix: string; provider: AIProvider }[] = [
  { prefix: "google/", provider: "gemini" },
  { prefix: "anthropic/", provider: "claude" },
  { prefix: "openai/", provider: "openai" },
];

/**
 * Fallback model list, used before the live OpenRouter catalog is fetched
 * or when the fetch/cache is unavailable.
 */
export const DEFAULT_MODELS: AIModelConfig[] = [
  {
    provider: "gemini",
    model: "google/gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro Preview",
  },
  {
    provider: "claude",
    model: "anthropic/claude-opus-4.6",
    displayName: "Claude Opus 4.6",
  },
  {
    provider: "openai",
    model: "openai/gpt-5.2",
    displayName: "GPT-5.2",
  },
];

/** Default (fallback) model when no selection is saved. */
export const DEFAULT_MODEL_ID = DEFAULT_MODELS[0].model;

/** Default CORS proxy for fetching external URLs from the browser. */
export const DEFAULT_CORS_PROXY_URL = "https://api.allorigins.win/raw?url=";

/** Get the active CORS proxy URL (user-configured or default). */
export function getCorsProxyUrl(): string {
  return getItem(STORAGE_KEYS.corsProxy) || DEFAULT_CORS_PROXY_URL;
}

/** Maximum RSS feed items to import. */
export const MAX_RSS_ITEMS = 50;

/** Supported OCR languages (Tesseract language codes). */
export const OCR_LANGUAGES = [
  { code: "eng", name: "English" },
  { code: "fra", name: "French" },
  { code: "deu", name: "German" },
  { code: "spa", name: "Spanish" },
  { code: "ita", name: "Italian" },
  { code: "por", name: "Portuguese" },
  { code: "nld", name: "Dutch" },
  { code: "pol", name: "Polish" },
  { code: "rus", name: "Russian" },
  { code: "jpn", name: "Japanese" },
  { code: "chi_sim", name: "Chinese (Simplified)" },
  { code: "chi_tra", name: "Chinese (Traditional)" },
  { code: "kor", name: "Korean" },
  { code: "ara", name: "Arabic" },
  { code: "hin", name: "Hindi" },
] as const;

/** Default OCR language. */
export const DEFAULT_OCR_LANGUAGE = "eng";

/** Get current OCR language setting. */
export function getOcrLanguage(): string {
  return getItem(STORAGE_KEYS.ocrLanguage) || DEFAULT_OCR_LANGUAGE;
}

/** Graph view modes. */
export type GraphViewMode = "2d" | "3d";
export const DEFAULT_GRAPH_VIEW_MODE: GraphViewMode = "2d";

/** Get current graph view mode. */
export function getGraphViewMode(): GraphViewMode {
  const mode = getItem(STORAGE_KEYS.graphViewMode);
  return mode === "3d" ? "3d" : "2d";
}

/** Graph content modes. */
export type GraphContentMode = "keywords" | "topics";
export const DEFAULT_GRAPH_CONTENT_MODE: GraphContentMode = "keywords";

/** Get current graph content mode. */
export function getGraphContentMode(): GraphContentMode {
  const mode = getItem(STORAGE_KEYS.graphContentMode);
  return mode === "topics" ? "topics" : "keywords";
}

/** localStorage keys. */
export const STORAGE_KEYS = {
  openrouterKey: "clustr_openrouter_key",
  activeModel: "clustr_active_model",
  modelsCache: "clustr_models_cache",
  chatHistory: "clustr_chat_history",
  editorContent: "clustr_editor_content",
  corsProxy: "clustr_cors_proxy",
  aiCache: "clustr_ai_cache",
  lastRawText: "clustr_last_raw_text",
  theme: "clustr_theme",
  ocrLanguage: "clustr_ocr_language",
  graphViewMode: "clustr_graph_view_mode",
  graphContentMode: "clustr_graph_content_mode",
  topicCache: "clustr_topic_cache",
} as const;
