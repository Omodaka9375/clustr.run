import type { GraphData, GraphNode, Cluster, StructuralGap } from "./types";

/** Find structural gaps — weakly connected cluster pairs with bridge nodes. */
export function findStructuralGaps(
  data: GraphData,
  clusters: Cluster[],
): StructuralGap[] {
  if (clusters.length < 2) return [];

  // Build adjacency set for quick lookup
  const adjacency = new Map<string, Set<string>>();
  for (const edge of data.edges) {
    const src = typeof edge.source === "string" ? edge.source : edge.source.id;
    const tgt = typeof edge.target === "string" ? edge.target : edge.target.id;
    if (!adjacency.has(src)) adjacency.set(src, new Set());
    if (!adjacency.has(tgt)) adjacency.set(tgt, new Set());
    adjacency.get(src)!.add(tgt);
    adjacency.get(tgt)!.add(src);
  }

  // Build a lookup map for O(1) node access
  const nodeMap = new Map<string, GraphNode>();
  for (const node of data.nodes) nodeMap.set(node.id, node);

  // Count cross-cluster edges for each pair
  const clusterPairEdges = new Map<string, number>();
  const clusterPairBridges = new Map<string, Set<string>>();

  for (const edge of data.edges) {
    const src = typeof edge.source === "string" ? edge.source : edge.source.id;
    const tgt = typeof edge.target === "string" ? edge.target : edge.target.id;
    const srcNode = nodeMap.get(src);
    const tgtNode = nodeMap.get(tgt);
    if (!srcNode || !tgtNode) continue;
    if (srcNode.community === tgtNode.community) continue;

    const a = Math.min(srcNode.community, tgtNode.community);
    const b = Math.max(srcNode.community, tgtNode.community);
    const key = `${a}-${b}`;
    clusterPairEdges.set(key, (clusterPairEdges.get(key) ?? 0) + 1);

    if (!clusterPairBridges.has(key)) clusterPairBridges.set(key, new Set());
    clusterPairBridges.get(key)!.add(src);
    clusterPairBridges.get(key)!.add(tgt);
  }

  // Identify pairs with few connections → structural gaps
  const gaps: StructuralGap[] = [];
  const clusterIds = clusters.map((c) => c.id);
  const clusterById = new Map(clusters.map((c) => [c.id, c]));

  for (let i = 0; i < clusterIds.length; i++) {
    for (let j = i + 1; j < clusterIds.length; j++) {
      const a = Math.min(clusterIds[i], clusterIds[j]);
      const b = Math.max(clusterIds[i], clusterIds[j]);
      const key = `${a}-${b}`;
      const edgeCount = clusterPairEdges.get(key) ?? 0;

      // Consider it a gap if few or no edges connect the clusters
      const sizeA = clusterById.get(clusterIds[i])!.nodes.length;
      const sizeB = clusterById.get(clusterIds[j])!.nodes.length;
      const expectedMin = Math.min(sizeA, sizeB) * 0.1;

      if (edgeCount <= expectedMin) {
        const bridgeIds = clusterPairBridges.get(key) ?? new Set();
        const bridgeNodes: GraphNode[] = data.nodes
          .filter((n) => bridgeIds.has(n.id))
          .sort((x, y) => y.betweenness - x.betweenness)
          .slice(0, 5);

        gaps.push({ clusterA: a, clusterB: b, bridgeNodes });
      }
    }
  }

  // Sort gaps by fewest connections (most disconnected first)
  gaps.sort((a, b) => {
    const keyA = `${a.clusterA}-${a.clusterB}`;
    const keyB = `${b.clusterA}-${b.clusterB}`;
    return (
      (clusterPairEdges.get(keyA) ?? 0) - (clusterPairEdges.get(keyB) ?? 0)
    );
  });

  return gaps;
}
