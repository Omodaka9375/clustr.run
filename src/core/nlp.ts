import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";
import {
  CO_OCCURRENCE_WINDOW,
  MIN_WORD_LENGTH,
  MIN_WORD_FREQUENCY,
} from "../config";
import type { CoOccurrence, NLPResult } from "./types";
import { detectLanguage, getStopwords } from "./stopwords";
import type { LanguageCode } from "./stopwords";

/* Initialize wink-nlp engine (runs once at module load). */
const nlp = winkNLP(model);
const its = nlp.its;

/* ═══════════════════════════════════════
 *  Constants
 * ═══════════════════════════════════════ */

/** Minimum raw co-occurrence count before PMI is computed. */
const MIN_RAW_COOCCURRENCE = 1;

/** Regex for pure-number tokens (e.g. "2024", "100"). */
const NUMERIC_ONLY = /^\d+$/;

/* ── Stopwords (lemma / base forms) ──
 * Inflected forms ("said"→"say", "systems"→"system") are
 * caught automatically via the lemmatization step.           */
const STOPWORDS = new Set([
  // Determiners, articles, pronouns
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "i",
  "me",
  "my",
  "he",
  "him",
  "his",
  "she",
  "her",
  "it",
  "its",
  "we",
  "our",
  "us",
  "they",
  "them",
  "their",
  "you",
  "your",
  "who",
  "whom",
  "which",
  "what",
  "whose",
  "something",
  "anything",
  "nothing",
  "everything",
  "someone",
  "anyone",
  "everyone",
  "nobody",
  "none",
  "whatever",
  "whoever",
  // Prepositions, conjunctions, particles
  "of",
  "in",
  "to",
  "for",
  "with",
  "without",
  "on",
  "at",
  "from",
  "by",
  "as",
  "into",
  "through",
  "between",
  "among",
  "within",
  "during",
  "since",
  "until",
  "against",
  "along",
  "across",
  "around",
  "above",
  "below",
  "beside",
  "beyond",
  "toward",
  "towards",
  "upon",
  "after",
  "before",
  "about",
  "near",
  "off",
  "per",
  "via",
  "up",
  "out",
  "down",
  "away",
  "if",
  "or",
  "and",
  "but",
  "so",
  "not",
  "no",
  "nor",
  "yet",
  "both",
  "either",
  "neither",
  "than",
  "then",
  "when",
  "where",
  "while",
  "although",
  "though",
  "unless",
  "whether",
  "because",
  "however",
  "therefore",
  "thus",
  "hence",
  "otherwise",
  "instead",
  "meanwhile",
  "furthermore",
  "moreover",
  "nevertheless",
  "how",
  // Be / have / do / modals
  "be",
  "is",
  "am",
  "are",
  "was",
  "were",
  "been",
  "being",
  "have",
  "has",
  "had",
  "having",
  "do",
  "does",
  "did",
  "doing",
  "done",
  "will",
  "would",
  "shall",
  "should",
  "can",
  "could",
  "may",
  "might",
  "must",
  "need",
  "ought",
  // Light verbs (base forms)
  "get",
  "go",
  "come",
  "make",
  "take",
  "give",
  "say",
  "know",
  "think",
  "see",
  "look",
  "want",
  "use",
  "find",
  "tell",
  "ask",
  "put",
  "keep",
  "seem",
  "feel",
  "try",
  "start",
  "happen",
  "become",
  "bring",
  "turn",
  "hold",
  "leave",
  "begin",
  "mean",
  "remain",
  "continue",
  "appear",
  "tend",
  "let",
  "set",
  "run",
  "move",
  "help",
  "allow",
  "add",
  "call",
  "show",
  "spend",
  "pay",
  "send",
  "receive",
  "play",
  "read",
  "write",
  "open",
  "close",
  "change",
  "follow",
  "stop",
  "pass",
  "form",
  "serve",
  "include",
  "suggest",
  "consider",
  "create",
  "provide",
  "offer",
  "raise",
  "lead",
  "live",
  "lose",
  "win",
  "grow",
  "reach",
  "meet",
  "learn",
  "expect",
  "require",
  "report",
  "decide",
  "produce",
  "describe",
  "develop",
  "agree",
  "understand",
  "involve",
  "cause",
  "warn",
  "argue",
  "claim",
  "believe",
  "note",
  "point",
  "state",
  "advocate",
  "predict",
  "fear",
  "worry",
  "view",
  // Light / generic nouns
  "thing",
  "stuff",
  "lot",
  "kind",
  "sort",
  "bit",
  "rest",
  "sense",
  "matter",
  "reason",
  "result",
  "fact",
  "point",
  "case",
  "example",
  "type",
  "part",
  "side",
  "end",
  "step",
  "way",
  "place",
  "area",
  "level",
  "state",
  "group",
  "number",
  "order",
  "form",
  "line",
  "hand",
  "head",
  "home",
  "room",
  "term",
  "name",
  "amount",
  "piece",
  "rate",
  "role",
  "view",
  // Adverbs / misc function words
  "also",
  "just",
  "even",
  "still",
  "very",
  "much",
  "more",
  "most",
  "well",
  "now",
  "here",
  "there",
  "only",
  "already",
  "again",
  "back",
  "over",
  "too",
  "often",
  "never",
  "always",
  "sometimes",
  "perhaps",
  "quite",
  "rather",
  "really",
  "almost",
  "enough",
  "likely",
  "simply",
  "usually",
  "actually",
  "especially",
  "particularly",
  "certainly",
  "probably",
  "generally",
  "quickly",
  "recently",
  "finally",
  // Quantifiers, ordinals, generic adjectives
  "some",
  "any",
  "all",
  "each",
  "every",
  "own",
  "other",
  "another",
  "such",
  "same",
  "new",
  "old",
  "good",
  "bad",
  "great",
  "big",
  "small",
  "large",
  "little",
  "long",
  "short",
  "high",
  "low",
  "early",
  "late",
  "young",
  "real",
  "right",
  "able",
  "whole",
  "next",
  "last",
  "different",
  "important",
  "several",
  "certain",
  "possible",
  "particular",
  "available",
  "full",
  "sure",
  "true",
  "clear",
  "major",
  "second",
  "third",
  "first",
  "one",
  "two",
  "three",
  "four",
  "five",
  "like",
  "time",
  "year",
  "day",
  "week",
  "month",
  "today",
  "people",
  "person",
  "man",
  "woman",
  "child",
  "work",
  "few",
  "many",
  // Prefix fragments (from hyphenated words like non-reversible, pre-existing)
  "non",
  "pre",
  "pro",
  "anti",
  "semi",
  "multi",
  "sub",
  "super",
  "inter",
  "intra",
  "extra",
  "ultra",
  "mega",
  "mini",
  "micro",
  "macro",
  "pseudo",
  "quasi",
  "self",
  "cross",
  "counter",
  "under",
  "over",
  "out",
  "mid",
  "co",
  "re",
  "de",
  "un",
  "dis",
  "mis",
  "ex",
]);

