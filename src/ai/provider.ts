import { OPENROUTER_ENDPOINT, AI_TEMPERATURE, AI_MAX_TOKENS } from "../config";
import type {
  AIMessage,
  AIProvider,
  AIRequestOptions,
  AIResponse,
} from "../core/types";
import { getApiKey } from "./key-store";

/** Infer the vendor label from an OpenRouter model id (e.g. "google/x" → "gemini"). */
function vendorFromModel(model: string): AIProvider {
  if (model.startsWith("google/")) return "gemini";
  if (model.startsWith("anthropic/")) return "claude";
  return "openai";
}

/** Send a request to OpenRouter (OpenAI-compatible chat completions API). */
async function callOpenRouter(
  model: string,
  options: AIRequestOptions,
  signal?: AbortSignal,
): Promise<string> {
  const key = getApiKey("openrouter");
  if (!key) throw new Error("OpenRouter API key not configured");

  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      // Identify the app to OpenRouter (optional).
      "HTTP-Referer": typeof location !== "undefined" ? location.href : "",
      "X-Title": "Clustr",
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? AI_TEMPERATURE,
      max_tokens: options.maxTokens ?? AI_MAX_TOKENS,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Check if an HTTP status code is retryable. */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Call with a single retry for transient errors. */
async function withRetry(
  fn: () => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await fn();
  } catch (err) {
    // Don't retry aborted requests
    if (signal?.aborted) throw err;
    // Only retry on retryable HTTP errors
    const msg = (err as Error).message ?? "";
    const statusMatch = msg.match(/\((\d{3})\)/);
    if (statusMatch && isRetryable(Number(statusMatch[1]))) {
      await new Promise((r) => setTimeout(r, 1000));
      return fn();
    }
    throw err;
  }
}

/** Send a chat request — always routed through OpenRouter. */
export async function callAI(
  model: string,
  messages: AIMessage[],
  temperature?: number,
  maxTokens?: number,
  signal?: AbortSignal,
): Promise<AIResponse> {
  const options: AIRequestOptions = { messages, temperature, maxTokens };
  const content = await withRetry(
    () => callOpenRouter(model, options, signal),
    signal,
  );
  return { content, provider: vendorFromModel(model), model };
}
