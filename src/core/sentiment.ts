import {
  SENTIMENT_POSITIVE_THRESHOLD,
  SENTIMENT_NEGATIVE_THRESHOLD,
} from "../config";
import type { SentimentScore, SentimentResult, SentimentLabel } from "./types";
import _AFINN from "./sentiment-lexicon.json";

const AFINN = _AFINN as Record<string, number>;

/** Score a single sentence. */
function scoreSentence(sentence: string): number {
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/);
  let total = 0;
  let scored = 0;
  for (const word of words) {
    const val = AFINN[word];
    if (val !== undefined) {
      total += val;
      scored++;
    }
  }
  return scored > 0 ? total / scored : 0;
}

/** Classify a score into a sentiment label. */
function classify(score: number): SentimentLabel {
  if (score > SENTIMENT_POSITIVE_THRESHOLD) return "positive";
  if (score < SENTIMENT_NEGATIVE_THRESHOLD) return "negative";
  return "neutral";
}

/** Analyze sentiment for a list of sentences. */
export function analyzeSentiment(sentences: string[]): SentimentResult {
  const scores: SentimentScore[] = sentences.map((sentence) => {
    const score = scoreSentence(sentence);
    return { sentence, score, label: classify(score) };
  });

  let positive = 0;
  let negative = 0;
  let neutral = 0;
  for (const s of scores) {
    if (s.label === "positive") positive++;
    else if (s.label === "negative") negative++;
    else neutral++;
  }

  return { scores, distribution: { positive, negative, neutral } };
}

/** Compute average sentiment for a node from a pre-built sentence→score map. */
export function computeNodeSentiment(
  excerpts: string[],
  scoreMap: Map<string, number>,
): number {
  let total = 0;
  let count = 0;
  for (const excerpt of excerpts) {
    const score = scoreMap.get(excerpt);
    if (score !== undefined) {
      total += score;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}
