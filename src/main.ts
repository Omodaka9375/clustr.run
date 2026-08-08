import {
  STORAGE_KEYS,
  getGraphViewMode,
  getGraphContentMode,
  getOcrLanguage,
} from "./config";
import type {
  AppState,
  NLPResult,
  GraphData,
  SourceMeta,
  SourceBlock,
} from "./core/types";
import {
  buildGraph,
  buildCompareGraph,
  extractClusters,
  buildTopicGraph,
  peelTopNodes,
  removeNodesFromGraph,
} from "./core/graph-engine";
import { extractTopics, clearTopicCache } from "./ai/topic-extractor";
import { getActiveModel, getModelById } from "./ai/models";
import { findStructuralGaps } from "./core/gap-analysis";
import { analyzeSentiment, computeNodeSentiment } from "./core/sentiment";
import { computeGraphStats } from "./core/graph-stats";
import { createAppShell, showToast } from "./ui/app-shell";
import {
  renderGraph,
  destroyGraph,
  setSourceLookup,
  updatePeelDisplay,
} from "./ui/graph-view";
import { renderGraph3D, destroyGraph3D } from "./ui/graph-view-3d";
import { createInputPanel } from "./ui/input-panel";
import { renderAnalysisPanel, clearAICache } from "./ui/analysis-panel";
import { createChatPanel } from "./ui/chat-panel";
import { createSettingsPanel } from "./ui/settings-panel";
import { createHelpPanel } from "./ui/help-panel";
import {
  exportGraphJSON,
  exportGraphSVG,
  exportGraphPNG,
  exportKeywordsCSV,
  exportAnalyticsCSV,
  exportGexf,
} from "./ui/export";
import { bus } from "./utils/events";
import { $ } from "./utils/dom";
import { initStorage, getItem, setItem } from "./utils/storage";
import { parseFile } from "./import/file-parser";
import { logError } from "./utils/logger";
import { showWelcomeIfFirstVisit } from "./ui/welcome-modal";
import { initNotesPanel } from "./ui/notes-panel";

/* ── Capture PWA install prompt early ── */
window.addEventListener(
  "beforeinstallprompt",
  (e) => {
    e.preventDefault();
    (window as unknown as Record<string, Event>).__pwaPrompt = e;
  },
  { once: true },
);

/* ── App state ── */

const state: AppState = {
  rawText: "",
  nlpResult: null,
  graphData: null,
  topicGraphData: null,
  topicExtractionResult: null,
  clusters: [],
  gaps: [],
  graphStats: null,
  sentimentResult: null,
  textSnapshots: [],
  selectedNodes: new Set(),
  excludedNodes: new Set(),
  peelLayers: [],
  activePanel: "input",
  activeModel: getActiveModel(),
  chatHistory: [],
  isProcessing: false,
  sourceBlocks: [],
};

/** Add a source block to track where imported text came from. */
function addSourceBlock(
  text: string,
  meta: SourceMeta,
  startOffset: number,
): void {
  state.sourceBlocks.push({
    start: startOffset,
    end: startOffset + text.length,
    meta,
  });
}

/** Find source metadata for a given text excerpt. */
export function findSourceForExcerpt(excerpt: string): SourceMeta | null {
  // Find which source block contains this excerpt
  const excerptLower = excerpt.toLowerCase().slice(0, 100); // Use first 100 chars for matching
  for (const block of state.sourceBlocks) {
    const blockText = state.rawText.slice(block.start, block.end).toLowerCase();
    if (blockText.includes(excerptLower)) {
      return block.meta;
    }
  }
  return null;
}

/** Get all source blocks (for external access). */
export function getSourceBlocks(): SourceBlock[] {
  return state.sourceBlocks;
}

/** Get the raw text (for source matching). */
export function getRawText(): string {
  return state.rawText;
}

/* ── Helpers ── */

