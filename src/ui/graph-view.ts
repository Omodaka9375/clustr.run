import * as d3 from "d3";
import {
  FORCE_CHARGE_STRENGTH,
  FORCE_LINK_DISTANCE,
  FORCE_CENTER_STRENGTH,
  FORCE_COLLISION_RADIUS,
  SIMULATION_WARMUP_TICKS,
  NODE_SIZE_RANGE,
  EDGE_WIDTH_RANGE,
  LABEL_DEGREE_THRESHOLD,
  CLUSTER_COLORS,
  DEFAULT_NODE_COLOR,
  SENTIMENT_COLORS,
  STORAGE_KEYS,
  getGraphViewMode,
  getGraphContentMode,
  type GraphViewMode,
  type GraphContentMode,
} from "../config";
import { getNodeColor } from "../core/graph-engine";
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  PeelLayer,
  SourceMeta,
} from "../core/types";
import { bus } from "../utils/events";
import { el, append, clear } from "../utils/dom";
import { setItem } from "../utils/storage";
import { getYouTubeThumbnail } from "../import/youtube";

type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimEdge = GraphEdge & { source: SimNode; target: SimNode };

/** Injected function to find source metadata for an excerpt. */
let _findSourceForExcerpt: (excerpt: string) => SourceMeta | null = () => null;

/** Set the source-lookup function (called from main.ts to avoid circular import). */
export function setSourceLookup(
  fn: (excerpt: string) => SourceMeta | null,
): void {
  _findSourceForExcerpt = fn;
}

let simulation: d3.Simulation<SimNode, SimEdge> | null = null;
let currentSelection = new Set<string>();
let sentimentMode = false;
// Re-read from storage each time to stay in sync across view switches
const getCurrentViewMode = (): GraphViewMode => getGraphViewMode();
const getCurrentContentMode = (): GraphContentMode => getGraphContentMode();
let busCleanups: (() => void)[] = [];
let activeKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
let activeResizeObserver: ResizeObserver | null = null;
let _peelEls: {
  unpeelBtn: HTMLElement;
  resetBtn: HTMLElement;
  crumbs: HTMLElement;
} | null = null;

/** Keep notes panel from overlapping the context explorer drawer. */
export function syncNotesPanel(drawerVisible: boolean): void {
  document
    .querySelector(".notes-panel")
    ?.classList.toggle("drawer-open", drawerVisible);
}

