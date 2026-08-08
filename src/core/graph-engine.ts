import {
  MIN_EDGE_WEIGHT,
  MAX_GRAPH_NODES,
  LOUVAIN_RESOLUTION,
  CLUSTER_COLORS,
  DEFAULT_NODE_COLOR,
  MIN_WORD_FREQUENCY,
} from "../config";
import type {
  NLPResult,
  GraphData,
  GraphNode,
  GraphEdge,
  Cluster,
  ParsedFolder,
  TopicExtractionResult,
} from "./types";
/* ── Build graph from NLP results ── */

/** Convert co-occurrence data into a graph. */
export function buildGraph(nlp: NLPResult): GraphData {
  // Filter edges by minimum weight
  const filteredEdges = nlp.coOccurrences.filter(
    (c) => c.weight >= MIN_EDGE_WEIGHT,
  );

  // Collect all unique nodes from filtered edges
  const nodeSet = new Set<string>();
  for (const e of filteredEdges) {
    nodeSet.add(e.wordA);
    nodeSet.add(e.wordB);
  }

  // Build adjacency for degree calculation
  const adjacency = new Map<string, Map<string, number>>();
  for (const e of filteredEdges) {
    if (!adjacency.has(e.wordA)) adjacency.set(e.wordA, new Map());
    if (!adjacency.has(e.wordB)) adjacency.set(e.wordB, new Map());
    adjacency.get(e.wordA)!.set(e.wordB, e.weight);
    adjacency.get(e.wordB)!.set(e.wordA, e.weight);
  }

  // Create nodes sorted by degree, limit to MAX_GRAPH_NODES
  let nodes: GraphNode[] = Array.from(nodeSet).map((word) => ({
    id: word,
    label: word,
    frequency: nlp.wordFrequency.get(word) ?? 1,
    degree: adjacency.get(word)?.size ?? 0,
    betweenness: 0,
    community: -1,
    sentiment: 0,
    excerpts: nlp.wordSentences.get(word) ?? [],
  }));

  nodes.sort((a, b) => b.degree - a.degree);
  if (nodes.length > MAX_GRAPH_NODES) nodes = nodes.slice(0, MAX_GRAPH_NODES);

  const keepSet = new Set(nodes.map((n) => n.id));

  // Filter edges to only kept nodes
  const edges: GraphEdge[] = filteredEdges
    .filter((e) => keepSet.has(e.wordA) && keepSet.has(e.wordB))
    .map((e) => ({ source: e.wordA, target: e.wordB, weight: e.weight }));

  // Compute betweenness centrality
  computeBetweenness(nodes, edges, adjacency, keepSet);

  // Run Louvain community detection
  runLouvain(nodes, adjacency, keepSet);

  return { nodes, edges };
}

/** Max source nodes for betweenness sampling. */
const BETWEENNESS_SAMPLE_SIZE = 80;

/* ── Betweenness centrality (Brandes' algorithm, sampled) ── */

function computeBetweenness(
  nodes: GraphNode[],
  _edges: GraphEdge[],
  adjacency: Map<string, Map<string, number>>,
  keepSet: Set<string>,
): void {
  const cb = new Map<string, number>();
  for (const n of nodes) cb.set(n.id, 0);

  // Sample source nodes for large graphs to keep cost manageable
  let sources: GraphNode[] = nodes;
  if (nodes.length > BETWEENNESS_SAMPLE_SIZE) {
    const shuffled = [...nodes];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    sources = shuffled.slice(0, BETWEENNESS_SAMPLE_SIZE);
  }

  for (const s of sources) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    const delta = new Map<string, number>();

    for (const n of nodes) {
      pred.set(n.id, []);
      sigma.set(n.id, 0);
      dist.set(n.id, -1);
      delta.set(n.id, 0);
    }
    sigma.set(s.id, 1);
    dist.set(s.id, 0);

    const queue: string[] = [s.id];
    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const neighbors = adjacency.get(v);
      if (!neighbors) continue;
      for (const w of neighbors.keys()) {
        if (!keepSet.has(w)) continue;
        if (dist.get(w) === -1) {
          dist.set(w, dist.get(v)! + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) {
        const d = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
        delta.set(v, delta.get(v)! + d);
      }
      if (w !== s.id) {
        cb.set(w, cb.get(w)! + delta.get(w)!);
      }
    }
  }

  // Normalize
  const n = nodes.length;
  const norm = n > 2 ? 2 / ((n - 1) * (n - 2)) : 1;
  for (const node of nodes) {
    node.betweenness = (cb.get(node.id) ?? 0) * norm;
  }
}

