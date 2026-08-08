import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";
import {
  Group,
  SphereGeometry,
  MeshLambertMaterial,
  MeshBasicMaterial,
  Mesh,
  RingGeometry,
  DoubleSide,
} from "three";
import {
  NODE_SIZE_RANGE,
  SENTIMENT_COLORS,
  STORAGE_KEYS,
  getGraphViewMode,
  getGraphContentMode,
} from "../config";
import { getNodeColor } from "../core/graph-engine";
import type { GraphData, GraphNode } from "../core/types";
import { bus } from "../utils/events";
import { el, append, clear } from "../utils/dom";
import { setItem } from "../utils/storage";
import { syncNotesPanel } from "./graph-view";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Graph3DInstance = any;
type Node3D = any;

let graph3d: Graph3DInstance = null;
let currentSelection = new Set<string>();
let sentimentMode = false;
let activeResizeObserver: ResizeObserver | null = null;
let activeKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
let busCleanups: (() => void)[] = [];

/**
 * Shared sphere/material caches so large graphs don't allocate a fresh
 * geometry + material per node every render/selection refresh.
 */
const sphereGeoCache = new Map<string, SphereGeometry>();
const nodeMatCache = new Map<string, MeshLambertMaterial>();

/** Render 3D force graph in the container. */
export function renderGraph3D(container: HTMLElement, data: GraphData): void {
  sentimentMode = false;
  clear(container);

  if (data.nodes.length === 0) {
    renderEmptyState(container);
    return;
  }

  // Create wrapper for 3D canvas
  const wrapper = el("div", { cls: "graph-3d-wrapper" });
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";
  container.appendChild(wrapper);

  const width = container.clientWidth;
  const height = container.clientHeight;

  // Scale for node sizes
  const maxDegree = Math.max(...data.nodes.map((n) => n.degree), 1);
  const nodeScale = (degree: number) =>
    NODE_SIZE_RANGE[0] +
    (degree / maxDegree) * (NODE_SIZE_RANGE[1] - NODE_SIZE_RANGE[0]);

  // Build node/edge data for 3d-force-graph
  const graphData = {
    nodes: data.nodes.map((n) => ({
      ...n,
      __size: nodeScale(n.degree),
      __color: getNodeColor(n),
    })),
    links: data.edges.map((e) => ({
      source: typeof e.source === "string" ? e.source : e.source.id,
      target: typeof e.target === "string" ? e.target : e.target.id,
      weight: e.weight,
    })),
  };

  // Selection detail panel (created before graph so handlers can reference it)
  const detailPanel = el("div", {
    cls: "selection-detail",
    attrs: { id: "selection-detail-3d" },
  });
  const detailHeader = el("div", { cls: "selection-detail-header" });
  const detailTitle = el("div", { cls: "selection-detail-title" });
  const detailClose = el("button", {
    cls: "selection-detail-close",
    text: "\u2715",
    attrs: { "aria-label": "Close detail panel" },
  });
  append(detailHeader, detailTitle, detailClose);
  const detailMeta = el("div", { cls: "selection-detail-meta" });
  const detailExcerpts = el("div", { cls: "selection-detail-excerpts" });
  append(detailPanel, detailHeader, detailMeta, detailExcerpts);
  container.appendChild(detailPanel);

  // ESC hint pill
  const escHint = el("div", { cls: "esc-hint", text: "Press ESC to deselect" });
  container.appendChild(escHint);

  const showEscHint = () => escHint.classList.add("visible");
  const hideEscHint = () => escHint.classList.remove("visible");

  // Forward declarations for functions used in graph handlers
  let showSelectionDetail: (node: GraphNode, allNodes: GraphNode[]) => void;
  let updateSelectionVisuals: () => void;
  let toggleNodeSelection: (node: Node3D) => void;

  const clearSelection = () => {
    detailPanel.classList.remove("visible");
    syncNotesPanel(false);
    currentSelection.clear();
    updateSelectionVisuals();
    hideEscHint();
    bus.emit("graph:selectionCleared");
  };

  detailClose.addEventListener("click", clearSelection);

  // Initialize 3D graph with performance optimizations
  graph3d = new ForceGraph3D(wrapper)
    .width(width)
    .height(height)
    .backgroundColor("rgba(0,0,0,0)")
    .nodeId("id")
    .nodeLabel((node: Node3D) => {
      if (node.nodeType === "folder") {
        return `📁 ${node.label} (${node.fileCount ?? 0} files)`;
      }
      const sentLabel =
        node.sentiment > 0.15 ? "+" : node.sentiment < -0.15 ? "-" : "~";
      return `${node.label}\nDegree: ${node.degree} | Freq: ${node.frequency} | Sentiment: ${sentLabel}${node.sentiment.toFixed(2)}`;
    })
    .nodeColor((node: Node3D) =>
      sentimentMode ? getSentimentColor(node.sentiment) : node.__color,
    )
    .nodeVal((node: Node3D) => Math.pow(node.__size, 1.5))
    .nodeOpacity(0.9)
    .nodeThreeObject((node: Node3D) => {
      const isSelected = currentSelection.has(node.id);
      const hasSelection = currentSelection.size > 0;
      const nodeColor = sentimentMode
        ? getSentimentColor(node.sentiment)
        : node.__color;
      const radius = node.__size * 0.4;

      // Reuse low-poly sphere geometry for nodes of the same (quantized) size.
      const geoKey = radius.toFixed(1);
      let geometry = sphereGeoCache.get(geoKey);
      if (!geometry) {
        // Reduced polygon count (8 segments instead of 16).
        geometry = new SphereGeometry(Number(geoKey) || radius, 8, 6);
        sphereGeoCache.set(geoKey, geometry);
      }

      // Reuse materials for identical (color, selection-state) combinations.
      const matKey = `${nodeColor}|${hasSelection ? "sel" : "none"}|${isSelected ? "1" : "0"}`;
      let material = nodeMatCache.get(matKey);
      if (!material) {
        material = new MeshLambertMaterial({
          color: nodeColor,
          transparent: hasSelection,
          opacity: hasSelection ? (isSelected ? 1 : 0.15) : 0.9,
          emissive: isSelected ? nodeColor : "#000000",
          emissiveIntensity: isSelected ? 0.4 : 0,
        });
        nodeMatCache.set(matKey, material);
      }
      const sphere = new Mesh(geometry, material);

      // Only create group + extras for selected or high-degree nodes
      if (isSelected || node.degree >= 3) {
        const group = new Group();
        group.add(sphere);

        // Selection ring (only for selected)
        if (isSelected) {
          const ringGeometry = new RingGeometry(radius * 1.3, radius * 1.6, 16);
          const ringMaterial = new MeshBasicMaterial({
            color: "#ffffff",
            transparent: true,
            opacity: 0.7,
            side: DoubleSide,
          });
          group.add(new Mesh(ringGeometry, ringMaterial));
        }

        // Label for high-degree or selected nodes
        if (node.degree >= 3 || isSelected) {
          const sprite = new SpriteText(node.label);
          sprite.color = "#ffffff";
          sprite.textHeight = Math.max(3, node.__size * 0.35);
          sprite.backgroundColor = isSelected
            ? "rgba(99, 140, 255, 0.8)"
            : "rgba(0,0,0,0.5)";
          sprite.padding = 1;
          sprite.borderRadius = 2;
          sprite.position.y = radius + sprite.textHeight + 2;
          group.add(sprite);
        }

        return group;
      }

      return sphere;
    })
    .nodeThreeObjectExtend(false)
    .linkSource("source")
    .linkTarget("target")
    .linkWidth((link: Node3D) => Math.sqrt(link.weight ?? 1) * 0.5)
    .linkOpacity(0.3)
    .linkColor(() => "rgba(150, 160, 180, 0.4)")
    .warmupTicks(50)
    .cooldownTicks(100)
    .onNodeClick((node: Node3D, event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey) {
        bus.emit("graph:excludeNode", { nodeId: node.id });
        return;
      }
      toggleNodeSelection(node);
    })
    .onNodeRightClick((node: Node3D) => {
      if (currentSelection.has(node.id)) {
        currentSelection.delete(node.id);
        bus.emit("graph:nodeDeselected", { nodeId: node.id });
        updateSelectionVisuals();
        // Update or hide detail panel
        if (currentSelection.size === 0) {
          detailPanel.classList.remove("visible");
          syncNotesPanel(false);
          hideEscHint();
        } else {
          // Show remaining selection
          const remaining = data.nodes.find((n) => currentSelection.has(n.id));
          if (remaining) showSelectionDetail(remaining, data.nodes);
        }
      }
    })
    .graphData(graphData as unknown as { nodes: object[]; links: object[] });

  // Keyboard handler
  if (activeKeydownHandler) {
    document.removeEventListener("keydown", activeKeydownHandler);
  }
  activeKeydownHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape" && currentSelection.size > 0) clearSelection();
  };
  document.addEventListener("keydown", activeKeydownHandler);

  // Graph controls
  const controls = el("div", { cls: "graph-controls" });
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
    cls: sentimentMode ? "active" : "",
    attrs: {
      title: "Toggle sentiment colors",
      "aria-label": "Toggle sentiment colors",
    },
  });
  append(controls, resetBtn, clearSelBtn, sentimentBtn);
  container.appendChild(controls);

  resetBtn.addEventListener("click", () => {
    graph3d?.cameraPosition({ x: 0, y: 0, z: 350 }, { x: 0, y: 0, z: 0 }, 1000);
  });

  // Set initial camera position after graph stabilizes
  setTimeout(() => {
    graph3d?.cameraPosition({ x: 0, y: 0, z: 350 }, { x: 0, y: 0, z: 0 }, 500);
  }, 300);

  clearSelBtn.addEventListener("click", clearSelection);

  sentimentBtn.addEventListener("click", () => {
    sentimentMode = !sentimentMode;
    sentimentBtn.classList.toggle("active", sentimentMode);
    // Refresh node colors by triggering nodeColor recalculation
    if (graph3d) {
      graph3d.nodeColor((node: Node3D) =>
        sentimentMode ? getSentimentColor(node.sentiment) : node.__color,
      );
      // Also refresh 3D objects to update material colors
      graph3d.nodeThreeObject(graph3d.nodeThreeObject());
    }
  });

  // 2D/3D toggle
  const viewToggle = el("div", { cls: "graph-view-toggle" });
  const currentMode = getGraphViewMode();
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
    if (getGraphViewMode() === "2d") return;
    setItem(STORAGE_KEYS.graphViewMode, "2d");
    btn2d.classList.add("active");
    btn3d.classList.remove("active");
    bus.emit("graph:viewModeChanged", { mode: "2d" });
  });

  btn3d.addEventListener("click", () => {
    if (getGraphViewMode() === "3d") return;
    setItem(STORAGE_KEYS.graphViewMode, "3d");
    btn3d.classList.add("active");
    btn2d.classList.remove("active");
    bus.emit("graph:viewModeChanged", { mode: "3d" });
  });

  // Content mode toggle (Keywords/Topics)
  const contentToggle = el("div", { cls: "graph-content-toggle" });
  const currentContentMode = getGraphContentMode();
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
    if (getGraphContentMode() === "keywords") return;
    setItem(STORAGE_KEYS.graphContentMode, "keywords");
    btnKeywords.classList.add("active");
    btnTopics.classList.remove("active");
    bus.emit("graph:contentModeChanged", { mode: "keywords" });
  });

  btnTopics.addEventListener("click", () => {
    if (getGraphContentMode() === "topics") return;
    setItem(STORAGE_KEYS.graphContentMode, "topics");
    btnTopics.classList.add("active");
    btnKeywords.classList.remove("active");
    bus.emit("graph:contentModeChanged", { mode: "topics" });
  });

  // Assign function implementations to forward-declared variables
  toggleNodeSelection = (node: Node3D): void => {
    if (currentSelection.has(node.id)) {
      currentSelection.delete(node.id);
      bus.emit("graph:nodeDeselected", { nodeId: node.id });
    } else {
      currentSelection.add(node.id);
      bus.emit("graph:nodeSelected", { node });
    }
    updateSelectionVisuals();
    showSelectionDetail(node, data.nodes);
    if (currentSelection.size > 0) showEscHint();
    else hideEscHint();
  };

  updateSelectionVisuals = (): void => {
    if (!graph3d) return;
    // Refresh node objects to reflect selection state
    graph3d.nodeThreeObject(graph3d.nodeThreeObject());
  };

  showSelectionDetail = (node: GraphNode, allNodes: GraphNode[]): void => {
    if (currentSelection.size === 0) {
      detailPanel.classList.remove("visible");
      syncNotesPanel(false);
      return;
    }

    const isTopicMode = node.nodeType === "topic";

    if (currentSelection.size > 1) {
      const selected = allNodes.filter((n) => currentSelection.has(n.id));
      detailTitle.textContent = selected.map((n) => n.label).join(" + ");
      detailExcerpts.innerHTML = "";

      if (isTopicMode) {
        // For topics, show combined descriptions
        detailMeta.textContent = `${selected.length} topics selected`;
        for (const n of selected) {
          const excerpts = n.excerpts ?? [];
          if (excerpts.length > 0) {
            const item = el("div", { cls: "selection-excerpt-item" });
            item.innerHTML = `<strong>${n.label}:</strong> ${excerpts[0]}`;
            detailExcerpts.appendChild(item);
          }
        }
      } else {
        // For keywords, find sentences containing ALL selected terms
        const intersecting = findIntersectingExcerpts(selected);
        detailMeta.textContent = `${intersecting.length} sentence${intersecting.length !== 1 ? "s" : ""} contain all selected terms`;
        if (intersecting.length === 0) {
          detailExcerpts.textContent =
            "No sentences contain all selected terms.";
        } else {
          for (const excerpt of intersecting.slice(0, 15)) {
            const item = el("div", {
              cls: "selection-excerpt-item",
              text: excerpt,
            });
            detailExcerpts.appendChild(item);
          }
        }
      }
    } else {
      detailTitle.textContent = node.label;
      detailExcerpts.innerHTML = "";

      if (isTopicMode) {
        // Topic node - show description and keywords
        detailMeta.textContent = `Connections: ${node.degree} · Importance: ${(node.betweenness * 100).toFixed(0)}%`;
        const excerpts = node.excerpts ?? [];
        if (excerpts.length === 0) {
          detailExcerpts.textContent = "No description available.";
        } else {
          // First excerpt is description
          const descItem = el("div", { cls: "selection-excerpt-item" });
          descItem.innerHTML = excerpts[0];
          detailExcerpts.appendChild(descItem);

          // Show keywords
          const keywords = excerpts
            .slice(1)
            .filter((e) => e.startsWith("Keyword: "));
          if (keywords.length > 0) {
            const kwItem = el("div", { cls: "selection-excerpt-item" });
            kwItem.innerHTML = `<strong>Keywords:</strong> ${keywords.map((k) => k.replace("Keyword: ", "")).join(", ")}`;
            detailExcerpts.appendChild(kwItem);
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
        detailMeta.textContent = `Degree: ${node.degree} · Freq: ${node.frequency} · Topic: ${node.community} · Sentiment: ${sentLabel}`;
        const excerpts = node.excerpts ?? [];
        if (excerpts.length === 0) {
          detailExcerpts.textContent = "No excerpts available.";
        } else {
          for (const excerpt of excerpts.slice(0, 10)) {
            const item = el("div", {
              cls: "selection-excerpt-item",
              text: excerpt,
            });
            detailExcerpts.appendChild(item);
          }
        }
      }
    }
    detailPanel.classList.add("visible");
    syncNotesPanel(true);
  };

  // External highlight events
  for (const unsub of busCleanups) unsub();
  busCleanups = [];

  busCleanups.push(
    bus.on("graph:highlightNode", ({ nodeId }) => {
      currentSelection.clear();
      currentSelection.add(nodeId);
      updateSelectionVisuals();
      showEscHint();
      const target = data.nodes.find((n) => n.id === nodeId);
      if (target) {
        showSelectionDetail(target, data.nodes);
        // Zoom to node
        const gNode = graphData.nodes.find((n) => n.id === nodeId) as
          | (GraphNode & { x?: number; y?: number; z?: number })
          | undefined;
        if (gNode?.x != null && gNode.y != null && gNode.z != null) {
          graph3d?.cameraPosition(
            { x: gNode.x + 100, y: gNode.y + 100, z: gNode.z + 100 },
            { x: gNode.x, y: gNode.y, z: gNode.z },
            1000,
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
      updateSelectionVisuals();
      showEscHint();
      detailPanel.classList.remove("visible");
      syncNotesPanel(false);
    }),
  );

  // Handle resize
  if (activeResizeObserver) activeResizeObserver.disconnect();
  activeResizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    graph3d?.width(w).height(h);
  });
  activeResizeObserver.observe(container);
}

/** Find sentences that contain ALL selected node labels. */
function findIntersectingExcerpts(nodes: GraphNode[]): string[] {
  if (nodes.length === 0) return [];
  let result = [...(nodes[0].excerpts ?? [])];
  for (let i = 1; i < nodes.length; i++) {
    const label = nodes[i].label.toLowerCase();
    result = result.filter((s) => s.toLowerCase().includes(label));
  }
  const firstLabel = nodes[0].label.toLowerCase();
  return result.filter((s) => s.toLowerCase().includes(firstLabel));
}

/** Get sentiment-based color. */
function getSentimentColor(score: number): string {
  if (score > 0.15) return SENTIMENT_COLORS.positive;
  if (score < -0.15) return SENTIMENT_COLORS.negative;
  return SENTIMENT_COLORS.neutral;
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

/** Destroy the 3D graph and clean up. */
export function destroyGraph3D(): void {
  if (graph3d) {
    graph3d._destructor?.();
    graph3d = null;
  }
  sphereGeoCache.clear();
  nodeMatCache.clear();
  currentSelection.clear();
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

/** Get current graph instance (for external access). */
export function getGraph3DInstance(): Graph3DInstance {
  return graph3d;
}