/** Render the interactive force graph in the container. */
export function renderGraph(container: HTMLElement, data: GraphData): void {
  sentimentMode = false;
  clear(container);

  if (data.nodes.length === 0) {
    renderEmptyState(container);
    return;
  }

  // Use a helper for live dimensions so resize doesn't stale
  const getWidth = () => container.clientWidth;
  const getHeight = () => container.clientHeight;
  const width = getWidth();
  const height = getHeight();

  // Scales
  const maxDegree = d3.max(data.nodes, (n) => n.degree) ?? 1;
  const nodeScale = d3
    .scaleLinear()
    .domain([0, maxDegree])
    .range(NODE_SIZE_RANGE);

  const maxWeight = d3.max(data.edges, (e) => e.weight) ?? 1;
  const edgeScale = d3
    .scaleLinear()
    .domain([1, maxWeight])
    .range(EDGE_WIDTH_RANGE);

  // SVG
  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // SVG gradient & filter definitions
  const defs = svg.append("defs");
  const gradientColors = [
    ...new Set<string>([...CLUSTER_COLORS, DEFAULT_NODE_COLOR]),
  ];
  for (const color of gradientColors) {
    const id = `ng-${color.slice(1)}`;
    const grad = defs
      .append("radialGradient")
      .attr("id", id)
      .attr("cx", "30%")
      .attr("cy", "30%")
      .attr("r", "70%");
    // Lighter version of color at center for subtle 3D highlight
    grad
      .append("stop")
      .attr("offset", "0%")
      .attr("stop-color", d3.color(color)?.brighter(0.8)?.formatHex() ?? color)
      .attr("stop-opacity", 1);
    grad
      .append("stop")
      .attr("offset", "60%")
      .attr("stop-color", color)
      .attr("stop-opacity", 1);
    grad
      .append("stop")
      .attr("offset", "100%")
      .attr("stop-color", d3.color(color)?.darker(0.3)?.formatHex() ?? color)
      .attr("stop-opacity", 1);
  }

  // Zoom behaviour
  const g = svg.append("g");
  const ZOOM_LABEL_THRESHOLD = 1.4;
  let currentZoomScale = 1;
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 8])
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
      const prev = currentZoomScale;
      currentZoomScale = event.transform.k;
      // Toggle low-degree labels when crossing the zoom threshold
      if (
        prev < ZOOM_LABEL_THRESHOLD !==
        currentZoomScale < ZOOM_LABEL_THRESHOLD
      ) {
        labels.style("display", (d) =>
          d.degree >= LABEL_DEGREE_THRESHOLD ||
          currentZoomScale >= ZOOM_LABEL_THRESHOLD
            ? "block"
            : "none",
        );
      }
    });
  svg.call(zoom);

  // Center initially
  svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2));

  // Tooltip (hover)
  const tooltip = el("div", { cls: "node-tooltip" });
  const tooltipTitle = el("div", { cls: "tooltip-title" });
  const tooltipMeta = el("div", { cls: "tooltip-meta" });
  const tooltipExcerpt = el("div", { cls: "tooltip-excerpt" });
  append(tooltip, tooltipTitle, tooltipMeta, tooltipExcerpt);
  container.appendChild(tooltip);

  // Selection detail panel (persistent, scrollable)
  const detailPanel = el("div", {
    cls: "selection-detail",
    attrs: { id: "selection-detail" },
  });
  const detailHeader = el("div", { cls: "selection-detail-header" });
  const detailTitle = el("div", {
    cls: "selection-detail-title",
    attrs: { id: "detail-title" },
  });
  const detailCopy = el("button", {
    cls: "selection-detail-copy",
    text: "\uD83D\uDCCB",
    attrs: { title: "Copy excerpts", "aria-label": "Copy excerpts" },
  });
  const detailClose = el("button", {
    cls: "selection-detail-close",
    text: "\u2715",
    attrs: { "aria-label": "Close detail panel" },
  });
  const detailActions = el("div", { cls: "selection-detail-actions" });
  append(detailActions, detailCopy, detailClose);
  append(detailHeader, detailTitle, detailActions);
  const detailMeta = el("div", {
    cls: "selection-detail-meta",
    attrs: { id: "detail-meta" },
  });
  const detailExcerpts = el("div", {
    cls: "selection-detail-excerpts",
    attrs: { id: "detail-excerpts" },
  });
  append(detailPanel, detailHeader, detailMeta, detailExcerpts);
  container.appendChild(detailPanel);

  // ESC hint pill
  const escHint = el("div", { cls: "esc-hint", text: "Press ESC to deselect" });
  container.appendChild(escHint);

  const showEscHint = () => escHint.classList.add("visible");
  const hideEscHint = () => escHint.classList.remove("visible");

  const clearSelection = () => {
    detailPanel.classList.remove("visible");
    syncNotesPanel(false);
    currentSelection.clear();
    updateSelectionVisuals(nodes, edges, labels, data);
    hideEscHint();
    bus.emit("graph:selectionCleared");
  };

  detailClose.addEventListener("click", clearSelection);
  detailCopy.addEventListener("click", () => {
    const text = Array.from(detailExcerpts.querySelectorAll(".excerpt-text"))
      .map((el) => (el as HTMLElement).textContent ?? "")
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard.writeText(text).catch(() => {});
    detailCopy.textContent = "\u2713";
    setTimeout(() => (detailCopy.textContent = "\uD83D\uDCCB"), 1200);
  });

  // Clean up previous keydown handler before adding a new one
  if (activeKeydownHandler) {
    document.removeEventListener("keydown", activeKeydownHandler);
  }
  activeKeydownHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape" && currentSelection.size > 0) clearSelection();
  };
  document.addEventListener("keydown", activeKeydownHandler);

  // Edges
  const edges = g
    .append("g")
    .attr("class", "edges")
    .selectAll<SVGLineElement, SimEdge>("line")
    .data(data.edges as SimEdge[])
    .join("line")
    .attr("class", "graph-edge")
    .attr("stroke-width", (d) => edgeScale(d.weight));

  // Nodes
  const nodes = g
    .append("g")
    .attr("class", "nodes")
    .selectAll<SVGGElement, SimNode>("g")
    .data(data.nodes as SimNode[])
    .join("g")
    .attr("class", "graph-node");

  // Glow halo (soft blur behind each node)
  nodes
    .append("circle")
    .attr("class", "node-glow")
    .attr("r", (d) => nodeScale(d.degree) + 6)
    .attr("fill", (d) => getNodeColor(d))
    .attr("opacity", (d) => 0.08 + Math.min(d.degree / maxDegree, 1) * 0.15);

  // Main circle with radial gradient
  nodes
    .append("circle")
    .attr("class", "node-core")
    .attr("r", (d) => nodeScale(d.degree))
    .attr("fill", (d) => `url(#ng-${getNodeColor(d).slice(1)})`);

  // Outer ring
  nodes
    .append("circle")
    .attr("class", "node-ring")
    .attr("r", (d) => nodeScale(d.degree) + 1.5)
    .attr("fill", "none")
    .attr("stroke", (d) => getNodeColor(d))
    .attr("stroke-width", 0.5)
    .attr("stroke-opacity", 0.25);

  // Labels
  const labels = g
    .append("g")
    .attr("class", "labels")
    .selectAll<SVGTextElement, SimNode>("text")
    .data(data.nodes as SimNode[])
    .join("text")
    .attr("class", "graph-label")
    .attr("dy", (d) => nodeScale(d.degree) + 14)
    .attr("text-anchor", "middle")
    .text((d) => d.label)
    .style("display", (d) =>
      d.degree >= LABEL_DEGREE_THRESHOLD ? "block" : "none",
    );

  // Drag behaviour - only reheat simulation if actual movement occurs
  let dragMoved = false;
  const drag = d3
    .drag<SVGGElement, SimNode>()
    .on("start", (_event, d) => {
      dragMoved = false;
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      // Only reheat simulation on first actual movement
      if (!dragMoved) {
        dragMoved = true;
        if (!event.active) simulation?.alphaTarget(0.3).restart();
      }
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (dragMoved && !event.active) simulation?.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });

  nodes.call(drag);

  // Add folder icon to folder nodes
  nodes
    .filter((d) => d.nodeType === "folder")
    .append("text")
    .attr("class", "folder-icon")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-size", (d) => Math.max(10, nodeScale(d.degree) * 0.8))
    .text("\uD83D\uDCC1"); // 📁

  // Node interactions
  nodes
    .on("mouseover", (_event, d) => {
      tooltipTitle.textContent = d.label;
      if (d.nodeType === "folder") {
        // Folder node tooltip
        tooltipMeta.textContent = `\uD83D\uDCC1 Folder | ${d.fileCount ?? 0} files | ${d.degree} connections`;
        tooltipExcerpt.textContent = d.folderPath ?? "";
      } else {
        // Keyword node tooltip
        const sentLabel =
          d.sentiment > 0.15
            ? "\u2795"
            : d.sentiment < -0.15
              ? "\u2796"
              : "\u25CF";
        tooltipMeta.textContent = `Degree: ${d.degree} | Freq: ${d.frequency} | Topic: ${d.community} | Sentiment: ${sentLabel} ${d.sentiment.toFixed(2)}`;
        tooltipExcerpt.textContent =
          d.excerpts.slice(0, 2).join("\n\n") || "No excerpts";
      }
      tooltip.classList.add("visible");
    })
    .on("mousemove", (event) => {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${event.clientX - rect.left + 12}px`;
      tooltip.style.top = `${event.clientY - rect.top - 10}px`;
    })
    .on("mouseout", () => {
      tooltip.classList.remove("visible");
    })
    .on("click", (event, d) => {
      // Ctrl+click → exclude node
      if (event.ctrlKey || event.metaKey) {
        bus.emit("graph:excludeNode", { nodeId: d.id });
        return;
      }
      // Shift+click → additive toggle (multi-select)
      if (event.shiftKey) {
        toggleNodeSelection(d, nodes, edges, labels, data);
      } else {
        // Normal click → single-select (replace selection)
        const wasSelected = currentSelection.has(d.id);
        currentSelection.clear();
        if (!wasSelected) {
          currentSelection.add(d.id);
          bus.emit("graph:nodeSelected", { node: d });
        }
        updateSelectionVisuals(nodes, edges, labels, data);
      }
      // Show detail for a representative selected node
      if (currentSelection.size > 0) {
        const target =
          (data.nodes as SimNode[]).find((n) => currentSelection.has(n.id)) ??
          d;
        showSelectionDetail(
          target,
          detailPanel,
          detailTitle,
          detailMeta,
          detailExcerpts,
          data.nodes as SimNode[],
        );
        showEscHint();
      } else {
        detailPanel.classList.remove("visible");
        syncNotesPanel(false);
        hideEscHint();
      }
    });

  // Simulation
  simulation = d3
    .forceSimulation<SimNode>(data.nodes as SimNode[])
    .force(
      "link",
      d3
        .forceLink<SimNode, SimEdge>(data.edges as SimEdge[])
        .id((d) => d.id)
        .distance(FORCE_LINK_DISTANCE)
        .strength((d) => Math.min(d.weight / maxWeight, 1)),
    )
    .force("charge", d3.forceManyBody().strength(FORCE_CHARGE_STRENGTH))
    .force("center", d3.forceCenter(0, 0).strength(FORCE_CENTER_STRENGTH))
    .force(
      "collision",
      d3
        .forceCollide<SimNode>()
        .radius((d) => nodeScale(d.degree) + FORCE_COLLISION_RADIUS),
    );

  /** Apply current positions to all SVG elements. */
  const applyPositions = () => {
    edges
      .attr("x1", (d) => d.source.x!)
      .attr("y1", (d) => d.source.y!)
      .attr("x2", (d) => d.target.x!)
      .attr("y2", (d) => d.target.y!);
    nodes.attr("transform", (d) => `translate(${d.x},${d.y})`);
    labels.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
  };

  // Run simulation warmup in rAF-batched chunks to avoid blocking the main thread
  if (SIMULATION_WARMUP_TICKS > 0) {
    simulation.stop();
    const CHUNK = 50;
    let ticksDone = 0;
    const warmupChunk = () => {
      if (!simulation) return; // destroyed during warmup
      const end = Math.min(ticksDone + CHUNK, SIMULATION_WARMUP_TICKS);
      for (let i = ticksDone; i < end; i++) simulation.tick();
      ticksDone = end;
      applyPositions();
      if (ticksDone < SIMULATION_WARMUP_TICKS) {
        requestAnimationFrame(warmupChunk);
      } else {
        // Done warming up — restart with low alpha for settling + drag
        simulation.alpha(0.1).restart();
      }
    };
    requestAnimationFrame(warmupChunk);
  }

  simulation.on("tick", applyPositions);

  // Graph controls
  const controls = el("div", { cls: "graph-controls" });
  const zoomInBtn = el("button", {
    text: "+",
    attrs: { title: "Zoom in", "aria-label": "Zoom in" },
  });
  const zoomOutBtn = el("button", {
    text: "\u2212",
    attrs: { title: "Zoom out", "aria-label": "Zoom out" },
  });
  const resetBtn = el("button", {
    text: "\u21BA",
    attrs: { title: "Reset view", "aria-label": "Reset view" },
  });
  const clearSelBtn = el("button", {
    text: "\u25CB",
    attrs: { title: "Clear selection", "aria-label": "Clear selection" },
  });
  const sentimentBtn = el("button", {
    text: "\u263A",
    attrs: {
      title: "Toggle sentiment colors",
      "aria-label": "Toggle sentiment colors",
    },
  });
  const peelBtn = el("button", {
    text: "\u25BD",
    attrs: {
      title: "Peel layer \u2014 remove top influential nodes",
      "aria-label": "Peel layer",
    },
  });
  append(
    controls,
    zoomInBtn,
    zoomOutBtn,
    resetBtn,
    clearSelBtn,
    sentimentBtn,
    peelBtn,
  );
  container.appendChild(controls);

  // Peel breadcrumb bar
  const peelBar = el("div", { cls: "peel-bar" });
  const peelCrumbs = el("div", { cls: "peel-crumbs" });
  const unpeelBtn = el("button", {
    cls: "peel-action",
    text: "\u2190 Unpeel",
    attrs: { title: "Undo last peel", "aria-label": "Unpeel" },
  });
  const resetPeelBtn = el("button", {
    cls: "peel-action",
    text: "Reset All",
    attrs: { title: "Restore all peeled layers", "aria-label": "Reset peels" },
  });
  unpeelBtn.style.display = "none";
  resetPeelBtn.style.display = "none";
  append(peelBar, peelCrumbs, unpeelBtn, resetPeelBtn);
  container.appendChild(peelBar);
  _peelEls = { unpeelBtn, resetBtn: resetPeelBtn, crumbs: peelCrumbs };

  peelBtn.addEventListener("click", () => bus.emit("graph:peelLayer"));
  unpeelBtn.addEventListener("click", () => bus.emit("graph:unpeelLayer"));
  resetPeelBtn.addEventListener("click", () =>
    bus.emit("graph:resetPeelLayers"),
  );

  // 2D/3D view mode toggle (bottom-left)
  const viewToggle = el("div", { cls: "graph-view-toggle" });
  const currentMode = getCurrentViewMode();
  const btn2d = el("button", {
    cls: currentMode === "2d" ? "active" : "",
    text: "2D",
    attrs: { title: "2D view", "aria-label": "Switch to 2D view" },
  });
  const btn3d = el("button", {
    cls: currentMode === "3d" ? "active" : "",
    text: "3D",
    attrs: { title: "3D view", "aria-label": "Switch to 3D view" },
  });
  append(viewToggle, btn2d, btn3d);
  container.appendChild(viewToggle);

  btn2d.addEventListener("click", () => {
    if (getCurrentViewMode() === "2d") return;
    setItem(STORAGE_KEYS.graphViewMode, "2d");
    btn2d.classList.add("active");
    btn3d.classList.remove("active");
    bus.emit("graph:viewModeChanged", { mode: "2d" });
  });

  btn3d.addEventListener("click", () => {
    if (getCurrentViewMode() === "3d") return;
    setItem(STORAGE_KEYS.graphViewMode, "3d");
    btn3d.classList.add("active");
    btn2d.classList.remove("active");
    bus.emit("graph:viewModeChanged", { mode: "3d" });
  });

  // Content mode toggle (Keywords/Topics)
  const contentToggle = el("div", { cls: "graph-content-toggle" });
  const currentContentMode = getCurrentContentMode();
  const btnKeywords = el("button", {
    cls: currentContentMode === "keywords" ? "active" : "",
    text: "Keywords",
    attrs: { title: "Show keyword graph", "aria-label": "Switch to keywords" },
  });
  const btnTopics = el("button", {
    cls: currentContentMode === "topics" ? "active" : "",
    text: "Topics",
    attrs: { title: "Show topic map (AI)", "aria-label": "Switch to topics" },
  });
  append(contentToggle, btnKeywords, btnTopics);
  container.appendChild(contentToggle);

  btnKeywords.addEventListener("click", () => {
    if (getCurrentContentMode() === "keywords") return;
    setItem(STORAGE_KEYS.graphContentMode, "keywords");
    btnKeywords.classList.add("active");
    btnTopics.classList.remove("active");
    bus.emit("graph:contentModeChanged", { mode: "keywords" });
  });

  btnTopics.addEventListener("click", () => {
    if (getCurrentContentMode() === "topics") return;
    setItem(STORAGE_KEYS.graphContentMode, "topics");
    btnTopics.classList.add("active");
    btnKeywords.classList.remove("active");
    bus.emit("graph:contentModeChanged", { mode: "topics" });
  });

  zoomInBtn.addEventListener("click", () =>
    svg.transition().call(zoom.scaleBy, 1.3),
  );
  zoomOutBtn.addEventListener("click", () =>
    svg.transition().call(zoom.scaleBy, 0.7),
  );
  resetBtn.addEventListener("click", () =>
    svg
      .transition()
      .call(
        zoom.transform,
        d3.zoomIdentity.translate(getWidth() / 2, getHeight() / 2),
      ),
  );
  clearSelBtn.addEventListener("click", () => {
    currentSelection.clear();
    updateSelectionVisuals(nodes, edges, labels, data);
    hideEscHint();
    bus.emit("graph:selectionCleared");
  });

  sentimentBtn.addEventListener("click", () => {
    sentimentMode = !sentimentMode;
    sentimentBtn.classList.toggle("active", sentimentMode);
    if (sentimentMode) {
      nodes
        .select(".node-core")
        .attr("fill", (d) => getSentimentColor(d.sentiment));
      nodes
        .select(".node-glow")
        .attr("fill", (d) => getSentimentColor(d.sentiment));
      nodes
        .select(".node-ring")
        .attr("stroke", (d) => getSentimentColor(d.sentiment));
    } else {
      nodes
        .select(".node-core")
        .attr("fill", (d) => `url(#ng-${getNodeColor(d).slice(1)})`);
      nodes.select(".node-glow").attr("fill", (d) => getNodeColor(d));
      nodes.select(".node-ring").attr("stroke", (d) => getNodeColor(d));
    }
  });

  // Right-click → deselect node if selected
  nodes.on("contextmenu", (event, d) => {
    event.preventDefault();
    if (currentSelection.has(d.id)) {
      currentSelection.delete(d.id);
      bus.emit("graph:nodeDeselected", { nodeId: d.id });
      updateSelectionVisuals(nodes, edges, labels, data);
      if (currentSelection.size === 0) {
        detailPanel.classList.remove("visible");
        syncNotesPanel(false);
        hideEscHint();
      } else {
        // Update detail panel to show remaining selection
        const remaining = (data.nodes as SimNode[]).find((n) =>
          currentSelection.has(n.id),
        );
        if (remaining) {
          showSelectionDetail(
            remaining,
            detailPanel,
            detailTitle,
            detailMeta,
            detailExcerpts,
            data.nodes as SimNode[],
          );
        }
      }
    }
  });

  // ── External highlight events ──
  for (const unsub of busCleanups) unsub();
  busCleanups = [];

  busCleanups.push(
    bus.on("graph:highlightNode", ({ nodeId }) => {
      currentSelection.clear();
      currentSelection.add(nodeId);
      updateSelectionVisuals(nodes, edges, labels, data);
      showEscHint();
      const target = (data.nodes as SimNode[]).find((n) => n.id === nodeId);
      if (target) {
        showSelectionDetail(
          target,
          detailPanel,
          detailTitle,
          detailMeta,
          detailExcerpts,
          data.nodes as SimNode[],
        );
        // Pan to node
        if (target.x != null && target.y != null) {
          svg
            .transition()
            .duration(500)
            .call(
              zoom.transform,
              d3.zoomIdentity
                .translate(getWidth() / 2, getHeight() / 2)
                .scale(1.5)
                .translate(-target.x, -target.y),
            );
        }
      }
    }),
  );

  busCleanups.push(
    bus.on("graph:highlightCluster", ({ clusterId }) => {
      currentSelection.clear();
      for (const n of data.nodes) {
        if (n.community === clusterId) currentSelection.add(n.id);
      }
      updateSelectionVisuals(nodes, edges, labels, data);
      showEscHint();
      detailPanel.classList.remove("visible");
      syncNotesPanel(false);
    }),
  );

  // Handle resize — disconnect previous observer first
  if (activeResizeObserver) activeResizeObserver.disconnect();
  activeResizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    svg.attr("width", w).attr("height", h);
  });
  activeResizeObserver.observe(container);
}