/* ── Louvain community detection (multi-level) ── */

/** Maximum Louvain outer levels (contraction rounds). */
const MAX_LOUVAIN_LEVELS = 10;

/** Maximum local-moving passes per level. */
const MAX_LOCAL_PASSES = 20;

/** Shuffle an array in place (Fisher-Yates). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Compact graph representation for the multi-level algorithm.
 * Nodes are integer-indexed; edges stored as adjacency with weights.
 */
type CompactGraph = {
  n: number;
  adj: Map<number, Map<number, number>>;
  /** Weighted degree of each node. */
  deg: Float64Array;
  /** Total edge weight (each edge counted once). */
  m: number;
};

/** Build a CompactGraph from the real nodes + adjacency. */
function buildCompactGraph(
  nodeIds: string[],
  adjacency: Map<string, Map<string, number>>,
  keepSet: Set<string>,
): { cg: CompactGraph; idToIdx: Map<string, number> } {
  const idToIdx = new Map<string, number>();
  nodeIds.forEach((id, i) => idToIdx.set(id, i));

  const n = nodeIds.length;
  const adj = new Map<number, Map<number, number>>();
  const deg = new Float64Array(n);
  let m = 0;

  for (let i = 0; i < n; i++) adj.set(i, new Map());

  for (let i = 0; i < n; i++) {
    const id = nodeIds[i];
    const neighbors = adjacency.get(id);
    if (!neighbors) continue;
    for (const [target, w] of neighbors) {
      if (!keepSet.has(target)) continue;
      const j = idToIdx.get(target);
      if (j === undefined) continue;
      adj.get(i)!.set(j, w);
      deg[i] += w;
    }
  }

  // m = sum of all edge weights / 2 (each edge is in both directions)
  for (let i = 0; i < n; i++) m += deg[i];
  m /= 2;

  return { cg: { n, adj, deg, m }, idToIdx };
}

/**
 * Phase 1: local node moving.
 * Returns the community assignment (node index → community id)
 * and whether any node moved.
 */
function localMoving(
  cg: CompactGraph,
  resolution: number,
): { comm: Int32Array; moved: boolean } {
  const { n, adj, deg, m } = cg;
  if (m === 0) {
    const comm = new Int32Array(n);
    for (let i = 0; i < n; i++) comm[i] = i;
    return { comm, moved: false };
  }

  // Each node starts in its own community
  const comm = new Int32Array(n);
  for (let i = 0; i < n; i++) comm[i] = i;

  // Σ_tot for each community (sum of weighted degrees of members)
  const sigmaTot = new Float64Array(n);
  for (let i = 0; i < n; i++) sigmaTot[i] = deg[i];

  const order = Array.from({ length: n }, (_, i) => i);
  let moved = false;

  for (let pass = 0; pass < MAX_LOCAL_PASSES; pass++) {
    let passImproved = false;
    shuffle(order);

    for (const i of order) {
      const currentComm = comm[i];
      const ki = deg[i];
      const neighbors = adj.get(i);
      if (!neighbors || neighbors.size === 0) continue;

      // Weights from node i to each neighbor community
      const commWeights = new Map<number, number>();
      for (const [j, w] of neighbors) {
        const c = comm[j];
        commWeights.set(c, (commWeights.get(c) ?? 0) + w);
      }

      // "Remove" node from its community
      const kiIn = commWeights.get(currentComm) ?? 0;
      sigmaTot[currentComm] -= ki;

      // Baseline gain for staying in current community (after removal)
      const baseGain =
        kiIn - (resolution * ki * sigmaTot[currentComm]) / (2 * m);

      let bestComm = currentComm;
      let bestDelta = 0;

      for (const [c, wIn] of commWeights) {
        const gain = wIn - (resolution * ki * sigmaTot[c]) / (2 * m);
        const delta = gain - baseGain;
        if (delta > bestDelta) {
          bestDelta = delta;
          bestComm = c;
        }
      }

      // "Insert" node into best community
      sigmaTot[bestComm] += ki;
      if (bestComm !== currentComm) {
        comm[i] = bestComm;
        passImproved = true;
        moved = true;
      }
    }

    if (!passImproved) break;
  }

  return { comm, moved };
}