/** POS tags that can form noun phrases (adjective + head nouns). */
const NP_MEMBER_POS = new Set(["NOUN", "PROPN", "ADJ"]);

/** POS tags that can terminate (head) a noun phrase. */
const NP_HEAD_POS = new Set(["NOUN", "PROPN"]);

/** POS tags to keep as single-word terms. */
const KEEP_SINGLE_POS = new Set(["NOUN", "PROPN", "VERB"]);

/** NER types to extract as named terms. */
const KEEP_ENTITY_TYPES = new Set(["PERSON", "ORGANIZATION", "PLACE"]);

/* ═══════════════════════════════════════
 *  Sentence splitting
 * ═══════════════════════════════════════ */

function splitSentences(text: string): string[] {
  const doc = nlp.readDoc(text);
  return doc
    .sentences()
    .out()
    .filter((s: string) => s.trim().length > 0);
}

/* ═══════════════════════════════════════
 *  Tokenizer (with lemmatization)
 * ═══════════════════════════════════════ */

/** Active stopword set (English base + detected language). */
let activeStopwords = STOPWORDS;

/** Merge English stopwords with another language's stopwords. */
function setActiveLanguage(lang: LanguageCode): void {
  if (lang === "en") {
    activeStopwords = STOPWORDS;
    return;
  }
  const extra = getStopwords(lang);
  activeStopwords = new Set([...STOPWORDS, ...extra]);
}

