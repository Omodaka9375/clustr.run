/** Query a single element, throwing if missing. */
export function $(
  selector: string,
  parent: Element | Document = document,
): HTMLElement {
  const el = parent.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

/** Query multiple elements. */
export function $$(
  selector: string,
  parent: Element | Document = document,
): HTMLElement[] {
  return Array.from(parent.querySelectorAll<HTMLElement>(selector));
}

/** Create an element with optional class and attributes. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts?: {
    cls?: string | string[];
    attrs?: Record<string, string>;
    text?: string;
    html?: string;
  },
): HTMLElementTagNameMap[K] {
  const elem = document.createElement(tag);
  if (opts?.cls) {
    const classes = Array.isArray(opts.cls)
      ? opts.cls
      : opts.cls.split(/\s+/).filter(Boolean);
    elem.classList.add(...classes);
  }
  if (opts?.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) elem.setAttribute(k, v);
  }
  if (opts?.text) elem.textContent = opts.text;
  if (opts?.html) elem.innerHTML = opts.html;
  return elem;
}

/** Append multiple children to a parent. */
export function append(
  parent: HTMLElement,
  ...children: (HTMLElement | string)[]
): void {
  for (const child of children) {
    if (typeof child === "string") {
      parent.appendChild(document.createTextNode(child));
    } else {
      parent.appendChild(child);
    }
  }
}

/** Remove all children from an element. */
export function clear(parent: HTMLElement): void {
  parent.replaceChildren();
}