/**
 * Phase 2: contract the graph.
 * Each community becomes a super-node; edge weights are aggregated.
 */
function contractGraph(
  cg: CompactGraph,
  comm: Int32Array,
): { contracted: CompactGraph; commToSuper: Int32Array } {
  // Map old community ids → consecutive super-node ids
  const uniqueComms = [...new Set(comm)].sort((a, b) => a - b);
  const commRemap = new Map<number, number>();
  uniqueComms.forEach((c, i) => commRemap.set(c, i));

  const commToSuper = new Int32Array(comm.length);
  for (let i = 0; i < comm.length; i++) {
    commToSuper[i] = commRemap.get(comm[i])!;
  }

  const sn = uniqueComms.length;
  const sAdj = new Map<number, Map<number, number>>();
  for (let i = 0; i < sn; i++) sAdj.set(i, new Map());

  // Aggregate edges
  for (let i = 0; i < cg.n; i++) {
    const si = commToSuper[i];
    const neighbors = cg.adj.get(i);
    if (!neighbors) continue;
    for (const [j, w] of neighbors) {
      const sj = commToSuper[j];
      if (si === sj) continue; // skip self-loops for modularity
      const existing = sAdj.get(si)!.get(sj) ?? 0;
      sAdj.get(si)!.set(sj, existing + w);
    }
  }

  // Compute degrees & m for contracted graph
  const sDeg = new Float64Array(sn);
  let sm = 0;
  for (let i = 0; i < sn; i++) {
    const nb = sAdj.get(i)!;
    for (const w of nb.values()) sDeg[i] += w;
  }
  for (let i = 0; i < sn; i++) sm += sDeg[i];
  sm /= 2;

  return {
    contracted: { n: sn, adj: sAdj, deg: sDeg, m: sm },
    commToSuper,
  };
}

function runLouvain(
  nodes: GraphNode[],
  adjacency: Map<string, Map<string, number>>,
  keepSet: Set<string>,
): void {
  const nodeIds = nodes.map((n) => n.id);
  const { cg, idToIdx: _ } = buildCompactGraph(nodeIds, adjacency, keepSet);

  if (cg.m === 0) {
    nodes.forEach((n, i) => (n.community = i));
    return;
  }

  const resolution = LOUVAIN_RESOLUTION;

  // membership[i] tracks the final community for original node i
  let membership = new Int32Array(cg.n);
  for (let i = 0; i < cg.n; i++) membership[i] = i;

  let currentGraph = cg;

  for (let level = 0; level < MAX_LOUVAIN_LEVELS; level++) {
    // Phase 1: local moving on current (possibly contracted) graph
    const { comm, moved } = localMoving(currentGraph, resolution);
    if (!moved) break;

    // Update membership: map original nodes through the contraction chain
    const newMembership = new Int32Array(membership.length);
    for (let i = 0; i < membership.length; i++) {
      newMembership[i] = comm[membership[i]];
    }
    membership = newMembership;

    // Phase 2: contract the graph
    const { contracted, commToSuper } = contractGraph(currentGraph, comm);

    // If contraction didn't reduce the graph, we're done
    if (contracted.n >= currentGraph.n) break;

    // Remap membership to use super-node ids
    for (let i = 0; i < membership.length; i++) {
      membership[i] = commToSuper[membership[i]];
    }

    currentGraph = contracted;
  }

  // Renumber consecutively
  const uniqueComms = [...new Set(membership)];
  const commMap = new Map<number, number>();
  uniqueComms.forEach((c, i) => commMap.set(c, i));

  for (let i = 0; i < nodes.length; i++) {
    nodes[i].community = commMap.get(membership[i])!;
  }
}

/* ── Extract clusters ── */

/** Group nodes into clusters with colour assignments. */
export function extractClusters(data: GraphData): Cluster[] {
  const clusterMap = new Map<number, GraphNode[]>();
  for (const node of data.nodes) {
    const arr = clusterMap.get(node.community) ?? [];
    arr.push(node);
    clusterMap.set(node.community, arr);
  }

  const clusters: Cluster[] = [];
  for (const [id, clusterNodes] of clusterMap) {
    clusterNodes.sort((a, b) => b.degree - a.degree);
    clusters.push({
      id,
      color: CLUSTER_COLORS[id % CLUSTER_COLORS.length] ?? DEFAULT_NODE_COLOR,
      nodes: clusterNodes,
      topKeywords: clusterNodes.slice(0, 5).map((n) => n.label),
    });
  }

  // Sort clusters by size descending
  clusters.sort((a, b) => b.nodes.length - a.nodes.length);
  return clusters;
}

