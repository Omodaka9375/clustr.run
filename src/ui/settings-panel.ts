import {
  STORAGE_KEYS,
  DEFAULT_CORS_PROXY_URL,
  getCorsProxyUrl,
  OCR_LANGUAGES,
  DEFAULT_OCR_LANGUAGE,
} from "../config";
import { getApiKey, setApiKey, clearApiKey, hasApiKey } from "../ai/key-store";
import {
  getAvailableModels,
  getActiveModel,
  getModelById,
  refreshModels,
} from "../ai/models";
import { getItem, setItem, removeItem, wipeAll } from "../utils/storage";
import { el, append, clear } from "../utils/dom";
import { confirmAction } from "./confirm-modal";
import { bus } from "../utils/events";

/** Create a collapsible section. */
function createCollapsibleSection(
  title: string,
  storageKey: string,
): { section: HTMLElement; content: HTMLElement } {
  const section = el("div", { cls: "panel-section collapsible" });
  const isCollapsed = getItem(storageKey) === "collapsed";

  const header = el("div", { cls: "panel-section-header" });
  const arrow = el("span", {
    cls: "collapse-arrow",
    text: isCollapsed ? "\u25B6" : "\u25BC",
  });
  const titleEl = el("span", { cls: "panel-section-title", text: title });
  append(header, arrow, titleEl);

  const content = el("div", { cls: "panel-section-content" });
  if (isCollapsed) content.style.display = "none";

  header.addEventListener("click", () => {
    const nowCollapsed = content.style.display === "none";
    content.style.display = nowCollapsed ? "block" : "none";
    arrow.textContent = nowCollapsed ? "\u25BC" : "\u25B6";
    setItem(storageKey, nowCollapsed ? "expanded" : "collapsed");
  });

  section.appendChild(header);
  section.appendChild(content);

  return { section, content };
}

