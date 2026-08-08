/** Parse Evernote ENEX export file. */
export async function parseEvernoteEnex(file: File): Promise<string> {
  const xml = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const notes = doc.querySelectorAll("note");

  const texts: string[] = [];

  for (const note of notes) {
    const title = note.querySelector("title")?.textContent?.trim() ?? "";
    const contentEl = note.querySelector("content");
    const rawContent = contentEl?.textContent ?? "";

    // ENEX wraps content in CDATA with XHTML — parse it
    const contentDoc = new DOMParser().parseFromString(rawContent, "text/html");
    contentDoc
      .querySelectorAll("img, en-media, en-crypt, en-todo")
      .forEach((el) => el.remove());
    const text = contentDoc.body.textContent?.trim() ?? "";

    if (text.length > 20) {
      texts.push(`--- ${title} ---\n${text}`);
    }
  }

  if (texts.length === 0) throw new Error("No notes found in ENEX file");
  return texts.join("\n\n");
}

/** Parse JSON files and extract text content. */
export async function parseJsonFiles(files: FileList): Promise<string> {
  const texts: string[] = [];

  for (const file of files) {
    if (!file.name.endsWith(".json")) continue;
    try {
      const raw = await file.text();
      const data = JSON.parse(raw);

      // Extract text from common JSON structures
      extractJsonText(data, texts, file.name);
    } catch {
      // Skip unparseable files
    }
  }

  if (texts.length === 0)
    throw new Error("No text content found in JSON files");
  return texts.join("\n\n");
}

/** Recursively extract text from JSON structures. */
function extractJsonText(
  data: unknown,
  texts: string[],
  fileName: string,
): void {
  if (typeof data === "string" && data.length > 20) {
    texts.push(data);
    return;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      extractJsonText(item, texts, fileName);
    }
    return;
  }

  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;

    // Common text field names
    const textFields = [
      "text",
      "content",
      "body",
      "description",
      "message",
      "title",
      "textContent",
      "note",
      "summary",
    ];

    for (const field of textFields) {
      if (
        typeof obj[field] === "string" &&
        (obj[field] as string).length > 20
      ) {
        const title = typeof obj.title === "string" ? obj.title : fileName;
        texts.push(`--- ${title} ---\n${obj[field]}`);
        return;
      }
    }

    // Recurse into nested objects/arrays
    for (const value of Object.values(obj)) {
      if (typeof value === "object" && value !== null) {
        extractJsonText(value, texts, fileName);
      }
    }
  }
}

/** Parse Twitter/X archive (tweet.js from data export). */
export async function parseTwitterArchive(file: File): Promise<string> {
  let text = await file.text();

  // Twitter exports wrap JSON in `window.YTD.tweet.part0 = [...]`
  const jsonStart = text.indexOf("[");
  if (jsonStart > -1) {
    text = text.slice(jsonStart);
  }

  const tweets = JSON.parse(text) as { tweet?: { full_text?: string } }[];
  const texts: string[] = [];

  for (const item of tweets) {
    const tweetText = item.tweet?.full_text ?? "";
    if (tweetText.length > 5) {
      // Remove t.co links
      const cleaned = tweetText.replace(/https?:\/\/t\.co\/\S+/g, "").trim();
      if (cleaned.length > 5) texts.push(cleaned);
    }
  }

  if (texts.length === 0) throw new Error("No tweets found in archive");
  return texts.join("\n\n");
}