/** Save a snapshot of the current NLP state for trend tracking. */
function saveSnapshot(): void {
  if (state.nlpResult) {
    state.textSnapshots.push({
      text: state.rawText,
      timestamp: Date.now(),
      keywordFreqs: new Map(state.nlpResult.wordFrequency),
    });
  }
}

type Shell = ReturnType<typeof createAppShell>;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

/** Debounced wrapper — used for exclude/restore to batch rapid toggles. */
function debouncedProcessAndRender(shell: Shell): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    processAndRender(shell);
  }, DEBOUNCE_MS);
}

function switchPanel(panel: AppState["activePanel"], shell: Shell): void {
  state.activePanel = panel;

  // Update bottom tab highlights
  for (const tab of shell.tabEls) {
    const isActive = tab.dataset.panel === panel;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-current", isActive ? "true" : "false");
  }

  // Reset inline styles the chat panel may have applied
  shell.leftBody.removeAttribute("style");

  switch (panel) {
    case "input":
      createInputPanel(shell.leftBody);
      shell.leftPanel.classList.remove("collapsed");
      break;
    case "analysis":
      renderAnalysisPanel(shell.leftBody, state);
      shell.leftPanel.classList.remove("collapsed");
      break;
    case "chat":
      createChatPanel(shell.leftBody, state);
      shell.leftPanel.classList.remove("collapsed");
      break;
    case "settings":
      createSettingsPanel(shell.leftBody);
      shell.leftPanel.classList.remove("collapsed");
      break;
    case "help":
      createHelpPanel(shell.leftBody);
      shell.leftPanel.classList.remove("collapsed");
      break;
  }
}

/** Monotonic counter to discard stale worker responses. */
let nlpRequestId = 0;
let activeShell: Shell | null = null;

/** Reused NLP web worker (created lazily). */
let nlpWorker: Worker | null = null;

/** Worker response shape — a completed NLP task or a reported error. */
type NLPWorkerResponse =
  | (NLPResult & { _rid: number; type: "text" })
  | { _rid: number; type: "folder"; graph: GraphData }
  | { _rid: number; type: "error"; message: string };

/** Compare-mode state (set before posting textB to worker). */
let compareMode = false;
let compareNlpA: NLPResult | null = null;

