import { el, append } from "../utils/dom";

const WELCOME_KEY = "clustr:welcome-shown";

/** Show welcome modal on first visit. */
export function showWelcomeIfFirstVisit(): void {
  if (localStorage.getItem(WELCOME_KEY)) return;

  const overlay = el("div", { cls: "welcome-overlay" });
  const dialog = el("div", { cls: "welcome-dialog" });

  const logo = el("div", { cls: "welcome-logo", text: "✦" });

  const title = el("h1", { cls: "welcome-title", text: "Welcome to Clustr" });

  const body = el("p", { cls: "welcome-body" });
  body.textContent =
    "Clustr turns any text into a visual knowledge graph. Paste an article link, an essay, notes, or any text and Clustr will find the key concepts, group related ideas into topics, and show you patterns you might have missed.";

  const btn = el("button", {
    cls: ["welcome-btn", "primary"],
    text: "Get Started",
  });

  btn.addEventListener("click", () => {
    localStorage.setItem(WELCOME_KEY, "1");
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 200);
  });

  append(dialog, logo, title, body, btn);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}