/** Render the settings panel. */
export function createSettingsPanel(target: HTMLElement): void {
  clear(target);

  // API Keys section (collapsible)
  const { section, content: apiKeysContent } = createCollapsibleSection(
    "API Keys",
    "clustr_settings_apikeys_collapsed",
  );

  const notice = el("div", {
    cls: "setting-notice",
    text: "Clustr routes all AI requests through OpenRouter. Your key is stored in your browser's local storage (unencrypted) and sent only to OpenRouter. Avoid entering keys on shared or untrusted devices.",
  });
  apiKeysContent.appendChild(notice);

  // Wrap password field in a form to suppress browser warnings
  const keyForm = el("form", {
    attrs: { autocomplete: "off" },
  }) as HTMLFormElement;
  keyForm.addEventListener("submit", (e) => e.preventDefault());

  const group = el("div", { cls: "setting-group" });
  const lbl = el("label", {
    cls: "setting-label",
    text: "OpenRouter API Key",
  });
  const input = el("input", {
    attrs: {
      type: "password",
      placeholder: "sk-or-...",
      "data-provider": "openrouter",
      autocomplete: "off",
    },
  }) as HTMLInputElement;

  // Show current key status
  const status = el("div", {
    cls: hasApiKey("openrouter")
      ? ["key-status", "configured"]
      : ["key-status", "missing"],
    text: hasApiKey("openrouter") ? "\u2713 Configured" : "Not set",
  });

  // Pre-fill existing key
  const existingKey = getApiKey("openrouter");
  if (existingKey) input.value = existingKey;

  input.addEventListener("change", () => {
    const val = input.value.trim();
    if (val) {
      setApiKey("openrouter", val);
      status.textContent = "\u2713 Configured";
      status.className = "key-status configured";
    } else {
      clearApiKey("openrouter");
      status.textContent = "Not set";
      status.className = "key-status missing";
    }
    bus.emit("settings:changed");
  });

  append(group, lbl, input, status);
  keyForm.appendChild(group);
  apiKeysContent.appendChild(keyForm);

  // Model selector (collapsible)
  const { section: modelSection, content: modelContent } =
    createCollapsibleSection("AI Model", "clustr_settings_model_collapsed");

  const modelGroup = el("div", { cls: "setting-group" });
  const modelLabel = el("label", {
    cls: "setting-label",
    text: "Model for chat and topic extraction",
  });
  const modelSelect = el("select", {
    cls: "setting-select",
  }) as HTMLSelectElement;

  /** Fill the dropdown from a model list, reselecting the active model id. */
  const populateModelSelect = (models: { provider: string; model: string; displayName: string }[]) => {
    const current = getActiveModel().model;
    clear(modelSelect);
    for (const model of models) {
      const opt = el("option", {
        text: `${model.displayName} (${model.provider})`,
        attrs: { value: model.model },
      }) as HTMLOptionElement;
      if (model.model === current) opt.selected = true;
      modelSelect.appendChild(opt);
    }
    // Keep the current selection visible even if it left the live catalog.
    if (!models.some((m) => m.model === current)) {
      const retained = getModelById(current);
      if (retained) {
        const opt = el("option", {
          text: `${retained.displayName} (${retained.provider})`,
          attrs: { value: retained.model },
        }) as HTMLOptionElement;
        opt.selected = true;
        modelSelect.appendChild(opt);
      }
    }
  };

  // Render immediately from cache/defaults, then refresh from OpenRouter.
  populateModelSelect(getAvailableModels());
  refreshModels().then(populateModelSelect);

  modelSelect.addEventListener("change", () => {
    const id = modelSelect.value;
    setItem(STORAGE_KEYS.activeModel, id);
    bus.emit("settings:modelChanged", { modelId: id });
  });

  const modelHint = el("div", {
    cls: "setting-notice",
    text: "Model list is fetched live from OpenRouter and filtered to Google, Anthropic, and OpenAI. Create a key at openrouter.ai.",
  });

  append(modelGroup, modelLabel, modelSelect, modelHint);
  modelContent.appendChild(modelGroup);

  // CORS Proxy (collapsible)
  const { section: proxySection, content: proxyContent } =
    createCollapsibleSection("Proxy", "clustr_settings_proxy_collapsed");

  const proxyGroup = el("div", { cls: "setting-group" });
  const proxyLabel = el("label", {
    cls: "setting-label",
    text: "Proxy URL (for website, YouTube, RSS imports)",
  });
  const proxyInput = el("input", {
    attrs: {
      type: "url",
      placeholder: DEFAULT_CORS_PROXY_URL,
    },
  }) as HTMLInputElement;

  const savedProxy = getItem(STORAGE_KEYS.corsProxy);
  if (savedProxy) proxyInput.value = savedProxy;

  const proxyHint = el("div", {
    cls: "setting-notice",
    text: "Used for Website, YouTube, and RSS imports. The fetched URL is appended to this address. Leave empty to use the default proxy.",
  });

  proxyInput.addEventListener("change", () => {
    const val = proxyInput.value.trim();
    if (val) {
      setItem(STORAGE_KEYS.corsProxy, val);
    } else {
      removeItem(STORAGE_KEYS.corsProxy);
    }
    bus.emit("settings:changed");
  });

  const testRow = el("div", { cls: "setting-row" });
  const testBtn = el("button", { cls: "setting-btn", text: "Test proxy" });
  const testStatus = el("span", { cls: "setting-status" });
  testBtn.addEventListener("click", async () => {
    testStatus.textContent = "Testing\u2026";
    testStatus.className = "setting-status";
    const proxyBase = getCorsProxyUrl();
    const testUrl = `${proxyBase}${encodeURIComponent("https://httpbin.org/get")}`;
    try {
      const res = await fetch(testUrl);
      if (res.ok) {
        testStatus.textContent = "\u2713 Proxy is working";
        testStatus.className = "setting-status success";
      } else {
        testStatus.textContent = `\u2717 Failed (${res.status})`;
        testStatus.className = "setting-status error";
      }
    } catch {
      testStatus.textContent = "\u2717 Unreachable";
      testStatus.className = "setting-status error";
    }
  });
  append(testRow, testBtn, testStatus);

  append(proxyGroup, proxyLabel, proxyInput, proxyHint, testRow);
  proxyContent.appendChild(proxyGroup);

  // ── OCR Language ──
  const ocrSection = el("div", { cls: "panel-section" });
  ocrSection.appendChild(
    el("div", { cls: "panel-section-title", text: "OCR Language" }),
  );

  const ocrGroup = el("div", { cls: "setting-group" });
  const ocrLabel = el("label", {
    cls: "setting-label",
    text: "Language for image and scanned PDF text extraction",
  });
  const ocrSelect = el("select", {
    cls: "setting-select",
  }) as HTMLSelectElement;

  const savedOcrLang =
    getItem(STORAGE_KEYS.ocrLanguage) || DEFAULT_OCR_LANGUAGE;
  for (const lang of OCR_LANGUAGES) {
    const opt = el("option", {
      text: lang.name,
      attrs: { value: lang.code },
    }) as HTMLOptionElement;
    if (lang.code === savedOcrLang) opt.selected = true;
    ocrSelect.appendChild(opt);
  }

  ocrSelect.addEventListener("change", () => {
    setItem(STORAGE_KEYS.ocrLanguage, ocrSelect.value);
    bus.emit("settings:changed");
  });

  const ocrHint = el("div", {
    cls: "setting-notice",
    text: "Used when importing images or scanned PDFs. Changing this downloads the appropriate language model (~2-15MB).",
  });

  append(ocrGroup, ocrLabel, ocrSelect, ocrHint);
  ocrSection.appendChild(ocrGroup);

  // ── Export section ──
  const exportSection = el("div", { cls: "panel-section" });
  exportSection.appendChild(
    el("div", { cls: "panel-section-title", text: "Export" }),
  );

  const exportGrid = el("div", { cls: "export-grid" });
  const formats = [
    { format: "json", label: "JSON" },
    { format: "svg", label: "SVG" },
    { format: "png", label: "PNG" },
    { format: "keywords-csv", label: "Keywords CSV" },
    { format: "analytics-csv", label: "Analytics CSV" },
    { format: "gexf", label: "GEXF" },
  ];

  for (const { format, label } of formats) {
    const btn = el("button", { cls: "export-grid-btn", text: label });
    btn.addEventListener("click", () => bus.emit("export:trigger", { format }));
    exportGrid.appendChild(btn);
  }

  exportSection.appendChild(exportGrid);

  // ── Install App ──
  const installSection = el("div", { cls: "panel-section" });
  installSection.appendChild(
    el("div", { cls: "panel-section-title", text: "Install" }),
  );

  const installBtn = el("button", {
    cls: "primary",
    text: "Install App",
    attrs: { style: "width:100%" },
  });
  const installHint = el("div", {
    cls: "setting-notice",
    text: "Install Clustr as a standalone app on your device.",
  });

  // Capture the beforeinstallprompt event
  let deferredPrompt: Event | null =
    (window as unknown as Record<string, Event>).__pwaPrompt ?? null;
  if (!deferredPrompt) {
    window.addEventListener(
      "beforeinstallprompt",
      (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.removeAttribute("disabled");
        installHint.textContent =
          "Install Clustr as a standalone app on your device.";
      },
      { once: true },
    );
  }

  // Check if already installed
  if (window.matchMedia("(display-mode: standalone)").matches) {
    installBtn.setAttribute("disabled", "true");
    installHint.textContent = "App is already installed.";
  } else if (!deferredPrompt) {
    installBtn.setAttribute("disabled", "true");
    installHint.textContent =
      "Use your browser's install option, or visit in Chrome/Edge to install.";
  }

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt as unknown as {
      prompt: () => void;
      userChoice: Promise<{ outcome: string }>;
    };
    prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === "accepted") {
      installBtn.setAttribute("disabled", "true");
      installHint.textContent = "App installed!";
    }
    deferredPrompt = null;
  });

  append(installSection, installBtn, installHint);

  // ── Danger zone ──
  const dangerSection = el("div", { cls: "panel-section" });
  dangerSection.appendChild(
    el("div", { cls: "panel-section-title danger-title", text: "Danger Zone" }),
  );
  const wipeBtn = el("button", {
    cls: "danger-btn",
    text: "\uD83D\uDDD1\uFE0F  Wipe All Data & Reset",
  });
  wipeBtn.addEventListener("click", async () => {
    const ok = await confirmAction(
      "This will permanently delete all saved data (API keys, chat history, cached analyses, editor content) and reload the app.",
      "Wipe All",
    );
    if (!ok) return;
    await wipeAll();
    location.reload();
  });
  dangerSection.appendChild(wipeBtn);

  append(
    target,
    section,
    modelSection,
    proxySection,
    ocrSection,
    exportSection,
    installSection,
    dangerSection,
  );
}
