import {
  STORAGE_KEYS,
  OPENROUTER_MODELS_URL,
  VENDOR_PREFIXES,
  DEFAULT_MODELS,
  DEFAULT_MODEL_ID,
} from "../config";
import { getItem, getJSON, setJSON } from "../utils/storage";
import type { AIModelConfig, AIProvider } from "../core/types";

/** In-memory model list (seeded from storage cache / defaults, then refreshed). */
let available: AIModelConfig[] | null = null;

/**
 * Heuristic filter: keep usable text-chat models for the three vendors,
 * dropping batch/free and non-text-chat variants (image/audio/codex/etc).
 */
function isUsableTextModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (lower.includes(":batch") || lower.includes(":free")) return false;
  return !/(image|audio|video|embedding|realtime|customtools|codex|lyria|gemma|oss|reranker)/.test(
    lower,
  );
}

/** Validate and map an OpenRouter catalog entry into an AIModelConfig. */
function mapModel(entry: unknown): AIModelConfig | null {
  if (typeof entry !== "object" || entry === null) return null;
  const raw = entry as { id?: unknown; name?: unknown };
  if (typeof raw.id !== "string" || !raw.id) return null;
  const id = raw.id;
  const vendor = VENDOR_PREFIXES.find((v) => id.startsWith(v.prefix));
  if (!vendor) return null;
  if (!isUsableTextModel(id)) return null;
  return {
    provider: vendor.provider,
    model: id,
    displayName: typeof raw.name === "string" && raw.name ? raw.name : id,
  };
}

/** Parse the OpenRouter models payload into a filtered, sorted model list. */
function parseModels(data: unknown): AIModelConfig[] {
  if (typeof data !== "object" || data === null) return [];
  const list = (data as { data?: unknown }).data;
  if (!Array.isArray(list)) return [];

  const models: AIModelConfig[] = [];
  for (const entry of list) {
    const model = mapModel(entry);
    if (model) models.push(model);
  }

  // Stable order: vendor, then display name.
  const vendorOrder: Partial<Record<AIProvider, number>> = {
    gemini: 0,
    claude: 1,
    openai: 2,
  };
  models.sort(
    (a, b) =>
      (vendorOrder[a.provider] ?? 9) - (vendorOrder[b.provider] ?? 9) ||
      a.displayName.localeCompare(b.displayName),
  );
  return models;
}

/** Restore the model list from the storage cache (synchronous — used at boot). */
function restoreFromCache(): void {
  if (available) return;
  const cached = getJSON<AIModelConfig[]>(STORAGE_KEYS.modelsCache);
  available = Array.isArray(cached) && cached.length > 0 ? cached : DEFAULT_MODELS;
}

/**
 * Fetch the live OpenRouter model catalog (filtered to the three vendors).
 * Falls back to cache, then defaults. Never throws — returns whatever we have.
 */
export async function refreshModels(): Promise<AIModelConfig[]> {
  try {
    const res = await fetch(OPENROUTER_MODELS_URL);
    if (!res.ok) throw new Error(`OpenRouter catalog fetch failed (${res.status})`);
    const parsed = parseModels(await res.json());
    if (parsed.length > 0) {
      available = parsed;
      setJSON(STORAGE_KEYS.modelsCache, parsed);
      return parsed;
    }
  } catch {
    // Fall through to cache/defaults below.
  }
  restoreFromCache();
  return available ?? DEFAULT_MODELS;
}

/** The current model list (never awaited — boot-safe). */
export function getAvailableModels(): AIModelConfig[] {
  restoreFromCache();
  return available ?? DEFAULT_MODELS;
}

/** Look up a model by its OpenRouter id. */
export function getModelById(id: string): AIModelConfig | undefined {
  return getAvailableModels().find((m) => m.model === id);
}

/** The currently selected model (from saved id, else default). */
export function getActiveModel(): AIModelConfig {
  const saved = getItem(STORAGE_KEYS.activeModel);
  const id = saved?.trim() ? saved : DEFAULT_MODEL_ID;
  return getModelById(id) ?? DEFAULT_MODELS[0];
}