function toggleNodeSelection(
  node: SimNode,
  nodes: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>,
  edges: d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown>,
  labels: d3.Selection<SVGTextElement, SimNode, SVGGElement, unknown>,
  data: GraphData,
): void {
  if (currentSelection.has(node.id)) {
    currentSelection.delete(node.id);
    bus.emit("graph:nodeDeselected", { nodeId: node.id });
  } else {
    currentSelection.add(node.id);
    bus.emit("graph:nodeSelected", { node });
  }
  updateSelectionVisuals(nodes, edges, labels, data);
}

function updateSelectionVisuals(
  nodes: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>,
  edges: d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown>,
  labels: d3.Selection<SVGTextElement, SimNode, SVGGElement, unknown>,
  data: GraphData,
): void {
  if (currentSelection.size === 0) {
    nodes.classed("selected", false).classed("dimmed", false);
    edges.classed("highlighted", false).classed("dimmed", false);
    labels.classed("dimmed", false);
    return;
  }

  // Find neighbors of selected nodes
  const neighbors = new Set<string>(currentSelection);
  for (const edge of data.edges) {
    const src =
      typeof edge.source === "string"
        ? edge.source
        : (edge.source as SimNode).id;
    const tgt =
      typeof edge.target === "string"
        ? edge.target
        : (edge.target as SimNode).id;
    if (currentSelection.has(src)) neighbors.add(tgt);
    if (currentSelection.has(tgt)) neighbors.add(src);
  }

  nodes
    .classed("selected", (d) => currentSelection.has(d.id))
    .classed("dimmed", (d) => !neighbors.has(d.id));

  edges
    .classed("highlighted", (d) => {
      const src = (d.source as SimNode).id;
      const tgt = (d.target as SimNode).id;
      return currentSelection.has(src) || currentSelection.has(tgt);
    })
    .classed("dimmed", (d) => {
      const src = (d.source as SimNode).id;
      const tgt = (d.target as SimNode).id;
      return !currentSelection.has(src) && !currentSelection.has(tgt);
    });

  labels.classed("dimmed", (d) => !neighbors.has(d.id));
}

