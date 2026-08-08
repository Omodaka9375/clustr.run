import { STORAGE_KEYS } from "../config";
import { el, append } from "../utils/dom";
import { getItem, setItem } from "../utils/storage";
import { bus } from "../utils/events";

/** Apply saved theme (or default to dark). */
function applyTheme(theme: string): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Render the app shell into the target element. Returns references to key containers. */
export function createAppShell(target: HTMLElement) {
  // Apply saved theme immediately
  const savedTheme = getItem(STORAGE_KEYS.theme) ?? "dark";
  applyTheme(savedTheme);

  // ── Top bar ──
  const topbar = el("header", { cls: "topbar", attrs: { role: "banner" } });
  const logo = el("div", {
    cls: "topbar-logo",
    html: `<img class="logo-img-classic" src="/CLUSTR.png" alt="Clustr" height="40" /><span class="logo-tagline">Interactive Knowledge Graphs</span>`,
  });
  // Theme toggle (dark ↔ light)
  const topActions = el("div", { cls: "topbar-actions" });
  const themeBtn = el("button", {
    text: savedTheme === "dark" ? "\u2600" : "\u263E",
    attrs: {
      title:
        savedTheme === "dark"
          ? "Switch to light theme"
          : "Switch to dark theme",
      "aria-label": "Toggle theme",
    },
  });
  let currentTheme = savedTheme;
  themeBtn.addEventListener("click", () => {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(currentTheme);
    setItem(STORAGE_KEYS.theme, currentTheme);
    themeBtn.textContent = currentTheme === "dark" ? "\u2600" : "\u263E";
    themeBtn.title =
      currentTheme === "dark"
        ? "Switch to light theme"
        : "Switch to dark theme";
  });
  topActions.appendChild(themeBtn);

  append(topbar, logo, topActions);

  // ── Main content ──
  const mainContent = el("div", { cls: "main-content" });

  // Left panel
  const leftPanel = el("aside", {
    cls: "panel",
    attrs: {
      id: "left-panel",
      role: "complementary",
      "aria-label": "Analysis panel",
    },
  });
  const leftHeader = el("div", { cls: "panel-header" });

  const leftClose = el("button", {
    cls: "panel-close",
    text: "\u2715",
    attrs: { "aria-label": "Close panel" },
  });
  append(leftHeader, leftClose);

  const leftBody = el("div", {
    cls: "panel-body",
    attrs: { id: "left-panel-body" },
  });
  append(leftPanel, leftHeader, leftBody);

  // Graph container
  const graphContainer = el("div", {
    cls: "graph-container",
    attrs: {
      id: "graph-container",
      role: "img",
      "aria-label": "Knowledge graph visualization",
    },
  });

  append(mainContent, leftPanel, graphContainer);

  // ── Bottom bar ──
  const bottombar = el("footer", {
    cls: "bottombar",
    attrs: { role: "navigation", "aria-label": "Panel navigation" },
  });
  const tabs = [
    { id: "tab-input", label: "Input", panel: "input" },
    { id: "tab-analysis", label: "Analyze", panel: "analysis" },
    { id: "tab-chat", label: "Ask Questions", panel: "chat" },
    { id: "tab-settings", label: "Settings", panel: "settings" },
    { id: "tab-help", label: "Help", panel: "help" },
  ];

  const tabEls: HTMLElement[] = [];
  for (const tab of tabs) {
    const btn = el("button", {
      cls: "bottombar-tab",
      text: tab.label,
      attrs: { "data-panel": tab.panel, id: tab.id, role: "tab" },
    });
    tabEls.push(btn);
    bottombar.appendChild(btn);
  }

  const spacer1 = el("div", { cls: "bottombar-spacer" });
  const copyright = el("span", {
    cls: "bottombar-copyright",
    text: "\u00A9 2026 CLUSTR.RUN",
  });
  const spacer2 = el("div", { cls: "bottombar-spacer" });
  const statusDot = el("span", {
    cls: "status-dot",
    attrs: { id: "status-dot" },
  });
  const statusText = el("span", {
    cls: "bottombar-tab",
    text: "Ready",
    attrs: { id: "status-text", style: "cursor:default" },
  });
  append(bottombar, spacer1, copyright, spacer2, statusDot, statusText);

  // ── Toast container ──
  const toastContainer = el("div", {
    cls: "toast-container",
    attrs: { id: "toast-container", role: "status", "aria-live": "polite" },
  });

  // ── Assemble ──
  append(target, topbar, mainContent, bottombar, toastContainer);

  // ── Panel toggle ──
  leftClose.addEventListener("click", () => {
    leftPanel.classList.add("collapsed");
    // Deselect all tabs when panel is closed
    for (const tab of tabEls) {
      tab.classList.remove("active");
      tab.setAttribute("aria-current", "false");
    }
    bus.emit("panel:closed");
  });

  return {
    leftPanel,
    leftBody,
    graphContainer,
    topbar,
    bottombar,
    tabEls,
    statusDot,
    statusText,
    toastContainer,
  };
}

/** Show a toast notification. */
export function showToast(message: string, isError = false): void {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = el("div", {
    cls: isError ? ["toast", "error"] : "toast",
    text: message,
  });
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