/** Check if a word is an inflected form of a stopword (e.g. spending→spend). */
function isInflectedStopword(word: string): boolean {
  // -ing (spending, providing, including)
  if (word.endsWith("ing") && word.length > 5) {
    const base1 = word.slice(0, -3); // "spend"
    const base2 = word.slice(0, -3) + "e"; // "provid" → "provide"
    if (activeStopwords.has(base1) || activeStopwords.has(base2)) return true;
  }
  // -s / -es (spends, changes, produces)
  if (word.endsWith("es") && word.length > 4) {
    const base = word.slice(0, -2); // "produc" → nope, but "change" → nope
    const baseE = word.slice(0, -1); // "produce"
    if (activeStopwords.has(base) || activeStopwords.has(baseE)) return true;
  } else if (word.endsWith("s") && word.length > 4) {
    if (activeStopwords.has(word.slice(0, -1))) return true;
  }
  // -ed (created, reported, involved)
  if (word.endsWith("ed") && word.length > 4) {
    const base1 = word.slice(0, -2); // "involv"
    const base2 = word.slice(0, -1); // "involve"
    const base3 = word.slice(0, -2) + "e"; // "create"
    if (
      activeStopwords.has(base1) ||
      activeStopwords.has(base2) ||
      activeStopwords.has(base3)
    )
      return true;
  }
  return false;
}

