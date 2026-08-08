import { STORAGE_KEYS, getGraphContentMode } from "../config";
import type { AIMessage, AppState, GraphNode } from "../core/types";
import { callAI } from "../ai/provider";
import { hasApiKey } from "../ai/key-store";
import { canRequest, requestStarted, requestEnded } from "../ai/rate-limit";
import {
  CHAT_SYSTEM_PROMPT,
  buildGraphContext,
  buildFocusContext,
} from "../ai/prompts";
import { el, append, clear } from "../utils/dom";
import { bus } from "../utils/events";
import { renderMarkdown } from "../utils/markdown";
import { getJSON, setJSON } from "../utils/storage";

let chatHistory: AIMessage[] = loadChatHistory();
let chatAbort: AbortController | null = null;

function loadChatHistory(): AIMessage[] {
  return getJSON<AIMessage[]>(STORAGE_KEYS.chatHistory) ?? [];
}

function saveChatHistory(): void {
  // Keep last 50 messages to avoid filling localStorage
  const toSave = chatHistory.slice(-50);
  setJSON(STORAGE_KEYS.chatHistory, toSave);
}

let focusedNodes: GraphNode[] = [];

// Track selected nodes for graph-steered chat
bus.on("graph:nodeSelected", ({ node }) => {
  if (!focusedNodes.find((n) => n.id === node.id)) focusedNodes.push(node);
  updateFocusChips();
});
bus.on("graph:nodeDeselected", ({ nodeId }) => {
  focusedNodes = focusedNodes.filter((n) => n.id !== nodeId);
  updateFocusChips();
});
bus.on("graph:selectionCleared", () => {
  focusedNodes = [];
  updateFocusChips();
});

let focusChipBar: HTMLElement | null = null;
function updateFocusChips(): void {
  if (!focusChipBar) return;
  focusChipBar.innerHTML = "";
  if (focusedNodes.length === 0) {
    focusChipBar.style.display = "none";
    return;
  }
  focusChipBar.style.display = "flex";
  for (const node of focusedNodes) {
    const chip = document.createElement("span");
    chip.className = "focus-chip";
    chip.textContent = node.label;
    focusChipBar.appendChild(chip);
  }
}

