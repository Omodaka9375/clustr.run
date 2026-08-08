import { MAX_TOP_KEYWORDS, SENTIMENT_COLORS } from "../config";
import type { AppState } from "../core/types";
import { getNodeColor } from "../core/graph-engine";
import { callAI } from "../ai/provider";
import { hasApiKey } from "../ai/key-store";
import { canRequest, requestStarted, requestEnded } from "../ai/rate-limit";
import {
  SUMMARY_PROMPT,
  RESEARCH_QUESTIONS_PROMPT,
  INSIGHTS_PROMPT,
  IDEAS_PROMPT,
  BRIDGE_GAPS_PROMPT,
  buildGraphContext,
} from "../ai/prompts";
import { STORAGE_KEYS } from "../config";
import { el, append, clear } from "../utils/dom";
import { confirmAction } from "./confirm-modal";
import { bus } from "../utils/events";
import { renderMarkdown, escapeHtml } from "../utils/markdown";
import { getItem, setItem, getJSON, setJSON } from "../utils/storage";
import { showToast } from "./app-shell";

const COLLAPSE_KEY = "clustr:collapsed-sections";

/** Read collapsed section state. */
function getCollapsed(): Set<string> {
  try {
    const raw = getItem(COLLAPSE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/** Persist collapsed section state. */
function setCollapsed(set: Set<string>): void {
  setItem(COLLAPSE_KEY, JSON.stringify([...set]));
}

/** Build a collapsible section title + content wrapper. */
function collapsibleSection(
  id: string,
  title: string,
): { section: HTMLElement; body: HTMLElement } {
  const collapsed = getCollapsed();
  const isCollapsed = collapsed.has(id);

  const section = el("div", { cls: "panel-section" });
  const header = el("div", {
    cls: `panel-section-title collapsible${isCollapsed ? " collapsed" : ""}`,
    text: title,
  });
  const chevron = el("span", { cls: "section-chevron" });
  header.appendChild(chevron);

  const body = el("div", { cls: "section-body" });
  if (isCollapsed) body.style.display = "none";

  header.addEventListener("click", () => {
    const c = getCollapsed();
    const nowCollapsed = !c.has(id);
    if (nowCollapsed) {
      c.add(id);
      header.classList.add("collapsed");
      body.style.display = "none";
    } else {
      c.delete(id);
      header.classList.remove("collapsed");
      body.style.display = "";
    }
    setCollapsed(c);
  });

  section.appendChild(header);
  section.appendChild(body);
  return { section, body };
}

/** Render the analysis panel. */
export function renderAnalysisPanel(
  target: HTMLElement,
  state: AppState,
): void {
  clear(target);

  if (!state.graphData || state.graphData.nodes.length === 0) {
    const empty = el("div", { cls: "panel-section" });
    empty.appendChild(
      el("div", { cls: "panel-section-title", text: "No data" }),
    );
    empty.appendChild(
      el("div", {
        cls: "panel-empty-hint",
        text: "Analyze text to see keywords, clusters, gaps, and AI insights.",
      }),
    );
    target.appendChild(empty);
    return;
  }

  // ── Top keywords ──
  const { section: kwSection, body: kwBody } = collapsibleSection(
    "top-keywords",
    "Top Keywords",
  );

  const kwList = el("ul", { cls: "keyword-list" });
  const topNodes = [...state.graphData.nodes]
    .sort((a, b) => b.degree - a.degree)
    .slice(0, MAX_TOP_KEYWORDS);

  for (const node of topNodes) {
    const item = el("li", { cls: "keyword-item clickable" });
    const name = el("span", { cls: "kw-name", text: node.label });
    const badge = el("span", { cls: "kw-badge", text: String(node.degree) });
    badge.style.backgroundColor = getNodeColor(node);
    const excludeBtn = el("button", {
      cls: "kw-exclude",
      text: "\u2715",
      attrs: { title: "Exclude from graph" },
    });
    excludeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmAction(`Exclude "${node.label}" from the graph?`, "Exclude").then(
        (ok) => {
          if (ok) bus.emit("graph:excludeNode", { nodeId: node.id });
        },
      );
    });
    item.addEventListener("click", () =>
      bus.emit("graph:highlightNode", { nodeId: node.id }),
    );
    append(item, name, badge, excludeBtn);
    kwList.appendChild(item);
  }
  kwBody.appendChild(kwList);

  // ── Entrance Points ──
  const epSection = el("div", { cls: "panel-section" });
  const epHeader = el("div", { cls: "panel-section-title" });
  epHeader.textContent = "Entrance Points";
  const epTooltip = el("span", {
    cls: "section-tooltip",
    text: "\u24D8",
    attrs: {
      title:
        "High-influence, low-frequency concepts. Good starting points for exploring the text.",
    },
  });
  epHeader.appendChild(epTooltip);
  epSection.appendChild(epHeader);

  // Calculate entrance score: betweenness / frequency (high influence, low frequency)
  const entranceNodes = [...state.graphData.nodes]
    .filter((n) => n.betweenness > 0 && n.frequency > 0)
    .map((n) => ({
      node: n,
      score: n.betweenness / n.frequency,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (entranceNodes.length === 0) {
    epSection.appendChild(
      el("div", {
        cls: "panel-empty-hint",
        text: "No entrance points detected.",
      }),
    );
  } else {
    const epList = el("ul", { cls: "keyword-list" });
    for (const { node } of entranceNodes) {
      const item = el("li", { cls: "keyword-item clickable" });
      const name = el("span", { cls: "kw-name", text: node.label });
      const badge = el("span", {
        cls: "kw-badge entrance-badge",
        text: "\u2197",
        attrs: { title: `Betweenness: ${node.betweenness.toFixed(3)}` },
      });
      badge.style.backgroundColor = getNodeColor(node);
      item.addEventListener("click", () =>
        bus.emit("graph:highlightNode", { nodeId: node.id }),
      );
      append(item, name, badge);
      epList.appendChild(item);
    }
    epSection.appendChild(epList);
  }

  // ── Topics ──
  const { section: clSection, body: clBody } = collapsibleSection(
    "clusters",
    `Topics (${state.clusters.length})`,
  );

  for (const cluster of state.clusters) {
    const card = el("div", { cls: "cluster-card clickable" });
    card.style.borderLeftColor = cluster.color;
    const cardTitle = el("div", {
      cls: "cluster-card-title",
      text: `Topic ${cluster.id} (${cluster.nodes.length} nodes)`,
    });
    const cardKw = el("div", {
      cls: "cluster-card-keywords",
      text: cluster.topKeywords.join(", "),
    });
    card.addEventListener("click", () =>
      bus.emit("graph:highlightCluster", { clusterId: cluster.id }),
    );
    append(card, cardTitle, cardKw);
    clBody.appendChild(card);
  }

  // ── Structural gaps ──
  const gapSection = el("div", { cls: "panel-section" });
  gapSection.appendChild(
    el("div", {
      cls: "panel-section-title",
      text: `Content Gaps (${state.gaps.length})`,
    }),
  );

  if (state.gaps.length === 0) {
    gapSection.appendChild(
      el("div", {
        cls: "panel-empty-hint",
        text: "All topic clusters are well-connected.",
      }),
    );
  } else {
    const withBridges = state.gaps.filter((g) => g.bridgeNodes.length > 0);
    const noBridgeCount = state.gaps.length - withBridges.length;

    for (const gap of withBridges.slice(0, 8)) {
      const card = el("div", { cls: "gap-card" });
      const cardTitle = el("div", {
        cls: "gap-card-title",
        text: `Topic ${gap.clusterA} \u2194 Topic ${gap.clusterB}`,
      });
      const bridges = gap.bridgeNodes.map((n) => n.label).join(", ");
      const detail = el("div", {
        cls: "gap-card-detail",
        text: `Weak link via: ${bridges}`,
      });
      append(card, cardTitle, detail);
      gapSection.appendChild(card);
    }

    if (noBridgeCount > 0) {
      const gapHint = el("div", { cls: "panel-empty-hint" });
      gapHint.textContent = `${noBridgeCount} topic${noBridgeCount > 1 ? "s are" : " is"} discussed separately with no shared concepts linking them.`;
      gapSection.appendChild(gapHint);

      // AI Bridge Ideas button
      const bridgeBtn = el("button", {
        cls: "bridge-ideas-btn",
        text: "\uD83D\uDD17 Suggest Connections",
        attrs: { title: "Ask AI how to connect isolated topics" },
      });
      const bridgeResultWrap = el("div", {
        cls: "ai-result-wrap bridge-result-wrap",
      });
      bridgeResultWrap.style.display = "none";
      const bridgeResult = el("div", { cls: "ai-result bridge-result" });
      const bridgeCopyBtn = el("button", {
        cls: "ai-copy-btn",
        text: "\uD83D\uDCCB",
        attrs: {
          title: "Copy to clipboard",
          "aria-label": "Copy to clipboard",
        },
      });
      bridgeCopyBtn.style.display = "none";
      bridgeCopyBtn.addEventListener("click", () => {
        const text = bridgeResult.innerText;
        navigator.clipboard.writeText(text).then(() => {
          showToast("Copied to clipboard");
        });
      });
      append(bridgeResultWrap, bridgeResult, bridgeCopyBtn);
      bridgeBtn.addEventListener("click", () => {
        bridgeResultWrap.style.display = "";
        // Build context about disconnected topics
        const disconnected = state.gaps.filter(
          (g) => g.bridgeNodes.length === 0,
        );
        let context =
          "The following topic pairs are completely disconnected:\n";
        for (const gap of disconnected) {
          const clusterA = state.clusters.find((c) => c.id === gap.clusterA);
          const clusterB = state.clusters.find((c) => c.id === gap.clusterB);
          context += `- Topic ${gap.clusterA} (${clusterA?.topKeywords.slice(0, 5).join(", ")}) and Topic ${gap.clusterB} (${clusterB?.topKeywords.slice(0, 5).join(", ")})\n`;
        }
        runAIAnalysisWithContext(
          BRIDGE_GAPS_PROMPT,
          context,
          state,
          bridgeResult,
          bridgeCopyBtn,
          "Connections",
        );
      });
      gapSection.appendChild(bridgeBtn);
      gapSection.appendChild(bridgeResultWrap);
    }
  }

  // ── AI Analysis actions ──
  const aiSection = el("div", { cls: "panel-section" });
  aiSection.appendChild(
    el("div", { cls: "panel-section-title", text: "AI Analysis" }),
  );

  const aiActions = el("div", { cls: "ai-actions" });
  const actions = [
    { label: "\uD83D\uDCDD Summary", prompt: SUMMARY_PROMPT, name: "Summary" },
    {
      label: "\u2753 Research Qs",
      prompt: RESEARCH_QUESTIONS_PROMPT,
      name: "Research Questions",
    },
    {
      label: "\uD83D\uDD0D Insights",
      prompt: INSIGHTS_PROMPT,
      name: "Insights",
    },
    { label: "\uD83D\uDCA1 Ideas", prompt: IDEAS_PROMPT, name: "Ideas" },
  ];

  const aiResultWrap = el("div", { cls: "ai-result-wrap" });
  const aiResult = el("div", { cls: "ai-result", attrs: { id: "ai-result" } });
  aiResult.textContent = "Click an action above to generate AI analysis.";
  const aiCopyBtn = el("button", {
    cls: "ai-copy-btn",
    text: "\uD83D\uDCCB",
    attrs: { title: "Copy to clipboard", "aria-label": "Copy to clipboard" },
  });
  aiCopyBtn.style.display = "none";
  aiCopyBtn.addEventListener("click", () => {
    const text = aiResult.innerText;
    navigator.clipboard.writeText(text).then(() => {
      showToast("Copied to clipboard");
    });
  });
  append(aiResultWrap, aiResult, aiCopyBtn);

  for (const action of actions) {
    const btn = el("button", { cls: "ai-action-btn", text: action.label });
    btn.addEventListener("click", () =>
      runAIAnalysis(action.prompt, state, aiResult, aiCopyBtn, action.name),
    );
    aiActions.appendChild(btn);
  }

  append(aiSection, aiActions, aiResultWrap);

  // ── Sentiment ──
  const sentSection = el("div", { cls: "panel-section" });
  sentSection.appendChild(
    el("div", { cls: "panel-section-title", text: "Sentiment" }),
  );

  if (state.sentimentResult) {
    const d = state.sentimentResult.distribution;
    const total = d.positive + d.negative + d.neutral;
    const bar = el("div", { cls: "sentiment-bar" });
    if (total > 0) {
      const posW = (d.positive / total) * 100;
      const negW = (d.negative / total) * 100;
      const neuW = (d.neutral / total) * 100;
      const posEl = el("div", { cls: "sentiment-bar-pos" });
      posEl.style.width = `${posW}%`;
      posEl.style.background = SENTIMENT_COLORS.positive;
      const neuEl = el("div", { cls: "sentiment-bar-neu" });
      neuEl.style.width = `${neuW}%`;
      neuEl.style.background = SENTIMENT_COLORS.neutral;
      const negEl = el("div", { cls: "sentiment-bar-neg" });
      negEl.style.width = `${negW}%`;
      negEl.style.background = SENTIMENT_COLORS.negative;
      append(bar, posEl, neuEl, negEl);
    }
    sentSection.appendChild(bar);
    const legend = el("div", { cls: "sentiment-legend" });
    legend.innerHTML = `<span style="color:${SENTIMENT_COLORS.positive}">\u25CF Positive: ${d.positive}</span> <span style="color:${SENTIMENT_COLORS.neutral}">\u25CF Neutral: ${d.neutral}</span> <span style="color:${SENTIMENT_COLORS.negative}">\u25CF Negative: ${d.negative}</span>`;
    sentSection.appendChild(legend);
  } else {
    sentSection.appendChild(
      el("div", { cls: "panel-empty-hint", text: "No sentiment data." }),
    );
  }

  // ── Diversity Meter ──
  const diversitySection = el("div", { cls: "panel-section" });
  const diversityHeader = el("div", { cls: "panel-section-title" });
  diversityHeader.textContent = "Discourse Balance";
  const diversityTooltip = el("span", {
    cls: "section-tooltip",
    text: "\u24D8",
    attrs: {
      title:
        "Measures how balanced the discourse is across topics. Low = focused/biased toward few themes. High = diverse, balanced coverage.",
    },
  });
  diversityHeader.appendChild(diversityTooltip);
  diversitySection.appendChild(diversityHeader);

  if (state.graphStats) {
    const score = state.graphStats.diversityScore;
    const meterWrap = el("div", { cls: "diversity-meter-wrap" });

    // Labels
    const labelRow = el("div", { cls: "diversity-labels" });
    labelRow.innerHTML = `<span>Focused</span><span>Balanced</span>`;
    meterWrap.appendChild(labelRow);

    // Meter track
    const meterTrack = el("div", { cls: "diversity-meter-track" });
    const meterFill = el("div", { cls: "diversity-meter-fill" });
    meterFill.style.width = `${score}%`;
    // Color based on score
    if (score < 30) {
      meterFill.style.background = "var(--warning)";
    } else if (score < 60) {
      meterFill.style.background =
        "linear-gradient(90deg, var(--warning), var(--accent))";
    } else {
      meterFill.style.background = "var(--accent)";
    }
    meterTrack.appendChild(meterFill);
    meterWrap.appendChild(meterTrack);

    // Score and interpretation
    const scoreRow = el("div", { cls: "diversity-score" });
    const interpretation =
      score > 60
        ? "Well-balanced coverage across topics"
        : score > 30
          ? "Moderate diversity — some topics dominate"
          : "Heavily focused — few topics dominate the discourse";
    scoreRow.innerHTML = `<strong>${score}/100</strong> <span class="diversity-hint">${interpretation}</span>`;
    meterWrap.appendChild(scoreRow);

    diversitySection.appendChild(meterWrap);
  } else {
    diversitySection.appendChild(
      el("div", { cls: "panel-empty-hint", text: "No data available." }),
    );
  }

  // ── Graph Statistics ──
  const statsSection = el("div", { cls: "panel-section" });
  statsSection.appendChild(
    el("div", { cls: "panel-section-title", text: "Graph Statistics" }),
  );

  if (state.graphStats) {
    const s = state.graphStats;
    const rows: [string, string, string][] = [
      ["Nodes", String(s.nodeCount), ""],
      ["Edges", String(s.edgeCount), ""],
      [
        "Density",
        s.density.toFixed(3),
        s.density < 0.1
          ? "Sparse, diverse topics"
          : s.density < 0.3
            ? "Moderately connected"
            : "Dense, focused discourse",
      ],
      [
        "Modularity",
        s.modularity.toFixed(3),
        s.modularity > 0.4
          ? "Distinct topics"
          : s.modularity > 0.2
            ? "Moderate grouping"
            : "Loosely grouped",
      ],
      [
        "Avg Path",
        s.avgPathLength.toFixed(2),
        s.avgPathLength > 4 ? "Wide-ranging topics" : "Closely related topics",
      ],
      [
        "Clustering",
        s.clusteringCoeff.toFixed(3),
        s.clusteringCoeff > 0.3 ? "Tight local groups" : "Loosely connected",
      ],
      ["Diameter", String(s.diameter), ""],
    ];
    const list = el("div", { cls: "stats-list" });
    for (const [label, value, hint] of rows) {
      const row = el("div", { cls: "stat-row" });
      row.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span>${hint ? `<span class="stat-hint">${hint}</span>` : ""}`;
      list.appendChild(row);
    }
    statsSection.appendChild(list);
  } else {
    statsSection.appendChild(
      el("div", { cls: "panel-empty-hint", text: "No statistics available." }),
    );
  }

  // ── Trends ──
  const trendSection = el("div", { cls: "panel-section" });
  trendSection.appendChild(
    el("div", { cls: "panel-section-title", text: "Trends" }),
  );

  const snapCount = state.textSnapshots.length;
  if (snapCount > 0 && state.nlpResult) {
    const prev = state.textSnapshots[state.textSnapshots.length - 1];
    const curr = state.nlpResult.wordFrequency;

    // New keywords (in current but not previous)
    const newKw: string[] = [];
    const growing: [string, number][] = [];
    for (const [word, freq] of curr) {
      const prevFreq = prev.keywordFreqs.get(word);
      if (prevFreq === undefined) {
        newKw.push(word);
      } else if (freq > prevFreq) {
        growing.push([word, freq - prevFreq]);
      }
    }
    growing.sort((a, b) => b[1] - a[1]);

    if (newKw.length > 0) {
      const newRow = el("div", { cls: "trend-row" });
      newRow.innerHTML = `<span class="trend-label">✨ New</span> <span class="trend-words">${newKw.slice(0, 10).map(escapeHtml).join(", ")}</span>`;
      trendSection.appendChild(newRow);
    }
    if (growing.length > 0) {
      const growRow = el("div", { cls: "trend-row" });
      growRow.innerHTML = `<span class="trend-label">\u{1F4C8} Growing</span> <span class="trend-words">${growing
        .slice(0, 8)
        .map(([w, d]) => `${escapeHtml(w)} (+${d})`)
        .join(", ")}</span>`;
      trendSection.appendChild(growRow);
    }
    if (newKw.length === 0 && growing.length === 0) {
      trendSection.appendChild(
        el("div", { cls: "panel-empty-hint", text: "No significant changes." }),
      );
    }

    const snapInfo = el("div", { cls: "trend-snap-info" });
    snapInfo.textContent = `Compared with snapshot ${state.textSnapshots.length} (${new Date(prev.timestamp).toLocaleTimeString()})`;
    trendSection.appendChild(snapInfo);
  } else {
    trendSection.appendChild(
      el("div", {
        cls: "panel-empty-hint",
        text: 'Use the "+ Append" button in the Input tab to add new text. Each append creates a snapshot so you can track which keywords are new or growing.',
      }),
    );
  }

  // ── Excluded nodes ──
  let excludedSection: HTMLElement | null = null;
  if (state.excludedNodes.size > 0) {
    excludedSection = el("div", { cls: "panel-section" });
    excludedSection.appendChild(
      el("div", {
        cls: "panel-section-title",
        text: `Excluded (${state.excludedNodes.size})`,
      }),
    );
    const exList = el("div", { cls: "excluded-list" });
    for (const nodeId of state.excludedNodes) {
      const row = el("div", { cls: "excluded-item" });
      const label = el("span", { cls: "excluded-label", text: nodeId });
      const restoreBtn = el("button", {
        cls: "excluded-restore",
        text: "Restore",
      });
      restoreBtn.addEventListener("click", () =>
        bus.emit("graph:restoreNode", { nodeId }),
      );
      append(row, label, restoreBtn);
      exList.appendChild(row);
    }
    excludedSection.appendChild(exList);
  }

  // ── Assemble ──
  append(
    target,
    kwSection,
    epSection,
    clSection,
    sentSection,
    diversitySection,
    statsSection,
    trendSection,
    gapSection,
    aiSection,
  );
  if (excludedSection) target.appendChild(excludedSection);
}

/** Simple hash for cache keys. */
function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

type AICache = Record<string, string>;

function getAICache(): AICache {
  return getJSON<AICache>(STORAGE_KEYS.aiCache) ?? {};
}

function setAICacheEntry(key: string, value: string): void {
  const cache = getAICache();
  cache[key] = value;
  // Keep cache bounded — evict oldest if > 20 entries
  const keys = Object.keys(cache);
  if (keys.length > 20) {
    delete cache[keys[0]];
  }
  setJSON(STORAGE_KEYS.aiCache, cache);
}

let analysisAbort: AbortController | null = null;

/** Invalidate AI cache and abort in-flight requests. */
export function clearAICache(): void {
  setJSON(STORAGE_KEYS.aiCache, {});
  if (analysisAbort) {
    analysisAbort.abort();
    analysisAbort = null;
  }
}

async function runAIAnalysis(
  systemPrompt: string,
  state: AppState,
  resultEl: HTMLElement,
  copyBtn: HTMLElement,
  actionName: string,
): Promise<void> {
  const context = buildGraphContext(
    state.clusters,
    state.gaps,
    [...state.graphData!.nodes]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 20)
      .map((n) => n.label),
  );
  return runAIAnalysisWithContext(
    systemPrompt,
    context,
    state,
    resultEl,
    copyBtn,
    actionName,
  );
}

/** Run AI analysis with custom context string. */
async function runAIAnalysisWithContext(
  systemPrompt: string,
  context: string,
  _state: AppState,
  resultEl: HTMLElement,
  copyBtn: HTMLElement,
  actionName: string,
): Promise<void> {
  // Always use the user's selected model
  const model = _state.activeModel;
  if (!hasApiKey("openrouter")) {
    resultEl.textContent = "Please configure your OpenRouter API key in Settings.";
    return;
  }

  // Check cache
  const cacheKey = hashKey(systemPrompt + context);
  const cached = getAICache()[cacheKey];
  if (cached) {
    resultEl.innerHTML = renderMarkdown(cached);
    copyBtn.style.display = "";
    return;
  }

  const blocked = canRequest();
  if (blocked) {
    resultEl.textContent = blocked;
    return;
  }

  // Abort any previous in-flight analysis request
  if (analysisAbort) analysisAbort.abort();
  analysisAbort = new AbortController();
  const { signal } = analysisAbort;

  requestStarted();
  bus.emit("ai:responseStart");
  copyBtn.style.display = "none";
  resultEl.innerHTML = `<span class="ai-loading"><span class="ai-spinner"></span>Generating ${actionName}...</span>`;

  try {
    const response = await callAI(
      model.model,
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Here is the context:\n\n${context}\n\nPlease provide your analysis.`,
        },
      ],
      undefined,
      undefined,
      signal,
    );
    resultEl.innerHTML = renderMarkdown(response.content);
    copyBtn.style.display = "";
    setAICacheEntry(cacheKey, response.content);
    bus.emit("ai:responseEnd", { content: response.content });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    const msg = (err as Error).message;
    resultEl.textContent = `Error: ${msg}`;
    bus.emit("ai:error", { message: msg });
  } finally {
    requestEnded();
  }
}
