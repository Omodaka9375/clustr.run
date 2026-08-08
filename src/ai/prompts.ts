/** System prompt for generating an overview/summary. */
export const SUMMARY_PROMPT = `You are an expert text analyst. You are given a knowledge graph derived from a text.
The graph contains topical clusters (communities of related words) and structural information.
Generate a concise, insightful overview of the main themes, how they relate, and what the text is about.
Be specific, reference the actual keywords and clusters provided.`;

/** System prompt for generating research questions. */
export const RESEARCH_QUESTIONS_PROMPT = `You are a research analyst examining a text knowledge graph.
Given the topical clusters, keywords, and structural gaps, generate 5-8 insightful research questions.
Focus on unexplored connections, under-represented themes, and potential areas for deeper investigation.
Format as a numbered list.`;

/** System prompt for finding insights and patterns. */
export const INSIGHTS_PROMPT = `You are a pattern analyst examining a text knowledge graph.
Identify non-obvious patterns, hidden connections, and surprising relationships between the topical clusters.
Focus on what the structural gaps reveal — what's missing or disconnected that should be connected.
Provide 4-6 specific, actionable insights.`;

/** System prompt for generating innovative ideas. */
export const IDEAS_PROMPT = `You are an innovation consultant analyzing a knowledge graph derived from text.
Based on the structural gaps (disconnected cluster pairs) and bridge nodes, suggest innovative ideas
that connect disparate themes. Think creatively about how unlinked concepts could produce novel insights.
Generate 4-6 bold, specific ideas.`;

/** System prompt for bridging disconnected topics. */
export const BRIDGE_GAPS_PROMPT = `You are a creative analyst examining a text knowledge graph.
Some topic clusters in this text are completely disconnected — they share no common concepts.
Your task is to suggest specific ways to bridge these isolated topics.

For each disconnected pair, suggest:
1. A connecting concept or theme that could link them
2. A sentence or paragraph the author could add to create a connection
3. Why this connection might be valuable

Be specific and creative. Reference the actual keywords from each cluster.`;

/** System prompt for extracting topics from a knowledge graph. */
export const TOPIC_EXTRACTION_PROMPT = `You are an expert at identifying high-level topics and themes from text analysis.
Given a knowledge graph with keywords and clusters, extract the main TOPICS (abstract concepts, themes, ideas) and their RELATIONSHIPS.

Rules:
- Extract 5-15 distinct topics depending on text complexity
- Topics should be higher-level concepts, not just keywords (e.g., "Machine Learning" not "algorithm")
- Each topic should have a short label (2-4 words) and brief description
- Include the most relevant keywords from the graph that belong to each topic
- Identify meaningful relationships between topics (cause-effect, part-of, enables, contrasts-with, etc.)
- Assign importance weights (0.1-1.0) based on how central the topic is

Respond ONLY with valid JSON in this exact format:
{
  "topics": [
    {
      "id": "topic_1",
      "label": "Topic Name",
      "description": "Brief description of this topic",
      "keywords": ["keyword1", "keyword2"],
      "weight": 0.8
    }
  ],
  "relations": [
    {
      "source": "topic_1",
      "target": "topic_2",
      "strength": 0.7,
      "description": "How these topics relate"
    }
  ]
}`;

/** System prompt for the chat assistant. */
export const CHAT_SYSTEM_PROMPT = `You are Clustr AI, an intelligent assistant that helps users explore a text knowledge graph.
You have access to the graph structure including topical clusters, keywords, connections, structural gaps, sentiment, and network statistics.
Help the user understand patterns, generate insights, find specific information in the text, and explore connections.
Be conversational but concise. Reference specific nodes, clusters, and relationships from the graph when relevant.
When a "Focus Context" section is provided, the user has selected specific nodes on the graph — prioritize those topics in your response.`;

/** Build a context string from graph data for AI prompts. */
export function buildGraphContext(
  clusters: { id: number; topKeywords: string[]; nodes: { label: string }[] }[],
  gaps: {
    clusterA: number;
    clusterB: number;
    bridgeNodes: { label: string }[];
  }[],
  topKeywords: string[],
  stats?: {
    density: number;
    modularity: number;
    diversityScore: number;
  } | null,
  sentiment?: { positive: number; negative: number; neutral: number } | null,
  contentMode?: "keywords" | "topics",
  topicData?: {
    topics: { label: string; description: string }[];
    relations: { source: string; target: string; description: string }[];
  } | null,
): string {
  let context = `## Knowledge Graph Summary\n\n`;

  // Indicate content mode
  if (contentMode === "topics" && topicData) {
    context += `**View Mode**: Topic Map (AI-extracted high-level concepts)\n\n`;
    context += `**Topics** (${topicData.topics.length} found):\n`;
    for (const topic of topicData.topics) {
      context += `- **${topic.label}**: ${topic.description}\n`;
    }
    if (topicData.relations.length > 0) {
      context += `\n**Topic Relationships**:\n`;
      for (const rel of topicData.relations.slice(0, 10)) {
        context += `- ${rel.source} → ${rel.target}: ${rel.description}\n`;
      }
    }
  } else {
    context += `**View Mode**: Keyword Graph (word co-occurrence analysis)\n\n`;
    context += `**Top Keywords**: ${topKeywords.join(", ")}\n\n`;
    context += `**Topical Clusters** (${clusters.length} found):\n`;

    for (const cluster of clusters) {
      context += `- Cluster ${cluster.id} (${cluster.nodes.length} nodes): ${cluster.topKeywords.join(", ")}\n`;
    }

    if (gaps.length > 0) {
      context += `\n**Structural Gaps** (${gaps.length} found):\n`;
      for (const gap of gaps) {
        const bridges = gap.bridgeNodes.map((n) => n.label).join(", ");
        context += `- Between Cluster ${gap.clusterA} and Cluster ${gap.clusterB}`;
        if (bridges) context += ` (bridge nodes: ${bridges})`;
        context += `\n`;
      }
    }
  }

  if (stats) {
    context += `\n**Network Statistics**: Density: ${stats.density.toFixed(3)}, Modularity: ${stats.modularity.toFixed(3)}, Diversity: ${stats.diversityScore}/100\n`;
  }

  if (sentiment) {
    context += `\n**Sentiment**: Positive: ${sentiment.positive}, Neutral: ${sentiment.neutral}, Negative: ${sentiment.negative}\n`;
  }

  return context;
}

/** Build a focus context string from selected graph nodes. */
export function buildFocusContext(
  selectedNodes: {
    label: string;
    community: number;
    excerpts: string[];
    sentiment: number;
  }[],
): string {
  if (selectedNodes.length === 0) return "";
  let context = `\n## Focus Context\nThe user has selected these concepts on the graph:\n`;
  for (const node of selectedNodes) {
    const sentLabel =
      node.sentiment > 0.5
        ? "positive"
        : node.sentiment < -0.5
          ? "negative"
          : "neutral";
    context += `- **${node.label}** (cluster ${node.community}, sentiment: ${sentLabel})\n`;
    if (node.excerpts.length > 0) {
      context += `  Excerpts: ${node.excerpts.slice(0, 3).join(" | ")}\n`;
    }
  }
  context += `\nPrioritize these topics in your response.\n`;
  return context;
}
