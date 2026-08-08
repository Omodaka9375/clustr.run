/** Escape HTML special characters. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert markdown to safe HTML.
 * Escapes raw HTML first, then applies markdown transforms.
 */
export function renderMarkdown(md: string): string {
  // 1. Extract fenced code blocks before escaping
  const codeBlocks: string[] = [];
  let safe = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    const escaped = escapeHtml(code.replace(/\n$/, ""));
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    codeBlocks.push(`<pre><code${cls}>${escaped}</code></pre>`);
    return `\x00CB${idx}\x00`;
  });

  // 2. Extract inline code before escaping
  const inlineCode: string[] = [];
  safe = safe.replace(/`([^`\n]+)`/g, (_match, code) => {
    const idx = inlineCode.length;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // 3. Escape remaining HTML
  safe = escapeHtml(safe);

  // 4. Restore code blocks and inline code (already escaped internally)
  safe = safe.replace(/\x00CB(\d+)\x00/g, (_m, i) => codeBlocks[Number(i)]);
  safe = safe.replace(/\x00IC(\d+)\x00/g, (_m, i) => inlineCode[Number(i)]);

  // 5. Markdown transforms
  safe = safe
    // Headings
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Links: [text](url)
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    // Unordered lists
    .replace(/^[\-\*] (.+)$/gm, "<li>$1</li>")
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    // Paragraphs: double newlines
    .replace(/\n{2,}/g, "</p><p>")
    // Single newlines inside paragraphs
    .replace(/\n/g, "<br>")
    // Wrap in paragraph
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    // Clean up empty paragraphs and unwrap block elements
    .replace(/<p><\/p>/g, "")
    .replace(/<p>(<h[1-4]>)/g, "$1")
    .replace(/(<\/h[1-4]>)<\/p>/g, "$1")
    .replace(/<p>(<ul>)/g, "$1")
    .replace(/(<\/ul>)<\/p>/g, "$1")
    .replace(/<p>(<pre>)/g, "$1")
    .replace(/(<\/pre>)<\/p>/g, "$1");

  return safe;
}