function showSelectionDetail(
  node: SimNode,
  panel: HTMLElement,
  titleEl: HTMLElement,
  metaEl: HTMLElement,
  excerptsEl: HTMLElement,
  allNodes?: SimNode[],
): void {
  if (currentSelection.size === 0) {
    panel.classList.remove("visible");
    syncNotesPanel(false);
    return;
  }

  const isTopicMode = node.nodeType === "topic";

  // Multi-node drill-down
  if (currentSelection.size > 1 && allNodes) {
    const selectedNodes = allNodes.filter((n) => currentSelection.has(n.id));
    const labels = selectedNodes.map((n) => n.label);
    titleEl.textContent = labels.join(" + ");

    excerptsEl.innerHTML = "";

    if (isTopicMode) {
      // For topics, show combined descriptions and keywords
      metaEl.textContent = `${selectedNodes.length} topics selected`;
      for (const n of selectedNodes) {
        const excerpts = n.excerpts ?? [];
        if (excerpts.length > 0) {
          const item = el("div", { cls: "selection-excerpt-item" });
          const textSpan = el("span", { cls: "excerpt-text" });
          textSpan.innerHTML = `<strong>${n.label}:</strong> ${excerpts[0]}`;
          item.appendChild(textSpan);
          excerptsEl.appendChild(item);
        }
      }
    } else {
      // For keywords, find sentences containing ALL selected terms
      const intersecting = findIntersectingExcerpts(selectedNodes);
      metaEl.textContent = `${intersecting.length} sentence${intersecting.length !== 1 ? "s" : ""} contain all selected terms`;

      if (intersecting.length === 0) {
        excerptsEl.textContent = "No sentences contain all selected terms.";
      } else {
        for (const excerpt of intersecting) {
          const item = createExcerptItem(excerpt, labels);
          excerptsEl.appendChild(item);
        }
      }
    }
  } else {
    // Single node mode
    titleEl.textContent = node.label;

    if (isTopicMode) {
      // Topic node - show description and keywords
      metaEl.textContent = `Connections: ${node.degree} \u00B7 Importance: ${(node.betweenness * 100).toFixed(0)}%`;
      excerptsEl.innerHTML = "";
      const excerpts = node.excerpts ?? [];
      if (excerpts.length === 0) {
        excerptsEl.textContent = "No description available.";
      } else {
        // First excerpt is description, rest are keywords
        const descItem = el("div", { cls: "selection-excerpt-item" });
        descItem.innerHTML = `<span class="excerpt-text">${excerpts[0]}</span>`;
        excerptsEl.appendChild(descItem);

        // Show keywords
        const keywords = excerpts
          .slice(1)
          .filter((e) => e.startsWith("Keyword: "));
        if (keywords.length > 0) {
          const kwItem = el("div", { cls: "selection-excerpt-item" });
          kwItem.innerHTML = `<span class="excerpt-text"><strong>Keywords:</strong> ${keywords.map((k) => k.replace("Keyword: ", "")).join(", ")}</span>`;
          excerptsEl.appendChild(kwItem);
        }
      }
    } else {
      // Keyword node - show sentiment and excerpts
      const sentLabel =
        node.sentiment > 0.15
          ? "Positive"
          : node.sentiment < -0.15
            ? "Negative"
            : "Neutral";
      metaEl.textContent = `Degree: ${node.degree} \u00B7 Freq: ${node.frequency} \u00B7 Topic: ${node.community} \u00B7 Sentiment: ${sentLabel}`;

      excerptsEl.innerHTML = "";
      const excerpts = node.excerpts ?? [];
      if (excerpts.length === 0) {
        excerptsEl.textContent = "No excerpts available.";
      } else {
        for (const excerpt of excerpts) {
          const item = createExcerptItem(excerpt, [node.label]);
          excerptsEl.appendChild(item);
        }
      }
    }
  }

  panel.classList.add("visible");
  syncNotesPanel(true);
}