/* ── Graph Comparison ── */

/** Build a merged graph from two NLP results with compare source tags. */
export function buildCompareGraph(nlpA: NLPResult, nlpB: NLPResult): GraphData {
  const graphA = buildGraph(nlpA);
  const graphB = buildGraph(nlpB);

  const nodeIdsB = new Set(graphB.nodes.map((n) => n.id));
  const nodeMap = new Map<string, GraphNode>();

  for (const node of graphA.nodes) {
    nodeMap.set(node.id, {
      ...node,
      compareSource: nodeIdsB.has(node.id) ? "both" : "a",
    });
  }

  for (const node of graphB.nodes) {
    const existing = nodeMap.get(node.id);
    if (existing) {
      existing.compareSource = "both";
      existing.frequency += node.frequency;
    } else {
      nodeMap.set(node.id, { ...node, compareSource: "b" });
    }
  }

  // Merge edges (keep max weight for duplicates)
  const edgeMap = new Map<string, GraphEdge>();
  const addEdges = (edges: GraphEdge[]) => {
    for (const edge of edges) {
      const s = typeof edge.source === "string" ? edge.source : edge.source.id;
      const t = typeof edge.target === "string" ? edge.target : edge.target.id;
      if (!nodeMap.has(s) || !nodeMap.has(t)) continue;
      const key = s < t ? `${s}||${t}` : `${t}||${s}`;
      const prev = edgeMap.get(key);
      if (!prev || edge.weight > prev.weight) {
        edgeMap.set(key, { source: s, target: t, weight: edge.weight });
      }
    }
  };
  addEdges(graphA.edges);
  addEdges(graphB.edges);

  const nodes = Array.from(nodeMap.values());
  const edges = Array.from(edgeMap.values());

  // Recompute degree
  const adjacency = new Map<string, Map<string, number>>();
  for (const edge of edges) {
    const s = typeof edge.source === "string" ? edge.source : edge.source.id;
    const t = typeof edge.target === "string" ? edge.target : edge.target.id;
    if (!adjacency.has(s)) adjacency.set(s, new Map());
    if (!adjacency.has(t)) adjacency.set(t, new Map());
    adjacency.get(s)!.set(t, edge.weight);
    adjacency.get(t)!.set(s, edge.weight);
  }
  for (const node of nodes) {
    node.degree = adjacency.get(node.id)?.size ?? 0;
  }

  const keepSet = new Set(nodes.map((n) => n.id));
  computeBetweenness(nodes, edges, adjacency, keepSet);
  runLouvain(nodes, adjacency, keepSet);

  return { nodes, edges };
}

/* ── Peel the Onion ── */

/** Remove specific nodes and recompute graph metrics. */
export function removeNodesFromGraph(
  graph: GraphData,
  removeIds: Set<string>,
): GraphData {
  const nodes: GraphNode[] = graph.nodes
    .filter((n) => !removeIds.has(n.id))
    .map((n) => ({ ...n }));
  const edges: GraphEdge[] = graph.edges.filter((e) => {
    const s = typeof e.source === "string" ? e.source : e.source.id;
    const t = typeof e.target === "string" ? e.target : e.target.id;
    return !removeIds.has(s) && !removeIds.has(t);
  });

  const adjacency = new Map<string, Map<string, number>>();
  for (const edge of edges) {
    const s = typeof edge.source === "string" ? edge.source : edge.source.id;
    const t = typeof edge.target === "string" ? edge.target : edge.target.id;
    if (!adjacency.has(s)) adjacency.set(s, new Map());
    if (!adjacency.has(t)) adjacency.set(t, new Map());
    adjacency.get(s)!.set(t, edge.weight);
    adjacency.get(t)!.set(s, edge.weight);
  }

  for (const node of nodes) {
    node.degree = adjacency.get(node.id)?.size ?? 0;
  }

  const keepSet = new Set(nodes.map((n) => n.id));
  computeBetweenness(nodes, edges, adjacency, keepSet);
  runLouvain(nodes, adjacency, keepSet);

  return { nodes, edges };
}

