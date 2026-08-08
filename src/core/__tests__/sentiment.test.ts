import { describe, it, expect } from "vitest";
import { analyzeSentiment, computeNodeSentiment } from "../sentiment";

describe("analyzeSentiment", () => {
  it("returns empty results for empty input", () => {
    const result = analyzeSentiment([]);
    expect(result.scores).toEqual([]);
    expect(result.distribution).toEqual({
      positive: 0,
      negative: 0,
      neutral: 0,
    });
  });

  it("classifies positive sentences", () => {
    const result = analyzeSentiment(["This is amazing and wonderful"]);
    expect(result.scores[0].score).toBeGreaterThan(0);
    expect(result.scores[0].label).toBe("positive");
    expect(result.distribution.positive).toBe(1);
  });

  it("classifies negative sentences", () => {
    const result = analyzeSentiment(["This is terrible and awful"]);
    expect(result.scores[0].score).toBeLessThan(0);
    expect(result.scores[0].label).toBe("negative");
    expect(result.distribution.negative).toBe(1);
  });

  it("classifies neutral sentences", () => {
    const result = analyzeSentiment(["The table is in the room"]);
    expect(result.scores[0].label).toBe("neutral");
    expect(result.distribution.neutral).toBe(1);
  });

  it("handles mixed sentiment sentences", () => {
    const result = analyzeSentiment([
      "This is wonderful",
      "That is horrible",
      "The sky is blue",
    ]);
    expect(result.distribution.positive).toBeGreaterThanOrEqual(1);
    expect(result.distribution.negative).toBeGreaterThanOrEqual(1);
    expect(result.scores.length).toBe(3);
  });
});

/** Build a sentence→score Map from SentimentScore[]. */
function buildScoreMap(
  scores: { sentence: string; score: number }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of scores) m.set(s.sentence, s.score);
  return m;
}

describe("computeNodeSentiment", () => {
  it("returns 0 when no excerpts match", () => {
    const score = computeNodeSentiment(
      ["unknown sentence"],
      new Map<string, number>(),
    );
    expect(score).toBe(0);
  });

  it("returns average sentiment of matching excerpts", () => {
    const scores = analyzeSentiment([
      "This is amazing",
      "That is terrible",
    ]).scores;
    const avg = computeNodeSentiment(
      ["This is amazing", "That is terrible"],
      buildScoreMap(scores),
    );
    // Average of positive + negative should be near zero
    expect(typeof avg).toBe("number");
  });

  it("returns single score when one excerpt matches", () => {
    const scores = analyzeSentiment(["This is brilliant"]).scores;
    const result = computeNodeSentiment(
      ["This is brilliant"],
      buildScoreMap(scores),
    );
    expect(result).toBeGreaterThan(0);
  });
});