/** Create an excerpt item with optional link icon and preview. */
function createExcerptItem(excerpt: string, terms: string[]): HTMLElement {
  const item = el("div", { cls: "selection-excerpt-item" });

  // Try to find source metadata for this excerpt
  const sourceMeta = _findSourceForExcerpt(excerpt);
  const url = sourceMeta?.url || extractUrl(excerpt);

  if (url || sourceMeta) {
    item.classList.add("has-link");

    const linkUrl = url || "#";
    const linkBtn = el("a", {
      cls: "excerpt-link-icon",
      attrs: {
        href: linkUrl,
        target: "_blank",
        rel: "noopener",
        title: sourceMeta?.title || getDomain(linkUrl),
        "aria-label": `Open ${sourceMeta?.title || getDomain(linkUrl)}`,
      },
    });

    // Use appropriate icon based on source type
    if (sourceMeta?.type === "youtube" && sourceMeta.videoId) {
      linkBtn.innerHTML = `<span class="source-badge youtube">\u25B6</span>`;
    } else {
      linkBtn.innerHTML = `<img src="${getFaviconUrl(linkUrl)}" alt="" width="14" height="14" />`;
    }

    // Build rich preview tooltip
    const preview = createRichPreview(sourceMeta, linkUrl);
    linkBtn.appendChild(preview);

    // Position the fixed-position preview above the icon on hover
    linkBtn.addEventListener("mouseenter", () => {
      const rect = linkBtn.getBoundingClientRect();
      preview.style.left = `${rect.left + rect.width / 2}px`;
      preview.style.transform = "translateX(-50%)";
      // Place above icon; if too close to top, flip below
      const previewHeight = preview.offsetHeight || 120;
      if (rect.top - previewHeight - 8 < 0) {
        preview.style.top = `${rect.bottom + 8}px`;
        preview.style.bottom = "auto";
      } else {
        preview.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        preview.style.top = "auto";
      }
    });

    item.appendChild(linkBtn);
  }

  const textSpan = el("span", { cls: "excerpt-text" });
  textSpan.innerHTML = highlightTerms(excerpt, terms);
  item.appendChild(textSpan);

  return item;
}

