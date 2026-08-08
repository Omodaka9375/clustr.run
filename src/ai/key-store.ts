import { STORAGE_KEYS } from "../config";
import type { AIProvider } from "../core/types";
import { getItem, setItem, removeItem } from "../utils/storage";

const KEY_MAP: Record<AIProvider, string> = {
  openrouter: STORAGE_KEYS.openrouterKey,
  gemini: STORAGE_KEYS.openrouterKey,
  claude: STORAGE_KEYS.openrouterKey,
  openai: STORAGE_KEYS.openrouterKey,
};

/** Get an API key for a provider. Returns null if not set. */
export function getApiKey(provider: AIProvider): string | null {
  return getItem(KEY_MAP[provider]);
}

/** Save an API key for a provider. */
export function setApiKey(provider: AIProvider, key: string): void {
  setItem(KEY_MAP[provider], key);
}

/** Remove an API key for a provider. */
export function clearApiKey(provider: AIProvider): void {
  removeItem(KEY_MAP[provider]);
}

/** Check if a provider has a configured key. */
export function hasApiKey(provider: AIProvider): boolean {
  const key = getApiKey(provider);
  return key !== null && key.length > 0;
}