/** Remove the top-N nodes by betweenness centrality. */
export function peelTopNodes(
  graph: GraphData,
  count: number,
): { peeled: GraphData; removedIds: string[]; removedLabels: string[] } {
  const sorted = [...graph.nodes].sort((a, b) => b.betweenness - a.betweenness);
  const toRemove = sorted.slice(0, Math.min(count, graph.nodes.length));
  const removedIds = toRemove.map((n) => n.id);
  const removedLabels = toRemove.map((n) => n.label);
  const peeled = removeNodesFromGraph(graph, new Set(removedIds));
  return { peeled, removedIds, removedLabels };
}

/** Get the colour for a node based on its community. */
export function getNodeColor(node: GraphNode): string {
  // Compare mode overrides
  if (node.compareSource === "a") return "#f87171"; // Red — Text A only
  if (node.compareSource === "b") return "#60a5fa"; // Blue — Text B only
  if (node.compareSource === "both") return "#d1d5db"; // Gray — shared
  // Folder nodes get a distinct color
  if (node.nodeType === "folder") return "#f59e0b"; // Amber
  // Topic nodes use community colors with higher saturation
  if (node.nodeType === "topic") {
    if (node.community < 0) return "#8b5cf6"; // Purple for unclustered topics
    return CLUSTER_COLORS[node.community % CLUSTER_COLORS.length] ?? "#8b5cf6";
  }
  if (node.community < 0) return DEFAULT_NODE_COLOR;
  return (
    CLUSTER_COLORS[node.community % CLUSTER_COLORS.length] ?? DEFAULT_NODE_COLOR
  );
}

/* ── Topic graph building ── */

/** Build a graph from LLM-extracted topics. */
export function buildTopicGraph(result: TopicExtractionResult): GraphData {
  const { topics, relations } = result;

  if (topics.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Create nodes from topics
  const nodes: GraphNode[] = topics.map((topic, index) => ({
    id: topic.id,
    label: topic.label,
    frequency: topic.keywords.length, // Use keyword count as "frequency"
    degree: 0, // Will be computed below
    betweenness: topic.weight, // Use weight as betweenness proxy
    community: index % CLUSTER_COLORS.length, // Assign communities for coloring
    sentiment: 0,
    excerpts: [
      topic.description,
      ...topic.keywords.map((k) => `Keyword: ${k}`),
    ],
    nodeType: "topic",
  }));

  // Create edges from relations
  const edges: GraphEdge[] = relations.map((rel) => ({
    source: rel.source,
    target: rel.target,
    weight: rel.strength * 5, // Scale strength to weight range
  }));

  // Compute degree for each node
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const src = typeof edge.source === "string" ? edge.source : edge.source.id;
    const tgt = typeof edge.target === "string" ? edge.target : edge.target.id;
    if (!adjacency.has(src)) adjacency.set(src, new Set());
    if (!adjacency.has(tgt)) adjacency.set(tgt, new Set());
    adjacency.get(src)!.add(tgt);
    adjacency.get(tgt)!.add(src);
  }

  for (const node of nodes) {
    node.degree = adjacency.get(node.id)?.size ?? 0;
  }

  // Run Louvain for community detection if we have enough topics
  if (nodes.length >= 3 && edges.length >= 2) {
    const keepSet = new Set(nodes.map((n) => n.id));
    const adjMap = new Map<string, Map<string, number>>();
    for (const edge of edges) {
      const src =
        typeof edge.source === "string" ? edge.source : edge.source.id;
      const tgt =
        typeof edge.target === "string" ? edge.target : edge.target.id;
      if (!adjMap.has(src)) adjMap.set(src, new Map());
      if (!adjMap.has(tgt)) adjMap.set(tgt, new Map());
      adjMap.get(src)!.set(tgt, edge.weight);
      adjMap.get(tgt)!.set(src, edge.weight);
    }
    runLouvain(nodes, adjMap, keepSet);
  }

  return { nodes, edges };
}

/* ── Folder graph building ── */

/** Max keywords to extract per folder. */
const MAX_KEYWORDS_PER_FOLDER = 15;

/**
 * Build a graph from a parsed folder structure.
 * NLP results must be precomputed (keyed by folder path) so this function
 * stays free of the heavy NLP dependency — callers compute them off-main-thread.
 */
