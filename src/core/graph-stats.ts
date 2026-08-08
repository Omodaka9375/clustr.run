import type { GraphData, GraphNode, Cluster, GraphStats } from "./types";

/** Compute network statistics for the graph. */
export function computeGraphStats(
  data: GraphData,
  clusters: Cluster[],
): GraphStats {
  const n = data.nodes.length;
  const e = data.edges.length;

  // Density
  const density = n > 1 ? (2 * e) / (n * (n - 1)) : 0;

  // Build adjacency for BFS / clustering
  const adj = new Map<string, Set<string>>();
  const weightAdj = new Map<string, Map<string, number>>();
  for (const node of data.nodes) {
    adj.set(node.id, new Set());
    weightAdj.set(node.id, new Map());
  }
  for (const edge of data.edges) {
    const src = typeof edge.source === "string" ? edge.source : edge.source.id;
    const tgt = typeof edge.target === "string" ? edge.target : edge.target.id;
    adj.get(src)?.add(tgt);
    adj.get(tgt)?.add(src);
    const w = edge.weight;
    weightAdj.get(src)?.set(tgt, w);
    weightAdj.get(tgt)?.set(src, w);
  }

  // Modularity (Newman-Girvan Q)
  const modularity = computeModularity(data, clusters, weightAdj);

  // Average path length + diameter (sampled BFS)
  const { avgPathLength, diameter } = sampleBFS(data.nodes, adj, 50);

  // Clustering coefficient
  const clusteringCoeff = computeClusteringCoeff(data.nodes, adj);

  // Discourse diversity: combines modularity + influence distribution (0-100)
  const diversityScore = computeDiversity(data.nodes, clusters, modularity);

  return {
    nodeCount: n,
    edgeCount: e,
    density,
    modularity,
    avgPathLength,
    clusteringCoeff,
    diameter,
    diversityScore,
  };
}

/** Newman-Girvan modularity Q. */
function computeModularity(
  data: GraphData,
  clusters: Cluster[],
  weightAdj: Map<string, Map<string, number>>,
): number {
  if (data.edges.length === 0 || clusters.length <= 1) return 0;

  const communityOf = new Map<string, number>();
  for (const node of data.nodes) communityOf.set(node.id, node.community);

  let m = 0;
  for (const edge of data.edges) m += edge.weight;
  if (m === 0) return 0;

  const kDeg = new Map<string, number>();
  for (const node of data.nodes) {
    let k = 0;
    const neighbors = weightAdj.get(node.id);
    if (neighbors) for (const w of neighbors.values()) k += w;
    kDeg.set(node.id, k);
  }

  let Q = 0;
  for (const edge of data.edges) {
    const src = typeof edge.source === "string" ? edge.source : edge.source.id;
    const tgt = typeof edge.target === "string" ? edge.target : edge.target.id;
    if (communityOf.get(src) === communityOf.get(tgt)) {
      const ki = kDeg.get(src) ?? 0;
      const kj = kDeg.get(tgt) ?? 0;
      Q += edge.weight - (ki * kj) / (2 * m);
    }
  }
  return Q / m;
}

/** BFS-based average path length and diameter (sampled). */
function sampleBFS(
  nodes: GraphNode[],
  adj: Map<string, Set<string>>,
  sampleSize: number,
): { avgPathLength: number; diameter: number } {
  if (nodes.length <= 1) return { avgPathLength: 0, diameter: 0 };

  const sample =
    nodes.length <= sampleSize
      ? nodes
      : shuffle([...nodes]).slice(0, sampleSize);

  let totalDist = 0;
  let totalPairs = 0;
  let maxDist = 0;

  for (const start of sample) {
    const dist = new Map<string, number>();
    dist.set(start.id, 0);
    const queue = [start.id];
    let qi = 0;

    while (qi < queue.length) {
      const v = queue[qi++];
      const d = dist.get(v)!;
      const neighbors = adj.get(v);
      if (!neighbors) continue;
      for (const w of neighbors) {
        if (!dist.has(w)) {
          dist.set(w, d + 1);
          queue.push(w);
        }
      }
    }

    for (const d of dist.values()) {
      if (d > 0) {
        totalDist += d;
        totalPairs++;
        if (d > maxDist) maxDist = d;
      }
    }
  }

  return {
    avgPathLength: totalPairs > 0 ? totalDist / totalPairs : 0,
    diameter: maxDist,
  };
}

/** Average local clustering coefficient. */
function computeClusteringCoeff(
  nodes: GraphNode[],
  adj: Map<string, Set<string>>,
): number {
  if (nodes.length === 0) return 0;
  let totalCC = 0;
  let counted = 0;

  for (const node of nodes) {
    const neighbors = adj.get(node.id);
    if (!neighbors || neighbors.size < 2) continue;

    const nArr = [...neighbors];
    let triangles = 0;
    const possible = (nArr.length * (nArr.length - 1)) / 2;

    for (let i = 0; i < nArr.length; i++) {
      for (let j = i + 1; j < nArr.length; j++) {
        if (adj.get(nArr[i])?.has(nArr[j])) triangles++;
      }
    }

    totalCC += triangles / possible;
    counted++;
  }

  return counted > 0 ? totalCC / counted : 0;
}

/** Discourse diversity score (0-100). Higher = more diverse/balanced topics. */
function computeDiversity(
  nodes: GraphNode[],
  clusters: Cluster[],
  modularity: number,
): number {
  if (clusters.length <= 1 || nodes.length === 0) return 0;

  // Evenness: how evenly distributed nodes are across clusters (Shannon entropy based)
  const total = nodes.length;
  let entropy = 0;
  for (const c of clusters) {
    const p = c.nodes.length / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(clusters.length);
  const evenness = maxEntropy > 0 ? entropy / maxEntropy : 0;

  // Influence spread: how distributed betweenness centrality is
  const totalBetw = nodes.reduce((s, n) => s + n.betweenness, 0);
  let influenceEntropy = 0;
  if (totalBetw > 0) {
    for (const n of nodes) {
      const p = n.betweenness / totalBetw;
      if (p > 0) influenceEntropy -= p * Math.log2(p);
    }
  }
  const maxInfluence = Math.log2(nodes.length);
  const influenceSpread =
    maxInfluence > 0 ? influenceEntropy / maxInfluence : 0;

  // Combine: modularity (0-1 typical) + evenness (0-1) + influence spread (0-1)
  const modNorm = Math.min(Math.max(modularity, 0), 1);
  const raw = modNorm * 0.4 + evenness * 0.35 + influenceSpread * 0.25;
  return Math.round(raw * 100);
}

/** Fisher-Yates shuffle. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
