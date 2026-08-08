import { callAI } from "./provider";
import { TOPIC_EXTRACTION_PROMPT, buildGraphContext } from "./prompts";
import { STORAGE_KEYS } from "../config";
import { getJSON, setJSON } from "../utils/storage";
import type {
  TopicExtractionResult,
  ExtractedTopic,
  TopicRelation,
  Cluster,
  StructuralGap,
  AIModelConfig,
} from "../core/types";

/** Cache key based on text hash + length to reduce collision risk. */
function getCacheKey(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return `topics_${hash}_${text.length}`;
}

/** Get cached topic extraction result. */
export function getCachedTopics(text: string): TopicExtractionResult | null {
  const cache = getJSON<Record<string, TopicExtractionResult>>(
    STORAGE_KEYS.topicCache,
  );
  if (!cache) return null;
  const key = getCacheKey(text);
  return cache[key] ?? null;
}

/** Cache topic extraction result. */
function cacheTopics(text: string, result: TopicExtractionResult): void {
  const cache =
    getJSON<Record<string, TopicExtractionResult>>(STORAGE_KEYS.topicCache) ??
    {};
  const key = getCacheKey(text);
  cache[key] = result;
  // Keep cache size reasonable (max 10 entries)
  const keys = Object.keys(cache);
  if (keys.length > 10) {
    delete cache[keys[0]];
  }
  setJSON(STORAGE_KEYS.topicCache, cache);
}

/** Extract topics from the knowledge graph using LLM. */
export async function extractTopics(
  clusters: Cluster[],
  gaps: StructuralGap[],
  topKeywords: string[],
  model: AIModelConfig,
  rawText: string,
  signal?: AbortSignal,
): Promise<TopicExtractionResult> {
  // Check cache first
  const cached = getCachedTopics(rawText);
  if (cached) return cached;

  // Build context for LLM
  const context = buildGraphContext(clusters, gaps, topKeywords);

  // Add sample text excerpts for better topic understanding
  const textSample =
    rawText.length > 2000 ? rawText.slice(0, 2000) + "..." : rawText;

  const userMessage = `${context}\n\n## Sample Text\n${textSample}\n\nExtract the main topics and their relationships from this knowledge graph.`;

  const response = await callAI(
    model.model,
    [
      { role: "system", content: TOPIC_EXTRACTION_PROMPT },
      { role: "user", content: userMessage },
    ],
    0.3, // Lower temperature for more consistent JSON
    4096, // Enough tokens for complex topic structures
    signal,
  );

  // Parse JSON response
  const result = parseTopicResponse(response.content);

  // Cache result
  cacheTopics(rawText, result);

  return result;
}

/** Parse LLM response into TopicExtractionResult. */
function parseTopicResponse(content: string): TopicExtractionResult {
  // Try multiple methods to extract JSON from response
  let jsonStr = content;

  // Method 1: Look for ```json ... ``` code block
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1];
  } else {
    // Method 2: Look for any ``` ... ``` code block
    const codeBlockMatch = content.match(/```\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    } else {
      // Method 3: Look for JSON object pattern { ... }
      const jsonObjMatch = content.match(/\{[\s\S]*"topics"[\s\S]*\}/s);
      if (jsonObjMatch) {
        jsonStr = jsonObjMatch[0];
      }
    }
  }

  try {
    const parsed = JSON.parse(jsonStr.trim());

    // Validate and normalize topics
    const topics: ExtractedTopic[] = (parsed.topics ?? []).map(
      (t: Partial<ExtractedTopic>, i: number) => ({
        id: t.id ?? `topic_${i + 1}`,
        label: t.label ?? `Topic ${i + 1}`,
        description: t.description ?? "",
        keywords: Array.isArray(t.keywords) ? t.keywords : [],
        weight:
          typeof t.weight === "number"
            ? Math.max(0.1, Math.min(1, t.weight))
            : 0.5,
      }),
    );

    if (topics.length === 0) {
      console.warn(
        "Topic extraction returned no topics. Response:",
        content.slice(0, 500),
      );
    }

    // Validate and normalize relations
    const relations: TopicRelation[] = (parsed.relations ?? [])
      .filter(
        (r: Partial<TopicRelation>) =>
          r.source &&
          r.target &&
          topics.some((t) => t.id === r.source) &&
          topics.some((t) => t.id === r.target),
      )
      .map((r: Partial<TopicRelation>) => ({
        source: r.source!,
        target: r.target!,
        strength:
          typeof r.strength === "number"
            ? Math.max(0.1, Math.min(1, r.strength))
            : 0.5,
        description: r.description ?? "",
      }));

    console.log(
      `Topic extraction: ${topics.length} topics, ${relations.length} relations`,
    );
    return { topics, relations };
  } catch (err) {
    console.error("Failed to parse topic extraction response:", err);
    console.error("Raw response (first 1000 chars):", content.slice(0, 1000));
    console.error("Attempted to parse:", jsonStr.slice(0, 500));
    return { topics: [], relations: [] };
  }
}

/** Clear topic cache. */
export function clearTopicCache(): void {
  setJSON(STORAGE_KEYS.topicCache, {});
}