/** Lazily create (and reuse) the NLP web worker. */
function getNlpWorker(): Worker {
  if (!nlpWorker) {
    nlpWorker = new Worker(
      new URL("./workers/nlp-worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return nlpWorker;
}

/** Run NLP off the main thread via a web worker. */
function runNlpAsync(text: string, rid: number): void {
  const shell = activeShell;
  if (!shell) return;

  const worker = getNlpWorker();
  worker.onmessage = (e: MessageEvent<NLPWorkerResponse>) => {
    const msg = e.data;
    // Discard if a newer request has been made
    if (msg._rid !== nlpRequestId) return;

    // Only text-analysis responses are handled here.
    if (msg.type === "error") {
      showToast(`Error: ${msg.message}`, true);
      setProcessing(false, shell);
      return;
    }
    if (msg.type !== "text") return;

    const nlpResult: NLPResult = msg;

    try {
      // Compare mode: merge two NLP results
      if (compareMode && compareNlpA) {
        compareMode = false;
        state.graphData = buildCompareGraph(compareNlpA, nlpResult);
        state.nlpResult = nlpResult; // keep B as active NLP
        compareNlpA = null;
        state.peelLayers = [];
      } else {
        state.nlpResult = nlpResult;
        state.peelLayers = [];
        state.graphData = buildGraph(state.nlpResult);
      }

      // Remove user-excluded nodes
      if (state.excludedNodes.size > 0) {
        state.graphData.nodes = state.graphData.nodes.filter(
          (n) => !state.excludedNodes.has(n.id),
        );
        const keep = new Set(state.graphData.nodes.map((n) => n.id));
        state.graphData.edges = state.graphData.edges.filter((e) => {
          const s = typeof e.source === "string" ? e.source : e.source.id;
          const t = typeof e.target === "string" ? e.target : e.target.id;
          return keep.has(s) && keep.has(t);
        });
      }

      state.clusters = extractClusters(state.graphData);
      state.gaps = findStructuralGaps(state.graphData, state.clusters);

      state.sentimentResult = analyzeSentiment(state.nlpResult.sentences);
      const sentimentMap = new Map(
        state.sentimentResult.scores.map((s) => [s.sentence, s.score]),
      );
      for (const node of state.graphData.nodes) {
        node.sentiment = computeNodeSentiment(node.excerpts, sentimentMap);
      }

      state.graphStats = computeGraphStats(state.graphData, state.clusters);

      renderCurrentGraph(shell);

      if (state.activePanel === "analysis") {
        renderAnalysisPanel(shell.leftBody, state);
      }

      setItem(STORAGE_KEYS.lastRawText, state.rawText);
      clearAICache();

      showToast(
        `Graph: ${state.graphData.nodes.length} nodes, ${state.graphData.edges.length} edges, ${state.clusters.length} clusters`,
      );

      // Switch to Analysis tab after processing
      switchPanel("analysis", shell);

      bus.emit("graph:updated", { state });
      bus.emit("analysis:ready", { state });
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, true);
    } finally {
      setProcessing(false, shell);
    }
  };

  worker.onerror = () => {
    showToast("NLP worker failed", true);
    setProcessing(false, shell);
  };

  worker.postMessage({ text, _rid: rid });
}

/** Get the appropriate graph data based on content mode. */
function getActiveGraphData() {
  const contentMode = getGraphContentMode();
  if (contentMode === "topics" && state.topicGraphData) {
    return state.topicGraphData;
  }
  return state.graphData ?? { nodes: [], edges: [] };
}

/** Render graph using current view and content mode. */
function renderCurrentGraph(shell: Shell): void {
  const viewMode = getGraphViewMode();
  const graphData = getActiveGraphData();

  // Toggle background class for themed backgrounds
  shell.graphContainer.classList.toggle("mode-3d", viewMode === "3d");

  if (viewMode === "3d") {
    destroyGraph();
    destroyGraph3D();
    renderGraph3D(shell.graphContainer, graphData);
  } else {
    destroyGraph3D();
    destroyGraph();
    renderGraph(shell.graphContainer, graphData);
  }
}

/** Rebuild graph from NLP result, re-applying excludedNodes + remaining peel layers. */
function rebuildGraphFromPeelState(shell: Shell): void {
  if (!state.nlpResult) return;
  let graph = buildGraph(state.nlpResult);

  // Apply excluded nodes
  if (state.excludedNodes.size > 0) {
    graph = removeNodesFromGraph(graph, state.excludedNodes);
  }

  // Replay remaining peel layers
  for (const layer of state.peelLayers) {
    graph = removeNodesFromGraph(graph, new Set(layer.removedIds));
  }

  state.graphData = graph;
  state.clusters = extractClusters(state.graphData);
  state.gaps = findStructuralGaps(state.graphData, state.clusters);
  state.graphStats = computeGraphStats(state.graphData, state.clusters);

  // Re-apply sentiment
  if (state.sentimentResult) {
    const sentimentMap = new Map(
      state.sentimentResult.scores.map((s) => [s.sentence, s.score]),
    );
    for (const node of state.graphData.nodes) {
      node.sentiment = computeNodeSentiment(node.excerpts, sentimentMap);
    }
  }

  renderCurrentGraph(shell);
  updatePeelDisplay(state.peelLayers);

  if (state.activePanel === "analysis") {
    renderAnalysisPanel(shell.leftBody, state);
  }

  showToast(
    `Graph: ${state.graphData.nodes.length} nodes, ${state.graphData.edges.length} edges`,
  );
}

/** Maximum text size (bytes) before refusing to process. */
const MAX_TEXT_SIZE = 2 * 1024 * 1024; // 2 MB
/** Warning threshold for large texts. */
const WARN_TEXT_SIZE = 500 * 1024; // 500 KB

/** Run NLP pipeline (off main thread) and re-render the graph + panels. */
function processAndRender(shell: Shell): void {
  const textSize = new Blob([state.rawText]).size;
  if (textSize > MAX_TEXT_SIZE) {
    showToast(
      `Text too large (${(textSize / 1024 / 1024).toFixed(1)} MB). Max is 2 MB.`,
      true,
    );
    return;
  }
  if (textSize > WARN_TEXT_SIZE) {
    showToast(
      `Large text (${(textSize / 1024).toFixed(0)} KB) — processing may be slow.`,
    );
  }
  activeShell = shell;
  setProcessing(true, shell);
  nlpRequestId++;
  runNlpAsync(state.rawText, nlpRequestId);
}

/* ── Bootstrap ── */

/** Show blocking overlay on mobile devices. Returns true if blocked. */
function blockMobile(): boolean {
  const isMobile =
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ) || window.innerWidth < 768;
  if (!isMobile) return false;

  const overlay = document.createElement("div");
  overlay.className = "mobile-block";
  overlay.innerHTML = `<div class="mobile-block-content"><div class="mobile-block-icon">⌨</div><h2>Desktop Only</h2><p>Clustr is designed for desktop and laptop screens. Please visit on a computer for the best experience.</p></div>`;
  document.body.appendChild(overlay);
  return true;
}

async function init(): Promise<void> {
  if (blockMobile()) return;
  await initStorage();
  setSourceLookup(findSourceForExcerpt);

  const app = $("#app");
  const shell = createAppShell(app);

  // Show welcome modal on first visit
  showWelcomeIfFirstVisit();

  // Initial panel rendering
  createInputPanel(shell.leftBody);

  // ── Event: text appended ──
  bus.on("text:appended", ({ text }) => {
    saveSnapshot();
    const offset = state.rawText ? state.rawText.length + 2 : 0; // +2 for "\n\n"
    state.rawText = state.rawText ? state.rawText + "\n\n" + text : text;
    // Store the computed offset so source:imported can use it
    (state as Record<string, unknown>)._lastAppendOffset = offset;
    processAndRender(shell);
  });

  // ── Event: text submitted ──
  bus.on("text:submitted", ({ text }) => {
    saveSnapshot();
    state.rawText = text;
    processAndRender(shell);
  });

  // ── Event: text cleared ──
  bus.on("text:cleared", () => {
    state.rawText = "";
    state.nlpResult = null;
    state.graphData = null;
    state.topicGraphData = null;
    state.topicExtractionResult = null;
    state.clusters = [];
    state.gaps = [];
    state.graphStats = null;
    state.sentimentResult = null;
    state.textSnapshots = [];
    state.excludedNodes.clear();
    state.peelLayers = [];
    state.sourceBlocks = [];
    setItem(STORAGE_KEYS.lastRawText, "");
    clearAICache();
    clearTopicCache();
    destroyGraph();
    destroyGraph3D();
    renderCurrentGraph(shell);
  });

  // ── Event: source imported (with metadata) ──
  bus.on("source:imported", ({ text, meta }) => {
    const offset =
      ((state as Record<string, unknown>)._lastAppendOffset as number) ?? 0;
    addSourceBlock(text, meta, offset);
  });

  // ── Event: folder uploaded ──
  bus.on("folder:uploaded", ({ folder }) => {
    setProcessing(true, shell);
    const worker = getNlpWorker();
    const rid = ++nlpRequestId;
    worker.onmessage = (e: MessageEvent<NLPWorkerResponse>) => {
      const msg = e.data;
      // Discard if a newer request has been made
      if (msg._rid !== nlpRequestId) return;
      if (msg.type === "error") {
        showToast(`Error: ${msg.message}`, true);
        setProcessing(false, shell);
        return;
      }
      if (msg.type !== "folder") return;

      try {
        // Folder graph (built off the main thread — different from text graph)
        const graphData: GraphData = msg.graph;
        state.graphData = graphData;
        state.clusters = extractClusters(graphData);
        state.gaps = []; // Folder graphs don't have structural gaps
        state.graphStats = null; // Skip stats for folder graphs
        state.nlpResult = null;
        state.rawText = "";

        renderCurrentGraph(shell);

        showToast(
          `Folder graph: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`,
        );

        // Switch to Analysis tab
        switchPanel("analysis", shell);

        bus.emit("graph:updated", { state });
      } catch (err) {
        showToast(`Error: ${(err as Error).message}`, true);
      } finally {
        setProcessing(false, shell);
      }
    };
    worker.onerror = () => {
      showToast("NLP worker failed", true);
      setProcessing(false, shell);
    };
    // Build the folder graph in the worker: it computes NLP per folder there.
    worker.postMessage({ type: "folder", folder, _rid: rid });
  });

  // ── Event: AI status (light indicator — status bar only, no graph overlay) ──
  bus.on("ai:responseStart", () => {
    state.isProcessing = true;
    shell.statusDot.classList.add("processing");
    shell.statusText.textContent = "Processing...";
  });
  bus.on("ai:responseEnd", () => {
    state.isProcessing = false;
    shell.statusDot.classList.remove("processing");
    shell.statusText.textContent = "Ready";
  });
  bus.on("ai:error", ({ message }) => {
    state.isProcessing = false;
    shell.statusDot.classList.remove("processing");
    shell.statusText.textContent = "Ready";
    showToast(message, true);
  });

  // ── Bottom tab navigation ──
  for (const tab of shell.tabEls) {
    tab.addEventListener("click", () => {
      const panel = tab.dataset.panel as AppState["activePanel"];
      switchPanel(panel, shell);
    });
  }

  // ── Event: navigate to panel (from links in other panels) ──
  bus.on("nav:panel", ({ panel }) => {
    switchPanel(panel as AppState["activePanel"], shell);
  });

  // ── Export via bus ──
  bus.on("export:trigger", ({ format }) => {
    if (!state.graphData) {
      showToast("No graph to export", true);
      return;
    }
    switch (format) {
      case "json":
        exportGraphJSON(state.graphData, state.clusters, state.gaps);
        break;
      case "svg":
        exportGraphSVG(shell.graphContainer);
        break;
      case "png":
        exportGraphPNG(shell.graphContainer);
        break;
      case "keywords-csv":
        exportKeywordsCSV(state.graphData);
        break;
      case "analytics-csv":
        exportAnalyticsCSV(state.graphData, state.clusters, state.graphStats);
        break;
      case "gexf":
        exportGexf(state.graphData, state.clusters);
        break;
    }
  });

  // ── Event: node exclusion ──
  bus.on("graph:excludeNode", ({ nodeId }) => {
    state.excludedNodes.add(nodeId);
    if (state.rawText) debouncedProcessAndRender(shell);
  });
  bus.on("graph:restoreNode", ({ nodeId }) => {
    state.excludedNodes.delete(nodeId);
    if (state.rawText) debouncedProcessAndRender(shell);
  });

  // ── Event: peel the onion ──
  const PEEL_COUNT = 5;

  bus.on("graph:peelLayer", () => {
    if (!state.graphData || state.graphData.nodes.length <= PEEL_COUNT) return;
    const { peeled, removedIds, removedLabels } = peelTopNodes(
      state.graphData,
      PEEL_COUNT,
    );
    state.peelLayers.push({
      removedIds,
      removedLabels,
      depth: state.peelLayers.length + 1,
    });
    state.graphData = peeled;
    state.clusters = extractClusters(state.graphData);
    state.gaps = findStructuralGaps(state.graphData, state.clusters);
    state.graphStats = computeGraphStats(state.graphData, state.clusters);
    renderCurrentGraph(shell);
    updatePeelDisplay(state.peelLayers);
    showToast(
      `Peeled layer ${state.peelLayers.length}: removed ${removedLabels.slice(0, 3).join(", ")}${removedLabels.length > 3 ? "\u2026" : ""}`,
    );
  });

  bus.on("graph:unpeelLayer", () => {
    if (state.peelLayers.length === 0 || !state.nlpResult) return;
    state.peelLayers.pop();
    rebuildGraphFromPeelState(shell);
  });

  bus.on("graph:resetPeelLayers", () => {
    if (state.peelLayers.length === 0 || !state.nlpResult) return;
    state.peelLayers = [];
    rebuildGraphFromPeelState(shell);
  });

  // ── Event: compare two texts ──
  bus.on("compare:submitted", ({ textB }) => {
    if (!state.nlpResult) {
      showToast("Analyze Text A first before comparing.", true);
      return;
    }
    compareNlpA = state.nlpResult;
    compareMode = true;
    setProcessing(true, shell);
    nlpRequestId++;
    runNlpAsync(textB, nlpRequestId);
  });

  // ── Event: view mode changed ──
  bus.on("graph:viewModeChanged", () => {
    if (state.graphData || state.topicGraphData) {
      renderCurrentGraph(shell);
    }
  });

  // ── Event: model changed ──
  bus.on("settings:modelChanged", ({ modelId }) => {
    const model = getModelById(modelId) ?? state.activeModel;
    state.activeModel = model;
    // Clear topic cache when model changes so topics are re-extracted with new model
    clearTopicCache();
    state.topicGraphData = null;
    state.topicExtractionResult = null;
    showToast(`Switched to ${model.displayName}`);
  });

  // ── Event: content mode changed (keywords/topics) ──
  let topicAbort: AbortController | null = null;
  bus.on("graph:contentModeChanged", async ({ mode }) => {
    if (mode === "topics") {
      // Extract topics if not already done
      if (
        !state.topicGraphData &&
        state.graphData &&
        state.clusters.length > 0
      ) {
        // Cancel any in-flight topic extraction
        if (topicAbort) topicAbort.abort();
        topicAbort = new AbortController();
        const { signal } = topicAbort;
        try {
          setProcessing(true, shell);
          const topKeywords = state.graphData.nodes
            .slice(0, 30)
            .map((n) => n.label);
          const result = await extractTopics(
            state.clusters,
            state.gaps,
            topKeywords,
            state.activeModel,
            state.rawText,
            signal,
          );
          state.topicExtractionResult = result;
          state.topicGraphData = buildTopicGraph(result);
          showToast(
            `Topic map: ${state.topicGraphData.nodes.length} topics, ${state.topicGraphData.edges.length} connections`,
          );
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          showToast(`Topic extraction failed: ${(err as Error).message}`, true);
          // Revert to keywords mode
          setItem(STORAGE_KEYS.graphContentMode, "keywords");
          bus.emit("graph:contentModeChanged", { mode: "keywords" });
          return;
        } finally {
          setProcessing(false, shell);
        }
      }
    }
    renderCurrentGraph(shell);
  });

  // ── Paste anywhere (outside text fields) → prefill Input ──
  document.addEventListener("paste", (e) => {
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;

    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) prefillFromFile(file, shell);
          return;
        }
        if (item.kind === "file") {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) prefillFromFile(file, shell);
          return;
        }
      }
    }

    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (text) {
      e.preventDefault();
      setItem(STORAGE_KEYS.editorContent, text);
      switchPanel("input", shell);
    }
  });

  // ── Drag-and-drop on graph container ──
  let dragCounter = 0;
  shell.graphContainer.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    shell.graphContainer.classList.add("drag-over");
  });
  shell.graphContainer.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      shell.graphContainer.classList.remove("drag-over");
    }
  });
  shell.graphContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  shell.graphContainer.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    shell.graphContainer.classList.remove("drag-over");

    const file = e.dataTransfer?.files?.[0];
    if (file) {
      prefillFromFile(file, shell);
      return;
    }
    const text = e.dataTransfer?.getData("text/plain")?.trim();
    if (text) {
      setItem(STORAGE_KEYS.editorContent, text);
      switchPanel("input", shell);
    }
  });

  // ── Keyboard shortcuts ──
  const PANEL_SHORTCUTS: AppState["activePanel"][] = [
    "input",
    "analysis",
    "chat",
    "settings",
    "help",
  ];

  document.addEventListener("keydown", (e) => {
    // Skip when typing in inputs
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    const inField = tag === "input" || tag === "textarea" || tag === "select";

    // Ctrl+Enter / Cmd+Enter → Analyze current text
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const text = getItem(STORAGE_KEYS.editorContent)?.trim();
      if (text) bus.emit("text:submitted", { text });
      return;
    }

    // Ctrl+1–5 / Cmd+1–5 → Switch panels
    if ((e.ctrlKey || e.metaKey) && !inField) {
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < PANEL_SHORTCUTS.length) {
        e.preventDefault();
        switchPanel(PANEL_SHORTCUTS[idx], shell);
      }
    }
  });

  // ── Register service worker ──
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // ── Initialize notes panel ──
  initNotesPanel();

  // ── Restore graph from last session ──
  const lastText = getItem(STORAGE_KEYS.lastRawText);
  if (lastText && lastText.length > 0) {
    state.rawText = lastText;
    processAndRender(shell);
  } else {
    renderCurrentGraph(shell);
  }
}