/** Extract meaningful, lemmatized terms from a sentence. */
function tokenize(sentence: string): string[] {
  const doc = nlp.readDoc(sentence);
  const terms: string[] = [];
  const seen = new Set<string>();

  // Batch-extract token properties for efficiency
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poses = doc.tokens().out(its.pos as any) as string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lemmas = doc.tokens().out(its.lemma as any) as string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normals = doc.tokens().out(its.normal as any) as string[];

  // 1. Multi-word noun phrases (sequences of ADJ/NOUN/PROPN ending in NOUN/PROPN)
  let phraseWords: string[] = [];
  let hasHead = false;
  for (let i = 0; i < poses.length; i++) {
    if (NP_MEMBER_POS.has(poses[i])) {
      phraseWords.push(lemmas[i] || normals[i]);
      if (NP_HEAD_POS.has(poses[i])) hasHead = true;
    } else {
      if (hasHead && phraseWords.length >= 2) {
        const phrase = normalizePhrase(phraseWords.join(" "));
        if (phrase && phrase.includes(" ") && !seen.has(phrase)) {
          seen.add(phrase);
          terms.push(phrase);
        }
      }
      phraseWords = [];
      hasHead = false;
    }
  }
  if (hasHead && phraseWords.length >= 2) {
    const phrase = normalizePhrase(phraseWords.join(" "));
    if (phrase && phrase.includes(" ") && !seen.has(phrase)) {
      seen.add(phrase);
      terms.push(phrase);
    }
  }

  // 2. Named entities (PERSON, ORGANIZATION, PLACE)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = doc.entities().out(its.detail as any) as Array<{
    value: string;
    type: string;
  }>;
  for (const ent of entities) {
    if (!KEEP_ENTITY_TYPES.has(ent.type)) continue;
    const phrase = normalizePhrase(ent.value);
    if (phrase && !seen.has(phrase)) {
      seen.add(phrase);
      terms.push(phrase);
    }
  }

  // 3. Single-word nouns, proper nouns, and verbs
  for (let i = 0; i < poses.length; i++) {
    if (!KEEP_SINGLE_POS.has(poses[i])) continue;
    const lemma = lemmas[i] || normals[i];
    const word = lemma
      .toLowerCase()
      .replace(/[^\p{L}\p{N}'-]/gu, "")
      .replace(/^['-]+|['-]+$/g, "");

    if (word.length < MIN_WORD_LENGTH) continue;
    if (seen.has(word)) continue;
    if (NUMERIC_ONLY.test(word)) continue;

    const processed = processHyphenatedWord(word);
    if (!processed) continue;
    if (activeStopwords.has(processed)) continue;
    if (isInflectedStopword(processed)) continue;

    seen.add(processed);
    terms.push(processed);
  }

  return terms;
}

/**
 * Process a hyphenated word: keep it whole if meaningful, otherwise extract the good part.
 * Returns null if the word should be skipped entirely.
 */
function processHyphenatedWord(word: string): string | null {
  if (!word.includes("-")) return word;

  const parts = word.split("-").filter((p) => p.length > 0);
  if (parts.length < 2) return word;

  // Check if all parts are meaningful (not stopwords/prefixes)
  const meaningfulParts = parts.filter(
    (p) => p.length >= MIN_WORD_LENGTH && !activeStopwords.has(p),
  );

  // If all parts are meaningful, keep the compound (e.g. "double-spending")
  if (meaningfulParts.length === parts.length) {
    return word;
  }

  // If only one part is meaningful, return just that part
  if (meaningfulParts.length === 1) {
    return meaningfulParts[0];
  }

  // If multiple parts are meaningful but some aren't, join the meaningful ones
  if (meaningfulParts.length > 1) {
    return meaningfulParts.join("-");
  }

  // No meaningful parts
  return null;
}

/** Max words in a multi-word phrase. */
const MAX_PHRASE_WORDS = 4;

/** Normalize a phrase: lowercase, trim, strip stopwords from edges. */
function normalizePhrase(raw: string): string {
  let phrase = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^['-]+|['-]+$/g, "");

  // Strip stopwords from leading and trailing edges
  // e.g. "majority of cpu power control" → "cpu power control"
  // e.g. "more cpu power" → "cpu power"
  if (phrase.includes(" ")) {
    const words = phrase.split(" ");
    // Trim leading stopwords
    while (words.length > 0 && isStopOrInflected(words[0])) words.shift();
    // Trim trailing stopwords
    while (words.length > 0 && isStopOrInflected(words[words.length - 1]))
      words.pop();
    // Limit to max phrase length
    if (words.length > MAX_PHRASE_WORDS) {
      return ""; // Skip overly long phrases
    }
    phrase = words.join(" ");
  }

  if (phrase.length < MIN_WORD_LENGTH) return "";
  if (activeStopwords.has(phrase)) return "";
  // All remaining words are stopwords → skip
  if (
    phrase.includes(" ") &&
    phrase.split(" ").every((w) => isStopOrInflected(w))
  )
    return "";
  return phrase;
}

/** Check if a single word is a stopword or inflected stopword. */
function isStopOrInflected(word: string): boolean {
  return activeStopwords.has(word) || isInflectedStopword(word);
}

/* ═══════════════════════════════════════
 *  Sub-phrase absorption
 * ═══════════════════════════════════════ */

/** Remove single words already present inside a multi-word phrase. */
function absorbSubPhrases(terms: string[]): string[] {
  const multiWord = terms.filter((t) => t.includes(" "));
  if (multiWord.length === 0) return terms;
  const absorbed = new Set<string>();
  for (const mw of multiWord) {
    for (const word of mw.split(" ")) absorbed.add(word);
  }
  return terms.filter((t) => t.includes(" ") || !absorbed.has(t));
}

/* ═══════════════════════════════════════
 *  Fragment filter
 * ═══════════════════════════════════════ */

/** Max length of a token considered a potential fragment. */
const FRAGMENT_MAX_LEN = 4;

/** Min number of other tokens a short token must appear in to be discarded. */
const FRAGMENT_MIN_HOSTS = 3;

