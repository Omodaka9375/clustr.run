import { STORAGE_KEYS, MAX_RSS_ITEMS, getOcrLanguage } from "../config";
import { el, append, clear } from "../utils/dom";
import { bus } from "../utils/events";
import { getItem, setItem } from "../utils/storage";
import { confirmAction } from "./confirm-modal";
import { parseFile, FILE_ACCEPT } from "../import/file-parser";
import { fetchUrlWithMeta } from "../import/url-fetcher";
import { fetchYouTubeWithMeta } from "../import/youtube";
import { fetchRssFeedWithMeta } from "../import/rss";
import { parseFolderUpload, getTotalFileCount } from "../import/folder-parser";
import {
  parseEvernoteEnex,
  parseJsonFiles,
  parseTwitterArchive,
} from "../import/formats";
import { showToast } from "./app-shell";
import { fetchWikipediaArticle } from "../import/wikipedia";
import { parseCsvFile } from "../import/csv-import";
import { parseObsidianVault } from "../import/obsidian";

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

/** Render the input panel into the target. */
export function createInputPanel(target: HTMLElement): void {
  const section = el("div", { cls: "panel-section" });

  // Header with title, saved indicator, and word count
  const header = el("div", { cls: "input-header" });
  const title = el("div", { cls: "panel-section-title", text: "Text Input" });
  const headerRight = el("div", { cls: "input-header-right" });
  const savedIndicator = el("span", { cls: "editor-saved" });
  const wordCount = el("span", { cls: "editor-wordcount", text: "0 words" });
  append(headerRight, savedIndicator, wordCount);
  append(header, title, headerRight);

  const textarea = el("textarea", {
    cls: "input-textarea",
    attrs: {
      placeholder:
        "Paste or type your text here...\n\nContent is auto-saved. Use the buttons below to upload a file or import from an external source.",
      id: "input-text",
      spellcheck: "true",
    },
  }) as HTMLTextAreaElement;

  // Load saved content
  const saved = getItem(STORAGE_KEYS.editorContent);
  if (saved) textarea.value = saved;
  updateWordCount(textarea.value, wordCount);

  // Auto-save on input (debounced)
  textarea.addEventListener("input", () => {
    updateWordCount(textarea.value, wordCount);
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      setItem(STORAGE_KEYS.editorContent, textarea.value);
      showSaved(savedIndicator);
    }, 800);
  });

  // Tab key inserts spaces instead of moving focus
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value =
        textarea.value.substring(0, start) +
        "  " +
        textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    }
  });

  // Textarea wrapper with floating clear button
  const textareaWrap = el("div", { cls: "textarea-wrap" });
  const clearBtn = el("button", {
    cls: "textarea-clear-btn",
    text: "\u2715",
    attrs: { title: "Clear text", "aria-label": "Clear text" },
  });
  clearBtn.addEventListener("click", async () => {
    if (
      textarea.value.trim().length > 0 &&
      !(await confirmAction("Clear all text?", "Clear"))
    )
      return;
    textarea.value = "";
    setItem(STORAGE_KEYS.editorContent, "");
    updateWordCount("", wordCount);
    clearBtn.classList.remove("visible");
    bus.emit("text:cleared");
  });

  // Show/hide clear button based on content
  const updateClearBtn = () => {
    clearBtn.classList.toggle("visible", textarea.value.length > 0);
  };
  updateClearBtn();
  textarea.addEventListener("input", updateClearBtn);

  append(textareaWrap, textarea, clearBtn);

  // Primary actions
  const btnRow = el("div", { cls: "input-btn-row" });
  const analyzeBtn = el("button", {
    cls: ["primary", "input-analyze-btn"],
    text: "\u25B6  Analyze",
  });
  analyzeBtn.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (text.length > 0) bus.emit("text:submitted", { text });
  });
  const appendBtn = el("button", {
    cls: "input-append-btn",
    text: "+ Append",
    attrs: { title: "Add text to existing graph" },
  });
  appendBtn.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (text.length > 0) bus.emit("text:appended", { text });
  });
  // Compare button — reveals secondary textarea
  const compareBtn = el("button", {
    cls: "input-append-btn",
    text: "⇄ Compare",
    attrs: { title: "Compare two texts" },
  });

  const compareWrap = el("div", { cls: "compare-wrap hidden" });
  const compareTextarea = el("textarea", {
    cls: "input-textarea compare-textarea",
    attrs: {
      placeholder: "Paste Text B here to compare against Text A above…",
    },
  }) as HTMLTextAreaElement;
  const compareRunBtn = el("button", {
    cls: ["primary", "input-analyze-btn"],
    text: "▶  Run Compare",
  });
  const compareCancelBtn = el("button", {
    cls: "input-append-btn",
    text: "✕ Cancel",
  });
  const compareActions = el("div", { cls: "input-btn-row" });
  append(compareActions, compareRunBtn, compareCancelBtn);
  append(compareWrap, compareTextarea, compareActions);

  compareBtn.addEventListener("click", () => {
    compareWrap.classList.toggle("hidden");
    if (!compareWrap.classList.contains("hidden")) compareTextarea.focus();
  });
  compareCancelBtn.addEventListener("click", () => {
    compareWrap.classList.add("hidden");
    compareTextarea.value = "";
  });
  compareRunBtn.addEventListener("click", () => {
    const textB = compareTextarea.value.trim();
    if (textB.length > 0) bus.emit("compare:submitted", { textB });
  });

  append(btnRow, analyzeBtn, appendBtn, compareBtn);

  // Divider
  const divider = el("div", { cls: "input-divider" });
  const dividerLine = el("span", { cls: "input-divider-line" });
  const dividerText = el("span", {
    cls: "input-divider-text",
    text: "or add from",
  });
  append(
    divider,
    dividerLine,
    dividerText,
    dividerLine.cloneNode(true) as HTMLElement,
  );

  // Source buttons — 2-column grid
  const sources = el("div", { cls: "input-sources" });

  const fileBtn = el("button", {
    cls: ["input-source-btn", "file-upload-btn"],
    html: "<span class='input-source-icon'>\uD83D\uDCC4</span><span>File</span>",
  });
  const fileInput = el("input", {
    attrs: { type: "file", accept: FILE_ACCEPT },
  }) as HTMLInputElement;
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await parseFile(file);
      textarea.value = text;
      updateWordCount(textarea.value, wordCount);
      setItem(STORAGE_KEYS.editorContent, textarea.value);
      showSaved(savedIndicator);
    } catch (err) {
      showToast(`File error: ${(err as Error).message}`, true);
    }
  });
  fileBtn.appendChild(fileInput);

  // Folder upload button
  const folderBtn = el("button", {
    cls: ["input-source-btn", "file-upload-btn"],
    html: "<span class='input-source-icon'>\uD83D\uDCC1</span><span>Folder</span>",
  });
  const folderInput = el("input", {
    attrs: { type: "file", webkitdirectory: "", directory: "" },
  }) as HTMLInputElement;
  folderInput.addEventListener("change", async () => {
    const files = folderInput.files;
    if (!files || files.length === 0) return;
    try {
      showToast("Parsing folder structure...");
      const { root, stats } = await parseFolderUpload(files);
      const fileCount = getTotalFileCount(root);

      if (stats.parsed === 0) {
        showToast(
          `No readable text found in ${fileCount} files. Try a folder with text-based files (.txt, .md, .pdf, etc.).`,
          true,
        );
        return;
      }

      bus.emit("folder:uploaded", { folder: root });

      let msg = `Imported ${stats.parsed} of ${fileCount} files from ${root.name}`;
      if (stats.skipped > 0) msg += ` (${stats.skipped} skipped)`;
      showToast(msg, stats.skipped > stats.parsed);
    } catch (err) {
      showToast(`Folder error: ${(err as Error).message}`, true);
    }
  });
  folderBtn.appendChild(folderInput);

  const imgBtn = el("button", {
    cls: ["input-source-btn", "file-upload-btn"],
    html: "<span class='input-source-icon'>\uD83D\uDDBC\uFE0F</span><span>Image</span>",
  });
  const imgInput = el("input", {
    attrs: { type: "file", accept: "image/*" },
  }) as HTMLInputElement;
  imgInput.addEventListener("change", async () => {
    const file = imgInput.files?.[0];
    if (!file) return;
    await handleImageOCR(file, textarea, wordCount, savedIndicator);
  });
  imgBtn.appendChild(imgInput);

  const urlBtn = el("button", {
    cls: "input-source-btn",
    html: "<span class='input-source-icon'>\uD83C\uDF10</span><span>URL</span>",
  });
  urlBtn.addEventListener("click", () => {
    showUrlInput(sources, textarea, wordCount, savedIndicator);
  });

  const youtubeBtn = el("button", {
    cls: "input-source-btn",
    html: "<span class='input-source-icon'>\u25B6</span><span>YouTube Video</span>",
  });
  youtubeBtn.addEventListener("click", () => {
    showYouTubeInput(sources, textarea, wordCount, savedIndicator);
  });

  const rssBtn = el("button", {
    cls: "input-source-btn",
    html: "<span class='input-source-icon'>\uD83D\uDCE1</span><span>RSS Feed</span>",
  });
  rssBtn.addEventListener("click", () => {
    showRssInput(sources, textarea, wordCount, savedIndicator);
  });

  // Service import buttons
  const evernoteBtn = el("button", {
    cls: ["input-source-btn", "file-upload-btn"],
    html: "<span class='input-source-icon'>\uD83D\uDCDD</span><span>Evernote</span>",
  });
  const evernoteInput = el("input", {
    attrs: { type: "file", accept: ".enex" },
  }) as HTMLInputElement;
  evernoteInput.addEventListener("change", async () => {
    const file = evernoteInput.files?.[0];
    if (!file) return;
    try {
      showToast("Parsing Evernote export...");
      const text = await parseEvernoteEnex(file);
      textarea.value = text;
      updateWordCount(textarea.value, wordCount);
      setItem(STORAGE_KEYS.editorContent, textarea.value);
      showSaved(savedIndicator);
      showToast(`Imported Evernote notes`);
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });
  evernoteBtn.appendChild(evernoteInput);

  const jsonBtn = el("button", {
    cls: ["input-source-btn", "file-upload-btn"],
    html: "<span class='input-source-icon'>\uD83D\uDCC4</span><span>JSON</span>",
  });
  const jsonInput = el("input", {
    attrs: { type: "file", accept: ".json", multiple: "true" },
  }) as HTMLInputElement;
  jsonInput.addEventListener("change", async () => {
    const files = jsonInput.files;
    if (!files || files.length === 0) return;
    try {
      showToast("Parsing JSON files...");
      const text = await parseJsonFiles(files);
      textarea.value = text;
      updateWordCount(textarea.value, wordCount);
      setItem(STORAGE_KEYS.editorContent, textarea.value);
      showSaved(savedIndicator);
      showToast(`Imported JSON data`);
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });
  jsonBtn.appendChild(jsonInput);

  const twitterBtn = el("button", {
    cls: ["input-source-btn", "file-upload-btn"],
    html: "<span class='input-source-icon'>\uD83D\uDCAC</span><span>Twitter/X</span>",
  });
  const twitterInput = el("input", {
    attrs: { type: "file", accept: ".js,.json" },
  }) as HTMLInputElement;
  twitterInput.addEventListener("change", async () => {
    const file = twitterInput.files?.[0];
    if (!file) return;
    try {
      showToast("Parsing Twitter archive...");
      const text = await parseTwitterArchive(file);
      textarea.value = text;
      updateWordCount(textarea.value, wordCount);
      setItem(STORAGE_KEYS.editorContent, textarea.value);
      showSaved(savedIndicator);
      showToast(`Imported tweets`);
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });
  twitterBtn.appendChild(twitterInput);

  // Wikipedia button
  const wikiBtn = el("button", {
    cls: "input-source-btn",
    html: "<span class='input-source-icon'>\uD83C\uDFDB\uFE0F</span><span>Wikipedia</span>",
  });
  wikiBtn.addEventListener("click", () => {
    showWikiInput(sources, textarea, wordCount, savedIndicator);
  });

  // CSV button
  const csvBtn = el("button", {
    cls: ["input-source-btn", "file-upload-btn"],
    html: "<span class='input-source-icon'>\uD83D\uDCCA</span><span>CSV</span>",
  });
  const csvInput = el("input", {
    attrs: { type: "file", accept: ".csv,.tsv" },
  }) as HTMLInputElement;
  csvInput.addEventListener("change", async () => {
    const file = csvInput.files?.[0];
    if (!file) return;
    try {
      showToast("Parsing CSV...");
      const text = await parseCsvFile(file);
      textarea.value = text;
      updateWordCount(textarea.value, wordCount);
      setItem(STORAGE_KEYS.editorContent, textarea.value);
      showSaved(savedIndicator);
      showToast("Imported CSV data");
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });
  csvBtn.appendChild(csvInput);

  // Obsidian vault button
  const obsidianBtn = el("button", {
    cls: ["input-source-btn", "file-upload-btn"],
    html: "<span class='input-source-icon'>\uD83D\uDC8E</span><span>Obsidian</span>",
  });
  const obsidianInput = el("input", {
    attrs: { type: "file", webkitdirectory: "", directory: "" },
  }) as HTMLInputElement;
  obsidianInput.addEventListener("change", async () => {
    const files = obsidianInput.files;
    if (!files || files.length === 0) return;
    try {
      showToast("Parsing Obsidian vault...");
      const { text, notes } = await parseObsidianVault(files);
      textarea.value = text;
      updateWordCount(textarea.value, wordCount);
      setItem(STORAGE_KEYS.editorContent, textarea.value);
      showSaved(savedIndicator);
      showToast(`Imported ${notes.length} notes from vault`);
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });
  obsidianBtn.appendChild(obsidianInput);

  append(
    sources,
    fileBtn,
    folderBtn,
    imgBtn,
    urlBtn,
    youtubeBtn,
    rssBtn,
    wikiBtn,
    csvBtn,
    obsidianBtn,
    evernoteBtn,
    jsonBtn,
    twitterBtn,
  );

  append(section, header, textareaWrap, btnRow, compareWrap, divider, sources);

  clear(target);
  target.appendChild(section);
}

/** Update word/character count display. */
function updateWordCount(text: string, countEl: HTMLElement): void {
  const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
  const chars = text.length;
  countEl.textContent = `${words} words \u00B7 ${chars} chars`;
}

/** Flash a brief "saved" indicator. */
function showSaved(indicator: HTMLElement): void {
  indicator.textContent = "\u2713 Saved";
  setTimeout(() => {
    indicator.textContent = "";
  }, 2000);
}

async function handleImageOCR(
  file: File,
  textarea: HTMLTextAreaElement,
  wordCountEl: HTMLElement,
  savedEl: HTMLElement,
): Promise<void> {
  try {
    bus.emit("ai:responseStart");
    // Dynamic import for tesseract (large library, code-split)
    const { createWorker } = await import("tesseract.js");
    const lang = getOcrLanguage();
    const worker = await createWorker(lang);
    const {
      data: { text },
    } = await worker.recognize(file);
    await worker.terminate();
    textarea.value = text;
    updateWordCount(textarea.value, wordCountEl);
    setItem(STORAGE_KEYS.editorContent, textarea.value);
    showSaved(savedEl);
    bus.emit("ai:responseEnd", { content: "OCR complete" });
  } catch (err) {
    bus.emit("ai:error", { message: `OCR failed: ${(err as Error).message}` });
  }
}

/** Show inline URL input below source buttons. */
function showUrlInput(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  wordCountEl: HTMLElement,
  savedEl: HTMLElement,
): void {
  removeInlineInput(container);
  const row = createInlineInputRow(
    "https://example.com/article",
    "Import",
    async (url) => {
      showToast("Fetching URL...");
      try {
        const result = await fetchUrlWithMeta(url);
        textarea.value = result.text;
        updateWordCount(textarea.value, wordCountEl);
        setItem(STORAGE_KEYS.editorContent, textarea.value);
        showSaved(savedEl);
        bus.emit("source:imported", { text: result.text, meta: result.meta });
        showToast(`Imported from ${result.meta.domain}`);
        removeInlineInput(container);
      } catch (err) {
        showToast((err as Error).message, true);
      }
    },
    () => removeInlineInput(container),
    { proxyHint: true },
  );
  container.appendChild(row);
}

/** Show inline YouTube input below source buttons. */
function showYouTubeInput(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  wordCountEl: HTMLElement,
  savedEl: HTMLElement,
): void {
  removeInlineInput(container);
  const row = createInlineInputRow(
    "https://youtube.com/watch?v=...",
    "Import",
    async (url) => {
      showToast("Fetching transcript...");
      try {
        const result = await fetchYouTubeWithMeta(url);
        textarea.value = result.text;
        updateWordCount(textarea.value, wordCountEl);
        setItem(STORAGE_KEYS.editorContent, textarea.value);
        showSaved(savedEl);
        bus.emit("source:imported", { text: result.text, meta: result.meta });
        showToast(`Imported: ${result.meta.title}`);
        removeInlineInput(container);
      } catch (err) {
        showToast((err as Error).message, true);
      }
    },
    () => removeInlineInput(container),
    { proxyHint: true },
  );
  container.appendChild(row);
}

/** Show inline RSS input below source buttons. */
function showRssInput(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  wordCountEl: HTMLElement,
  savedEl: HTMLElement,
): void {
  removeInlineInput(container);
  const row = createInlineInputRow(
    "https://example.com/feed.xml",
    "Import",
    async (url) => {
      showToast("Fetching RSS feed...");
      try {
        const results = await fetchRssFeedWithMeta(url, MAX_RSS_ITEMS);
        const text = results.map((r) => r.text).join("\n\n");
        textarea.value = text;
        updateWordCount(textarea.value, wordCountEl);
        setItem(STORAGE_KEYS.editorContent, textarea.value);
        showSaved(savedEl);
        // Emit multiple source blocks for RSS
        for (const result of results) {
          bus.emit("source:imported", { text: result.text, meta: result.meta });
        }
        showToast(`Imported ${results.length} items`);
        removeInlineInput(container);
      } catch (err) {
        showToast((err as Error).message, true);
      }
    },
    () => removeInlineInput(container),
    { proxyHint: true },
  );
  container.appendChild(row);
}

/** Create an inline input row with input field, submit button, and cancel button. */
function createInlineInputRow(
  placeholder: string,
  btnText: string,
  onSubmit: (value: string) => void,
  onCancel: () => void,
  options?: { proxyHint?: boolean },
): HTMLElement {
  const row = el("div", { cls: "inline-input-row" });
  const input = el("input", {
    cls: "inline-input",
    attrs: { type: "url", placeholder },
  }) as HTMLInputElement;
  const submitBtn = el("button", { cls: "inline-input-btn", text: btnText });
  const cancelBtn = el("button", { cls: "inline-cancel-btn", text: "\u2715" });

  submitBtn.addEventListener("click", () => {
    const val = input.value.trim();
    if (val) onSubmit(val);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = input.value.trim();
      if (val) onSubmit(val);
    } else if (e.key === "Escape") {
      onCancel();
    }
  });
  cancelBtn.addEventListener("click", onCancel);

  append(row, input, submitBtn, cancelBtn);

  if (options?.proxyHint) {
    const hint = el("div", { cls: "inline-input-hint" });
    hint.innerHTML = `Fetched via proxy \u00B7 <a href="#" class="inline-hint-link">Settings</a>`;
    const link = hint.querySelector(".inline-hint-link") as HTMLAnchorElement;
    link?.addEventListener("click", (e) => {
      e.preventDefault();
      bus.emit("nav:panel", { panel: "settings" });
    });
    row.appendChild(hint);
  }

  setTimeout(() => input.focus(), 0);
  return row;
}

/** Show inline Wikipedia article title input. */
function showWikiInput(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  wordCountEl: HTMLElement,
  savedEl: HTMLElement,
): void {
  removeInlineInput(container);
  const row = createInlineInputRow(
    "Article title, e.g. Machine learning",
    "Import",
    async (title) => {
      showToast("Fetching Wikipedia article...");
      try {
        const result = await fetchWikipediaArticle(title);
        textarea.value = result.text;
        updateWordCount(textarea.value, wordCountEl);
        setItem(STORAGE_KEYS.editorContent, textarea.value);
        showSaved(savedEl);
        bus.emit("source:imported", { text: result.text, meta: result.meta });
        showToast(`Imported: ${result.meta.title}`);
        removeInlineInput(container);
      } catch (err) {
        showToast((err as Error).message, true);
      }
    },
    () => removeInlineInput(container),
  );
  // Change input type from url to text for article titles
  const input = row.querySelector(".inline-input") as HTMLInputElement;
  if (input) input.type = "text";
  container.appendChild(row);
}

/** Remove any existing inline input row. */
function removeInlineInput(container: HTMLElement): void {
  const existing = container.querySelector(".inline-input-row");
  if (existing) existing.remove();
}
