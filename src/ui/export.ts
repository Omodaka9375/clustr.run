import type {
  GraphData,
  GraphNode,
  Cluster,
  StructuralGap,
  GraphStats,
} from "../core/types";

/** Export graph data as a JSON file download. */
export function exportGraphJSON(
  data: GraphData,
  clusters: Cluster[],
  gaps: StructuralGap[],
): void {
  const exportData = {
    nodes: data.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      frequency: n.frequency,
      degree: n.degree,
      betweenness: n.betweenness,
      community: n.community,
    })),
    edges: data.edges.map((e) => ({
      source: typeof e.source === "string" ? e.source : e.source.id,
      target: typeof e.target === "string" ? e.target : e.target.id,
      weight: e.weight,
    })),
    clusters: clusters.map((c) => ({
      id: c.id,
      color: c.color,
      nodeCount: c.nodes.length,
      topKeywords: c.topKeywords,
    })),
    gaps: gaps.map((g) => ({
      clusterA: g.clusterA,
      clusterB: g.clusterB,
      bridgeNodes: g.bridgeNodes.map((n) => n.label),
    })),
    exportedAt: new Date().toISOString(),
  };

  downloadFile(
    JSON.stringify(exportData, null, 2),
    "clustr-graph.json",
    "application/json",
  );
}

/** Export the graph SVG element. */
export function exportGraphSVG(container: HTMLElement): void {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("No graph to export");

  // Clone SVG and embed styles
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // Add inline styles for standalone SVG
  const styleEl = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "style",
  );
  styleEl.textContent = `
    text { fill: #e6edf3; font-family: -apple-system, sans-serif; font-size: 11px; }
    line { stroke: #30363d; stroke-opacity: 0.3; }
    circle { stroke: none; }
    svg { background: #0d1117; }
  `;
  clone.insertBefore(styleEl, clone.firstChild);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  downloadFile(svgString, "clustr-graph.svg", "image/svg+xml");
}

/** Export the graph as a PNG image. */
export function exportGraphPNG(container: HTMLElement): void {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("No graph to export");

  const clone = svg.cloneNode(true) as SVGSVGElement;

  // Embed styles
  const styleEl = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "style",
  );
  styleEl.textContent = `
    text { fill: #e6edf3; font-family: -apple-system, sans-serif; font-size: 11px; }
    line { stroke: #30363d; stroke-opacity: 0.3; }
    circle { stroke: none; }
    svg { background: #0d1117; }
  `;
  clone.insertBefore(styleEl, clone.firstChild);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgString], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = svg.clientWidth * 2; // 2x for retina
    canvas.height = svg.clientHeight * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "clustr-graph.png";
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };
  img.src = url;
}

/** Export keywords as CSV (label, frequency, degree, betweenness, community, sentiment). */
export function exportKeywordsCSV(data: GraphData): void {
  const header = "label,frequency,degree,betweenness,community,sentiment";
  const rows = [...data.nodes]
    .sort((a, b) => b.degree - a.degree)
    .map(
      (n) =>
        `${csvEscape(n.label)},${n.frequency},${n.degree},${n.betweenness.toFixed(4)},${n.community},${n.sentiment.toFixed(3)}`,
    );
  downloadFile([header, ...rows].join("\n"), "clustr-keywords.csv", "text/csv");
}

/** Export full analytics as CSV (stats + cluster summaries). */
export function exportAnalyticsCSV(
  _data: GraphData,
  clusters: Cluster[],
  stats: GraphStats | null,
): void {
  const lines: string[] = ["metric,value"];
  if (stats) {
    lines.push(`nodes,${stats.nodeCount}`);
    lines.push(`edges,${stats.edgeCount}`);
    lines.push(`density,${stats.density.toFixed(4)}`);
    lines.push(`modularity,${stats.modularity.toFixed(4)}`);
    lines.push(`avg_path_length,${stats.avgPathLength.toFixed(3)}`);
    lines.push(`clustering_coeff,${stats.clusteringCoeff.toFixed(4)}`);
    lines.push(`diameter,${stats.diameter}`);
    lines.push(`diversity_score,${stats.diversityScore}`);
  }
  lines.push("");
  lines.push("cluster_id,node_count,top_keywords");
  for (const c of clusters) {
    lines.push(
      `${c.id},${c.nodes.length},${csvEscape(c.topKeywords.join("; "))}`,
    );
  }
  downloadFile(lines.join("\n"), "clustr-analytics.csv", "text/csv");
}

/** Export graph in GEXF format (Gephi-compatible XML). */
export function exportGexf(data: GraphData, _clusters: Cluster[]): void {
  const nodeId = (n: string | GraphNode) => (typeof n === "string" ? n : n.id);

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gexf xmlns="http://gexf.net/1.3" version="1.3">`,
    `  <meta><creator>Clustr</creator></meta>`,
    `  <graph defaultedgetype="undirected">`,
    `    <attributes class="node">`,
    `      <attribute id="0" title="frequency" type="integer"/>`,
    `      <attribute id="1" title="degree" type="integer"/>`,
    `      <attribute id="2" title="betweenness" type="float"/>`,
    `      <attribute id="3" title="community" type="integer"/>`,
    `      <attribute id="4" title="sentiment" type="float"/>`,
    `    </attributes>`,
    `    <nodes>`,
  ];

  for (const n of data.nodes) {
    lines.push(
      `      <node id="${xmlEscape(n.id)}" label="${xmlEscape(n.label)}">`,
    );
    lines.push(`        <attvalues>`);
    lines.push(`          <attvalue for="0" value="${n.frequency}"/>`);
    lines.push(`          <attvalue for="1" value="${n.degree}"/>`);
    lines.push(
      `          <attvalue for="2" value="${n.betweenness.toFixed(4)}"/>`,
    );
    lines.push(`          <attvalue for="3" value="${n.community}"/>`);
    lines.push(
      `          <attvalue for="4" value="${n.sentiment.toFixed(3)}"/>`,
    );
    lines.push(`        </attvalues>`);
    lines.push(`      </node>`);
  }

  lines.push(`    </nodes>`);
  lines.push(`    <edges>`);

  data.edges.forEach((e, i) => {
    lines.push(
      `      <edge id="${i}" source="${xmlEscape(nodeId(e.source))}" target="${xmlEscape(nodeId(e.target))}" weight="${e.weight}"/>`,
    );
  });

  lines.push(`    </edges>`);
  lines.push(`  </graph>`);
  lines.push(`</gexf>`);

  downloadFile(lines.join("\n"), "clustr-graph.gexf", "application/xml");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
