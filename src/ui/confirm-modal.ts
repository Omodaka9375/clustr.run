import { el, append } from "../utils/dom";

/** Show a styled confirmation dialog. Resolves true if confirmed. */
export function confirmAction(
  message: string,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el("div", { cls: "confirm-overlay" });
    const dialog = el("div", {
      cls: "confirm-dialog",
      attrs: { role: "alertdialog", "aria-modal": "true" },
    });
    const msg = el("p", { cls: "confirm-message", text: message });
    const actions = el("div", { cls: "confirm-actions" });
    const cancelBtn = el("button", {
      cls: "confirm-cancel",
      text: cancelLabel,
    });
    const confirmBtn = el("button", {
      cls: ["confirm-ok", "primary"],
      text: confirmLabel,
    });

    const close = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };

    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(false);
    });

    append(actions, cancelBtn, confirmBtn);
    append(dialog, msg, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Auto-focus the cancel button for safety
    cancelBtn.focus();
  });
}