/** Remove short tokens that are substrings of many longer surviving tokens. */
function filterFragments(keepTerms: Set<string>): void {
  const shorts: string[] = [];
  const longs: string[] = [];
  for (const t of keepTerms) {
    if (!t.includes(" ") && t.length <= FRAGMENT_MAX_LEN) shorts.push(t);
    else if (t.length > FRAGMENT_MAX_LEN) longs.push(t);
  }
  for (const s of shorts) {
    let hosts = 0;
    for (const l of longs) {
      if (l.includes(s)) {
        hosts++;
        if (hosts >= FRAGMENT_MIN_HOSTS) {
          keepTerms.delete(s);
          break;
        }
      }
    }
  }
}

/* ═══════════════════════════════════════
 *  Co-occurrence pairs
 * ═══════════════════════════════════════ */

function buildCoOccurrencePairs(
  tokens: string[],
  window: number,
): Map<string, number> {
  const pairs = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < Math.min(i + window, tokens.length); j++) {
      const a = tokens[i];
      const b = tokens[j];
      if (a === b) continue;
      const key = a < b ? `${a}||${b}` : `${b}||${a}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  return pairs;
}

/* ═══════════════════════════════════════
 *  Main pipeline
 * ═══════════════════════════════════════ */

/** Process raw text into NLP results. */
export function processText(text: string): NLPResult {
  // Auto-detect language and load appropriate stopwords
  const detectedLang = detectLanguage(text);
  setActiveLanguage(detectedLang);

  const sentences = splitSentences(text);

  // ── Pass 1: tokenize, absorb sub-phrases, count frequencies ──
  const sentenceTokens: string[][] = [];
  const wordFrequency = new Map<string, number>();
  const wordSentences = new Map<string, string[]>();

  for (const sentence of sentences) {
    const raw = tokenize(sentence);
    const tokens = absorbSubPhrases(raw);
    sentenceTokens.push(tokens);

    for (const token of tokens) {
      wordFrequency.set(token, (wordFrequency.get(token) ?? 0) + 1);
      const existing = wordSentences.get(token) ?? [];
      if (!existing.includes(sentence)) existing.push(sentence);
      wordSentences.set(token, existing);
    }
  }

  // ── Filter: keep terms above minimum frequency ──
  const keepTerms = new Set<string>();
  for (const [word, freq] of wordFrequency) {
    if (freq >= MIN_WORD_FREQUENCY) keepTerms.add(word);
  }

  // ── Fragment filter: reject tiny tokens that are substrings of many others ──
  filterFragments(keepTerms);

  // ── Pass 2: co-occurrence with surviving terms + PMI ──
  const allTokens: string[] = [];
  const globalPairs = new Map<string, number>();

  for (const tokens of sentenceTokens) {
    const filtered = tokens.filter((t) => keepTerms.has(t));
    allTokens.push(...filtered);

    const pairs = buildCoOccurrencePairs(filtered, CO_OCCURRENCE_WINDOW);
    for (const [key, count] of pairs) {
      globalPairs.set(key, (globalPairs.get(key) ?? 0) + count);
    }
  }

  // Compute Pointwise Mutual Information for each qualifying pair
  const totalTokens = allTokens.length;
  const coOccurrences: CoOccurrence[] = [];

  if (totalTokens > 0) {
    for (const [key, rawCount] of globalPairs) {
      if (rawCount < MIN_RAW_COOCCURRENCE) continue;

      const [wordA, wordB] = key.split("||");
      const freqA = wordFrequency.get(wordA) ?? 1;
      const freqB = wordFrequency.get(wordB) ?? 1;

      // PMI = log2( count(a,b) × N / (count(a) × count(b)) )
      const pmi = Math.log2((rawCount * totalTokens) / (freqA * freqB));
      if (pmi <= 0) continue; // keep only positive associations

      coOccurrences.push({ wordA, wordB, weight: pmi });
    }
  }

  // Prune maps to surviving terms only
  for (const key of [...wordFrequency.keys()]) {
    if (!keepTerms.has(key)) {
      wordFrequency.delete(key);
      wordSentences.delete(key);
    }
  }

  return {
    tokens: allTokens,
    sentences,
    coOccurrences,
    wordFrequency,
    wordSentences,
  };
}