export function buildFolderGraph(
  root: ParsedFolder,
  nlpByPath: ReadonlyMap<string, NLPResult> = new Map(),
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const keywordToFolders = new Map<string, string[]>();
  const keywordNodeMap = new Map<string, GraphNode>();

  // Process folders recursively
  processFolderNode(
    root,
    null,
    nodes,
    edges,
    keywordToFolders,
    keywordNodeMap,
    nlpByPath,
  );

  // Assign communities based on folder membership
  // Folder nodes get their own community index
  let communityIndex = 0;
  const folderCommunity = new Map<string, number>();

  for (const node of nodes) {
    if (node.nodeType === "folder") {
      folderCommunity.set(node.id, communityIndex);
      node.community = communityIndex;
      communityIndex++;
    }
  }

  // Keywords get the community of their primary folder
  for (const node of nodes) {
    if (node.nodeType !== "folder") {
      const folders = keywordToFolders.get(node.id);
      if (folders && folders.length > 0) {
        node.community = folderCommunity.get(folders[0]) ?? 0;
      }
    }
  }

  // Compute degree for all nodes
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const src = typeof edge.source === "string" ? edge.source : edge.source.id;
    const tgt = typeof edge.target === "string" ? edge.target : edge.target.id;
    if (!adjacency.has(src)) adjacency.set(src, new Set());
    if (!adjacency.has(tgt)) adjacency.set(tgt, new Set());
    adjacency.get(src)!.add(tgt);
    adjacency.get(tgt)!.add(src);
  }

  for (const node of nodes) {
    node.degree = adjacency.get(node.id)?.size ?? 0;
  }

  return { nodes, edges };
}

/** Recursively process a folder into nodes and edges. */
function processFolderNode(
  folder: ParsedFolder,
  parentId: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
  keywordToFolders: Map<string, string[]>,
  keywordNodeMap: Map<string, GraphNode>,
  nlpByPath: ReadonlyMap<string, NLPResult>,
): void {
  const folderId = `folder:${folder.path}`;

  // Create folder node
  const folderNode: GraphNode = {
    id: folderId,
    label: folder.name,
    frequency: folder.files.length,
    degree: 0,
    betweenness: 0,
    community: 0,
    sentiment: 0,
    excerpts: [],
    nodeType: "folder",
    fileCount: folder.files.length,
    folderPath: folder.path,
  };
  nodes.push(folderNode);

  // Connect to parent folder
  if (parentId) {
    edges.push({
      source: parentId,
      target: folderId,
      weight: 3, // Strong connection for hierarchy
    });
  }

  // Extract keywords from folder's text content
  const nlp = nlpByPath.get(folder.path);
  if (nlp && folder.text.trim()) {
    // Get top keywords by frequency
    const keywords = Array.from(nlp.wordFrequency.entries())
      .filter(([, freq]) => freq >= MIN_WORD_FREQUENCY)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KEYWORDS_PER_FOLDER);

    for (const [word, freq] of keywords) {
      const keywordId = `kw:${word}`;

      // Track which folders contain this keyword
      if (!keywordToFolders.has(keywordId)) {
        keywordToFolders.set(keywordId, []);
      }
      keywordToFolders.get(keywordId)!.push(folderId);

      // Check if keyword node already exists (O(1) via Map)
      let keywordNode = keywordNodeMap.get(keywordId);
      if (!keywordNode) {
        keywordNode = {
          id: keywordId,
          label: word,
          frequency: freq,
          degree: 0,
          betweenness: 0,
          community: 0,
          sentiment: 0,
          excerpts: nlp.wordSentences.get(word) ?? [],
          nodeType: "keyword",
        };
        nodes.push(keywordNode);
        keywordNodeMap.set(keywordId, keywordNode);
      } else {
        // Accumulate frequency from multiple folders
        keywordNode.frequency += freq;
        keywordNode.excerpts.push(...(nlp.wordSentences.get(word) ?? []));
      }

      // Connect folder to keyword
      edges.push({
        source: folderId,
        target: keywordId,
        weight: Math.min(freq, 5), // Weight based on frequency, capped
      });
    }
  }

  // Process child folders
  for (const child of folder.children) {
    processFolderNode(
      child,
      folderId,
      nodes,
      edges,
      keywordToFolders,
      keywordNodeMap,
      nlpByPath,
    );
  }
}
