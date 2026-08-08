/* ── Graph Types ── */

export type NodeType = "keyword" | "folder" | "topic";

export type CompareSource = "a" | "b" | "both";

export type GraphNode = {
  id: string;
  label: string;
  /** Number of times this word appears. */
  frequency: number;
  /** Degree centrality: number of connections. */
  degree: number;
  /** Betweenness centrality score (0–1). */
  betweenness: number;
  /** Community / cluster index assigned by Louvain. */
  community: number;
  /** Average sentiment score of excerpts (-5 to +5). */
  sentiment: number;
  /** Sentences where this word appears. */
  excerpts: string[];
  /** Node type: keyword (default) or folder. */
  nodeType?: NodeType;
  /** For folder nodes: number of files in the folder. */
  fileCount?: number;
  /** For folder nodes: path relative to upload root. */
  folderPath?: string;
  /** Compare mode: which text this node belongs to. */
  compareSource?: CompareSource;
  /** D3 simulation positions. */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

export type GraphEdge = {
  source: string | GraphNode;
  target: string | GraphNode;
  /** Co-occurrence weight. */
  weight: number;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type Cluster = {
  id: number;
  color: string;
  nodes: GraphNode[];
  /** Top keywords by degree centrality within the cluster. */
  topKeywords: string[];
  /** AI-generated label for this cluster. */
  label?: string;
};

export type StructuralGap = {
  /** The two clusters that are weakly connected. */
  clusterA: number;
  clusterB: number;
  /** Bridge nodes that could connect them. */
  bridgeNodes: GraphNode[];
  /** Suggested bridging concepts (AI-generated). */
  suggestions?: string[];
};

/* ── Source Metadata ── */

export type SourceType = "url" | "youtube" | "rss" | "image" | "file" | "text";

export type SourceMeta = {
  type: SourceType;
  url?: string;
  title?: string;
  thumbnail?: string;
  /** YouTube video ID for direct thumbnail access. */
  videoId?: string;
  /** Domain extracted from URL. */
  domain?: string;
  /** Timestamp when imported. */
  importedAt: number;
};

export type SourceBlock = {
  /** Start character index in rawText. */
  start: number;
  /** End character index in rawText. */
  end: number;
  /** Source metadata for this text block. */
  meta: SourceMeta;
};

/* ── NLP Types ── */

export type CoOccurrence = {
  wordA: string;
  wordB: string;
  weight: number;
};

export type NLPResult = {
  tokens: string[];
  sentences: string[];
  coOccurrences: CoOccurrence[];
  wordFrequency: Map<string, number>;
  /** Maps a word to the sentences it appears in. */
  wordSentences: Map<string, string[]>;
};

/* ── AI Types ── */

export type AIProvider = "gemini" | "claude" | "openai" | "openrouter";

export type AIModelConfig = {
  provider: AIProvider;
  model: string;
  displayName: string;
};

export type AIMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type AIRequestOptions = {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type AIResponse = {
  content: string;
  provider: AIProvider;
  model: string;
};

export type AnalysisResult = {
  summary: string;
  researchQuestions: string[];
  insights: string[];
  innovativeIdeas: string[];
  facts: string[];
};

/* ── Sentiment Types ── */

export type SentimentLabel = "positive" | "negative" | "neutral";

export type SentimentScore = {
  sentence: string;
  score: number;
  label: SentimentLabel;
};

export type SentimentResult = {
  scores: SentimentScore[];
  distribution: { positive: number; negative: number; neutral: number };
};

/* ── Peel the Onion ── */

export type PeelLayer = {
  /** Node IDs removed in this layer. */
  removedIds: string[];
  /** Node labels for breadcrumb display. */
  removedLabels: string[];
  /** Peel depth (1-based). */
  depth: number;
};

/* ── Graph Statistics ── */

export type GraphStats = {
  nodeCount: number;
  edgeCount: number;
  density: number;
  modularity: number;
  avgPathLength: number;
  clusteringCoeff: number;
  diameter: number;
  diversityScore: number;
};

/* ── Trend Tracking ── */

export type TextSnapshot = {
  text: string;
  timestamp: number;
  keywordFreqs: Map<string, number>;
};

/* ── Folder Parsing ── */

export type ParsedFolder = {
  /** Folder name (last segment of path). */
  name: string;
  /** Full relative path from upload root. */
  path: string;
  /** Files directly in this folder. */
  files: File[];
  /** Subfolders. */
  children: ParsedFolder[];
  /** Concatenated text content from all files in this folder. */
  text: string;
};

/* ── App State ── */

/* ── Topic Graph Types ── */

export type ExtractedTopic = {
  id: string;
  label: string;
  description: string;
  /** Keywords from the keyword graph that belong to this topic. */
  keywords: string[];
  /** Importance/weight of this topic (0-1). */
  weight: number;
};

export type TopicRelation = {
  source: string;
  target: string;
  /** Relationship strength (0-1). */
  strength: number;
  /** Description of how topics relate. */
  description: string;
};

export type TopicExtractionResult = {
  topics: ExtractedTopic[];
  relations: TopicRelation[];
};

/* ── App State ── */

export type AppState = {
  rawText: string;
  nlpResult: NLPResult | null;
  graphData: GraphData | null;
  /** Topic-based graph data (LLM-generated). */
  topicGraphData: GraphData | null;
  /** Raw topic extraction result from LLM. */
  topicExtractionResult: TopicExtractionResult | null;
  clusters: Cluster[];
  gaps: StructuralGap[];
  graphStats: GraphStats | null;
  sentimentResult: SentimentResult | null;
  textSnapshots: TextSnapshot[];
  selectedNodes: Set<string>;
  excludedNodes: Set<string>;
  /** Stack of peeled layers for progressive concept removal. */
  peelLayers: PeelLayer[];
  activePanel: "input" | "analysis" | "chat" | "settings" | "help";
  activeModel: AIModelConfig;
  chatHistory: AIMessage[];
  isProcessing: boolean;
  /** Source metadata blocks tracking where text came from. */
  sourceBlocks: SourceBlock[];
};