function setProcessing(processing: boolean, shell: Shell): void {
  state.isProcessing = processing;
  shell.statusDot.classList.toggle("processing", processing);
  shell.statusText.textContent = processing ? "Processing..." : "Ready";
  shell.graphContainer.classList.toggle("is-processing", processing);
}

/** Parse a dropped/pasted file and prefill the Input panel. */
async function prefillFromFile(file: File, shell: Shell): Promise<void> {
  try {
    setProcessing(true, shell);
    let text: string;
    if (file.type.startsWith("image/")) {
      // Dynamic import for tesseract (large library, code-split)
      const { createWorker } = await import("tesseract.js");
      const lang = getOcrLanguage();
      const worker = await createWorker(lang);
      const { data } = await worker.recognize(file);
      await worker.terminate();
      text = data.text;
    } else {
      text = await parseFile(file);
    }
    setItem(STORAGE_KEYS.editorContent, text);
    switchPanel("input", shell);
    showToast(`Loaded: ${file.name}`);
  } catch (err) {
    showToast(`Import error: ${(err as Error).message}`, true);
  } finally {
    setProcessing(false, shell);
  }
}

// ── Start ──
init().catch((err) => {
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;font-family:system-ui,sans-serif;color:#e4e7f0;background:#08090d;text-align:center;padding:24px">
        <h1 style="font-size:20px;margin:0">Clustr failed to start</h1>
        <p style="font-size:14px;color:#8f95a8;max-width:440px;margin:0">${(err as Error).message}</p>
        <button onclick="location.reload()" style="padding:10px 24px;background:#638cff;color:#08090d;border:none;border-radius:8px;font-weight:600;cursor:pointer">Reload</button>
      </div>`;
  }
  console.error("Clustr init failed:", err);
});

// Global error handlers — show toast if app is running, log otherwise
window.onerror = (_msg, _src, _line, _col, err) => {
  logError(err?.message ?? "Unknown", err?.stack);
  if (document.getElementById("toast-container")) {
    showToast(`Unexpected error: ${err?.message ?? "Unknown"}`, true);
  }
};
window.onunhandledrejection = (e) => {
  logError(e.reason?.message ?? String(e.reason), e.reason?.stack);
  if (document.getElementById("toast-container")) {
    showToast(
      `Unhandled error: ${e.reason?.message ?? String(e.reason)}`,
      true,
    );
  }
};