/** Create a rich preview tooltip with thumbnail support. */
function createRichPreview(
  sourceMeta: SourceMeta | null,
  url: string,
): HTMLElement {
  const preview = el("div", { cls: "link-preview" });

  // YouTube special handling - show video thumbnail
  if (sourceMeta?.type === "youtube" && sourceMeta.videoId) {
    preview.classList.add("link-preview-youtube");

    const thumb = el("div", { cls: "link-preview-thumb" });
    const thumbImg = el("img", {
      attrs: {
        src: getYouTubeThumbnail(sourceMeta.videoId, "mq"),
        alt: "",
        loading: "lazy",
      },
    }) as HTMLImageElement;
    thumbImg.onerror = () => {
      thumb.style.display = "none";
    };
    thumb.appendChild(thumbImg);

    // Play icon overlay
    const playIcon = el("span", { cls: "link-preview-play", text: "\u25B6" });
    thumb.appendChild(playIcon);

    preview.appendChild(thumb);
  } else if (sourceMeta?.thumbnail) {
    // Show OG thumbnail for URLs
    preview.classList.add("link-preview-with-thumb");

    const thumb = el("div", { cls: "link-preview-thumb" });
    const thumbImg = el("img", {
      attrs: {
        src: sourceMeta.thumbnail,
        alt: "",
        loading: "lazy",
      },
    }) as HTMLImageElement;
    thumbImg.onerror = () => {
      thumb.style.display = "none";
    };
    thumb.appendChild(thumbImg);
    preview.appendChild(thumb);
  }

  // Header with favicon and title
  const header = el("div", { cls: "link-preview-header" });

  if (sourceMeta?.type !== "youtube") {
    const favicon = el("img", {
      cls: "link-preview-favicon",
      attrs: { src: getFaviconUrl(url), alt: "", width: "16", height: "16" },
    });
    header.appendChild(favicon);
  }

  const titleText = sourceMeta?.title || getDomain(url);
  const title = el("span", {
    cls: "link-preview-title",
    text: titleText.length > 50 ? titleText.slice(0, 50) + "..." : titleText,
  });
  header.appendChild(title);

  preview.appendChild(header);

  // Source type badge
  if (sourceMeta?.type) {
    const badge = el("span", {
      cls: `link-preview-badge badge-${sourceMeta.type}`,
      text: getSourceBadgeText(sourceMeta.type),
    });
    preview.appendChild(badge);
  }

  // URL line
  const domain = sourceMeta?.domain || getDomain(url);
  const urlLine = el("span", { cls: "link-preview-url", text: domain });
  preview.appendChild(urlLine);

  return preview;
}

