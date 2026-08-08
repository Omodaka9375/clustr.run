import { el, append } from "../utils/dom";
import { getItem, setItem } from "../utils/storage";

const STORAGE_KEY = "clustr:notes";
let notesPanel: HTMLElement | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

/** Initialize the slide-in notes panel. */
export function initNotesPanel(): void {
  if (notesPanel) return;

  // Container
  notesPanel = el("div", { cls: "notes-panel" });

  // Toggle tab (chevron)
  const toggle = el("button", {
    cls: "notes-toggle",
    attrs: { "aria-label": "Toggle notes", title: "Notes" },
  });
  toggle.innerHTML = `<span class="notes-chevron">&#9664;</span>`;
  toggle.addEventListener("click", () => {
    notesPanel?.classList.toggle("expanded");
    const chevron = toggle.querySelector(".notes-chevron");
    if (chevron) {
      chevron.innerHTML = notesPanel?.classList.contains("expanded")
        ? "&#9654;"
        : "&#9664;";
    }
  });

  // Notes content area
  const content = el("div", { cls: "notes-content" });
  const textarea = el("textarea", {
    cls: "notes-textarea",
    attrs: {
      placeholder: "Quick notes...",
      spellcheck: "true",
    },
  }) as HTMLTextAreaElement;

  // Load saved notes
  const saved = getItem(STORAGE_KEY);
  if (saved) textarea.value = saved;

  // Auto-save on input
  textarea.addEventListener("input", () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      setItem(STORAGE_KEY, textarea.value);
    }, 500);
  });

  append(content, textarea);
  append(notesPanel, toggle, content);
  document.body.appendChild(notesPanel);
}

/** Toggle notes panel open/closed. */
export function toggleNotesPanel(): void {
  notesPanel?.classList.toggle("expanded");
  const chevron = notesPanel?.querySelector(".notes-chevron");
  if (chevron) {
    chevron.innerHTML = notesPanel?.classList.contains("expanded")
      ? "&#9654;"
      : "&#9664;";
  }
}