/** Render the chat panel. */
export function createChatPanel(target: HTMLElement, state: AppState): void {
  clear(target);

  // Messages area
  const messagesContainer = el("div", {
    cls: "chat-messages",
    attrs: { id: "chat-messages" },
  });

  // Render existing messages
  for (const msg of chatHistory) {
    const msgEl = createMessageElement(msg);
    messagesContainer.appendChild(msgEl);
  }

  if (chatHistory.length === 0) {
    const welcome = el("div", {
      cls: ["chat-message", "system"],
      text: "Ask me about the knowledge graph, patterns, or ideas.",
    });
    messagesContainer.appendChild(welcome);
  }

  // Focus chip bar (shows selected graph nodes)
  focusChipBar = el("div", { cls: "focus-chip-bar" });
  focusChipBar.style.display = focusedNodes.length > 0 ? "flex" : "none";
  updateFocusChips();

  // Input area
  const inputArea = el("div", { cls: "chat-input-area" });
  const chatInput = el("textarea", {
    cls: "chat-input",
    attrs: { placeholder: "Ask about the graph...", rows: "1" },
  }) as HTMLTextAreaElement;

  const sendBtn = el("button", {
    cls: ["chat-send-btn", "primary"],
    text: "\u27A4",
  });

  const sendMessage = async () => {
    const text = chatInput.value.trim();
    if (!text) return;

    // Always read the current model from state (user may change it in settings)
    const model = state.activeModel;

    if (!hasApiKey("openrouter")) {
      const errEl = el("div", {
        cls: ["chat-message", "error"],
        text: "Please configure your OpenRouter API key in Settings.",
      });
      messagesContainer.appendChild(errEl);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      return;
    }

    // Add user message
    chatHistory.push({ role: "user", content: text });
    saveChatHistory();
    const userMsg = el("div", { cls: ["chat-message", "user"], text });
    messagesContainer.appendChild(userMsg);
    chatInput.value = "";

    // Typing indicator
    const typing = el("div", { cls: "chat-typing" });
    for (let i = 0; i < 3; i++)
      typing.appendChild(el("div", { cls: "chat-typing-dot" }));
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    const blocked = canRequest();
    if (blocked) {
      typing.remove();
      const warnEl = el("div", {
        cls: ["chat-message", "error"],
        text: blocked,
      });
      messagesContainer.appendChild(warnEl);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      return;
    }

    // Abort any previous in-flight chat request
    if (chatAbort) chatAbort.abort();
    chatAbort = new AbortController();
    const { signal } = chatAbort;

    requestStarted();
    bus.emit("ai:responseStart");

    try {
      // Build context from graph with content mode awareness
      const contentMode = getGraphContentMode();
      const topicData = state.topicExtractionResult
        ? {
            topics: state.topicExtractionResult.topics.map((t) => ({
              label: t.label,
              description: t.description,
            })),
            relations: state.topicExtractionResult.relations.map((r) => ({
              source: r.source,
              target: r.target,
              description: r.description,
            })),
          }
        : null;

      let context = state.graphData
        ? buildGraphContext(
            state.clusters,
            state.gaps,
            [...state.graphData.nodes]
              .sort((a, b) => b.degree - a.degree)
              .slice(0, 20)
              .map((n) => n.label),
            state.graphStats,
            state.sentimentResult?.distribution,
            contentMode,
            topicData,
          )
        : "No graph data available yet.";

      // Append focus context if nodes are selected
      if (focusedNodes.length > 0) {
        context += buildFocusContext(focusedNodes);
      }

      // Trim to last 10 messages to avoid exceeding token limits
      const recentHistory = chatHistory.slice(-10);
      const messages: AIMessage[] = [
        { role: "system", content: `${CHAT_SYSTEM_PROMPT}\n\n${context}` },
        ...recentHistory,
      ];

      const response = await callAI(
        model.model,
        messages,
        undefined,
        undefined,
        signal,
      );
      typing.remove();

      chatHistory.push({ role: "assistant", content: response.content });
      saveChatHistory();
      const assistantMsg = createMessageElement({
        role: "assistant",
        content: response.content,
      });
      messagesContainer.appendChild(assistantMsg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;

      bus.emit("ai:responseEnd", { content: response.content });
    } catch (err) {
      typing.remove();
      if ((err as Error).name === "AbortError") return;
      const msg = (err as Error).message;
      const errEl = el("div", {
        cls: ["chat-message", "error"],
        text: `Error: ${msg}`,
      });
      messagesContainer.appendChild(errEl);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      bus.emit("ai:error", { message: msg });
    } finally {
      requestEnded();
    }
  };

  sendBtn.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  append(inputArea, chatInput, sendBtn);

  // Use flex layout on target
  target.style.display = "flex";
  target.style.flexDirection = "column";
  target.style.padding = "0";
  target.style.overflow = "hidden";

  append(target, messagesContainer, focusChipBar, inputArea);
}

/** Create a message element with optional copy button for assistant messages. */
function createMessageElement(msg: AIMessage): HTMLElement {
  const msgEl = el("div", { cls: ["chat-message", msg.role] });

  if (msg.role === "assistant") {
    // Create wrapper for content
    const contentEl = el("div", { cls: "chat-message-content" });
    contentEl.innerHTML = renderMarkdown(msg.content);
    msgEl.appendChild(contentEl);

    // Add copy button
    const copyBtn = el("button", {
      cls: "chat-copy-btn",
      text: "\uD83D\uDCCB",
      attrs: { title: "Copy to clipboard", "aria-label": "Copy to clipboard" },
    });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(msg.content);
        copyBtn.textContent = "\u2713";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "\uD83D\uDCCB";
          copyBtn.classList.remove("copied");
        }, 2000);
      } catch {
        // Fallback for older browsers
        const textarea = document.createElement("textarea");
        textarea.value = msg.content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        copyBtn.textContent = "\u2713";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.textContent = "\uD83D\uDCCB";
          copyBtn.classList.remove("copied");
        }, 2000);
      }
    });
    msgEl.appendChild(copyBtn);
  } else {
    msgEl.textContent = msg.content;
  }

  return msgEl;
}

/** Clear chat history. */
export function clearChat(): void {
  chatHistory = [];
  saveChatHistory();
}