/** Get display text for source type badge. */
function getSourceBadgeText(type: string): string {
  switch (type) {
    case "youtube":
      return "YouTube";
    case "rss":
      return "RSS";
    case "url":
      return "Web";
    case "image":
      return "Image";
    case "file":
      return "File";
    default:
      return type;
  }
}

/** Find sentences that contain ALL selected node labels. */
function findIntersectingExcerpts(nodes: GraphNode[]): string[] {
  if (nodes.length === 0) return [];
  // Start with the first node's excerpts, then filter
  let result = [...(nodes[0].excerpts ?? [])];
  for (let i = 1; i < nodes.length; i++) {
    const label = nodes[i].label.toLowerCase();
    result = result.filter((s) => s.toLowerCase().includes(label));
  }
  // Also check first node's label is in all remaining
  const firstLabel = nodes[0].label.toLowerCase();
  return result.filter((s) => s.toLowerCase().includes(firstLabel));
}

/** URL regex pattern for detection. */
const URL_REGEX =
  /https?:\/\/[^\s<>"'\]\)]+(?:\([^\s<>"'\]\)]*\)|[^\s<>"'\]\).,:;!?])/gi;

/** Extract first URL from text, if any. */
function extractUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

/** Get domain from URL for display. */
function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

/** Get favicon URL for a domain. */
function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch {
    return "";
  }
}

