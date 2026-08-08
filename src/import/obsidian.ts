/** Wikilink regex: [[target]] or [[target|display]]. */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/** Strip markdown formatting to plain text. */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1") // bold/italic
    .replace(/~~([^~]+)~~/g, "$1") // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // inline code
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → keep display text
    .replace(WIKILINK_RE, "$1") // wikilinks → keep target
    .replace(/^[-*+]\s+/gm, "") // list markers
    .replace(/^\d+\.\s+/gm, "") // ordered list markers
    .replace(/^>\s+/gm, "") // blockquotes
    .replace(/---+/g, "") // horizontal rules
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract all wikilink targets from markdown text. */
export function extractWikilinks(md: string): string[] {
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(md)) !== null) {
    links.push(m[1].trim().toLowerCase());
  }
  return links;
}

export type ObsidianNote = {
  name: string;
  text: string;
  wikilinks: string[];
};

/** Parse a FileList from a folder upload as an Obsidian-style vault. */
export async function parseObsidianVault(
  files: FileList,
): Promise<{ text: string; notes: ObsidianNote[] }> {
  const notes: ObsidianNote[] = [];

  for (const file of files) {
    if (!file.name.endsWith(".md")) continue;
    const raw = await file.text();
    const plain = stripMarkdown(raw);
    if (plain.length < 20) continue;

    const name = file.name.replace(/\.md$/, "");
    notes.push({
      name,
      text: plain,
      wikilinks: extractWikilinks(raw),
    });
  }

  if (notes.length === 0) throw new Error("No markdown files found in vault");

  const text = notes.map((n) => `--- ${n.name} ---\n${n.text}`).join("\n\n");
  return { text, notes };
}