/** Highlight terms and linkify URLs in text. */
function highlightTerms(text: string, terms: string[]): string {
  // Decode HTML entities first (e.g. &nbsp; → actual space)
  const decoded = decodeHtmlEntities(text);
  let html = escapeHtml(decoded);

  // First, linkify URLs (before term highlighting to avoid breaking URLs)
  html = html.replace(URL_REGEX, (url) => {
    const domain = getDomain(url);
    return `<a href="${url}" class="excerpt-link" target="_blank" rel="noopener" data-url="${url}" data-domain="${domain}">${domain}</a>`;
  });

  // Then highlight search terms
  for (const term of terms) {
    const escaped = escapeHtml(term);
    const regex = new RegExp(
      `(${escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    html = html.replace(regex, "<mark>$1</mark>");
  }
  return html;
}

/** Decode HTML entities to their character equivalents. */
function decodeHtmlEntities(str: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = str;
  return textarea.value;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Continuous diverging color scale for sentiment. */
const sentimentColorScale = d3
  .scaleLinear<string>()
  .domain([-1, -0.15, 0, 0.15, 1])
  .range([
    SENTIMENT_COLORS.negative,
    SENTIMENT_COLORS.negative,
    SENTIMENT_COLORS.neutral,
    SENTIMENT_COLORS.positive,
    SENTIMENT_COLORS.positive,
  ])
  .clamp(true);

/** Get a sentiment-based color using a continuous diverging scale. */
function getSentimentColor(score: number): string {
  return sentimentColorScale(score);
}

function renderEmptyState(container: HTMLElement): void {
  const empty = el("div", { cls: "graph-empty" });
  const text = el("div", {
    cls: "graph-empty-text",
    text: "Paste, drop or upload data to generate a knowledge graph",
  });
  append(empty, text);
  container.appendChild(empty);
}

/** Destroy the current simulation and clean up listeners. */
export function destroyGraph(): void {
  if (simulation) {
    simulation.stop();
    simulation = null;
  }
  currentSelection.clear();
  sentimentMode = false;
  _peelEls = null;
  for (const unsub of busCleanups) unsub();
  busCleanups = [];
  if (activeKeydownHandler) {
    document.removeEventListener("keydown", activeKeydownHandler);
    activeKeydownHandler = null;
  }
  if (activeResizeObserver) {
    activeResizeObserver.disconnect();
    activeResizeObserver = null;
  }
}

/** Update peel layer breadcrumbs. */
export function updatePeelDisplay(layers: PeelLayer[]): void {
  if (!_peelEls) return;
  const { unpeelBtn, resetBtn, crumbs } = _peelEls;
  const has = layers.length > 0;
  unpeelBtn.style.display = has ? "" : "none";
  resetBtn.style.display = has ? "" : "none";
  clear(crumbs);
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const preview =
      l.removedLabels.slice(0, 3).join(", ") +
      (l.removedLabels.length > 3 ? "\u2026" : "");
    const chip = el("span", {
      cls: "peel-chip",
      text: `L${l.depth}: ${preview}`,
    });
    crumbs.appendChild(chip);
    if (i < layers.length - 1) {
      crumbs.appendChild(el("span", { cls: "peel-arrow", text: "\u2192" }));
    }
  }
}
