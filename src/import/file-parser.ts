import { getOcrLanguage } from "../config";

/** Parse a file and return its text content. */
export async function parseFile(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  switch (ext) {
    case "txt":
    case "md":
    case "markdown":
      return file.text();

    case "csv":
    case "tsv":
      return parseCsv(file);

    case "xlsx":
    case "xls":
    case "ods":
      return parseSpreadsheet(file);

    case "json":
      return parseJson(file);

    case "pdf":
      return parsePdf(file);

    case "html":
    case "htm":
      return parseHtml(file);

    case "xml":
      return parseXml(file);

    default:
      // Try as plain text
      return file.text();
  }
}

/** Parse CSV/TSV into readable text. */
async function parseCsv(file: File): Promise<string> {
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  // Join all cell values as text
  return lines
    .map((line) => {
      // Handle quoted CSV values
      const cells = line.match(/(".*?"|[^,\t]+)/g) ?? [line];
      return cells.map((c) => c.replace(/^"|"$/g, "").trim()).join(" ");
    })
    .join("\n");
}

/** Parse spreadsheet files (XLSX, XLS, ODS). */
async function parseSpreadsheet(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  const texts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const lines = csv
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => l.replace(/,+$/g, "")); // Remove trailing empty commas
    if (lines.length > 0) {
      texts.push(`--- Sheet: ${sheetName} ---\n${lines.join("\n")}`);
    }
  }

  return texts.join("\n\n");
}

/** Parse JSON — extract string values recursively. */
async function parseJson(file: File): Promise<string> {
  const text = await file.text();
  const data = JSON.parse(text);
  const strings = extractStrings(data);
  return strings.join("\n");
}

function extractStrings(obj: unknown, depth = 0): string[] {
  if (depth > 10) return [];
  const results: string[] = [];

  if (typeof obj === "string" && obj.trim().length > 5) {
    results.push(obj.trim());
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...extractStrings(item, depth + 1));
    }
  } else if (obj && typeof obj === "object") {
    for (const val of Object.values(obj)) {
      results.push(...extractStrings(val, depth + 1));
    }
  }

  return results;
}

/** Minimum characters per page to consider it "has text" (vs scanned). */
const MIN_TEXT_PER_PAGE = 50;

/** Parse PDF files with layout analysis and OCR fallback for scanned pages. */
async function parsePdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  const scannedPageIndices: number[] = [];

  // First pass: extract text with layout analysis
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = extractTextWithLayout(content);

    if (text.trim().length >= MIN_TEXT_PER_PAGE) {
      pages.push(text);
    } else {
      // Mark as scanned page for OCR
      scannedPageIndices.push(i);
      pages.push(""); // Placeholder
    }
  }

  // Second pass: OCR scanned pages if any
  if (scannedPageIndices.length > 0) {
    const ocrResults = await ocrPdfPages(pdf, scannedPageIndices);
    for (let j = 0; j < scannedPageIndices.length; j++) {
      const pageIdx = scannedPageIndices[j] - 1; // 0-based
      pages[pageIdx] = ocrResults[j] || "[OCR failed for this page]";
    }
  }

  return cleanPdfText(pages.filter((p) => p.trim()).join("\n\n"));
}

/** Clean common PDF text artifacts. */
function cleanPdfText(text: string): string {
  return (
    text
      // Remove replacement characters (broken font encodings)
      .replace(/\uFFFD/g, "")
      // Collapse runs of whitespace left behind
      .replace(/ {2,}/g, " ")
      // Remove lines that are now empty after cleanup
      .replace(/^\s+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

type TextItem = { str: string; transform: number[]; width?: number };

/** Minimum gap (as fraction of estimated char width) to insert a space. */
const SPACE_GAP_FACTOR = 0.3;

/** Fallback character width when font metrics are unavailable. */
const FALLBACK_CHAR_WIDTH = 5;

/** Extract text preserving reading order using layout analysis. */
function extractTextWithLayout(content: { items: unknown[] }): string {
  // Filter to text items with position info
  const items = content.items.filter(
    (item): item is TextItem =>
      typeof item === "object" &&
      item !== null &&
      "str" in item &&
      "transform" in item,
  );

  if (items.length === 0) return "";

  // Group items by approximate Y position (line detection)
  // Transform[5] is the Y coordinate, Transform[4] is X
  // Transform[0] is the horizontal scale (≈ font size in most PDFs)
  const lineThreshold = 5; // pixels tolerance for same line
  const lineBuckets = new Map<number, { y: number; items: TextItem[] }>();

  for (const item of items) {
    const y = item.transform[5];
    const x = item.transform[4];
    const fontSize = Math.abs(item.transform[0]) || FALLBACK_CHAR_WIDTH;
    // Estimate rendered width from font size and character count
    const estWidth =
      "width" in item && typeof item.width === "number" && item.width > 0
        ? item.width
        : item.str.length * fontSize * 0.6;
    const bucket = Math.round(y / lineThreshold);

    let line = lineBuckets.get(bucket);
    if (!line) {
      line = { y, items: [] };
      lineBuckets.set(bucket, line);
    }
    line.items.push({
      str: item.str,
      transform: [x, ...item.transform.slice(1)],
      width: estWidth,
    });
  }

  const lines = Array.from(lineBuckets.values());

  // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
  lines.sort((a, b) => b.y - a.y);

  // Sort items within each line left-to-right
  for (const line of lines) {
    line.items.sort((a, b) => a.transform[0] - b.transform[0]);
  }

  // Build text with proper spacing
  const result: string[] = [];
  for (const line of lines) {
    const lineText: string[] = [];
    let lastEndX = -Infinity;

    for (const item of line.items) {
      const x = item.transform[0];
      const fontSize =
        Math.abs(item.transform[1] ?? FALLBACK_CHAR_WIDTH) ||
        FALLBACK_CHAR_WIDTH;
      const charWidth = fontSize * 0.6;
      const gapThreshold = Math.max(charWidth * SPACE_GAP_FACTOR, 1);

      // Insert a space when there is any meaningful gap between items
      if (x - lastEndX > gapThreshold && lineText.length > 0) {
        lineText.push(" ");
      }
      lineText.push(item.str);
      lastEndX = x + (item.width ?? item.str.length * charWidth);
    }

    const text = lineText.join("").trim();
    if (text) result.push(text);
  }

  return result.join("\n");
}

/** OCR specific pages of a PDF using Tesseract. */
async function ocrPdfPages(
  pdf: { getPage: (n: number) => Promise<unknown> },
  pageNumbers: number[],
): Promise<string[]> {
  // Dynamic import for tesseract (large library, code-split)
  const { createWorker } = await import("tesseract.js");

  const lang = getOcrLanguage();
  const worker = await createWorker(lang);
  const results: string[] = [];

  try {
    for (const pageNum of pageNumbers) {
      const page = (await pdf.getPage(pageNum)) as {
        getViewport: (opts: { scale: number }) => {
          width: number;
          height: number;
        };
        render: (ctx: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      };

      // Render page to canvas at 2x scale for better OCR
      const scale = 2.0;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Run OCR on the canvas
      const { data } = await worker.recognize(canvas);
      results.push(data.text.trim());
    }
  } finally {
    await worker.terminate();
  }

  return results;
}

/** Parse HTML files. */
async function parseHtml(file: File): Promise<string> {
  const html = await file.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Remove script/style
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  return doc.body.textContent?.trim() ?? "";
}

/** Parse XML files. */
async function parseXml(file: File): Promise<string> {
  const xml = await file.text();
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return doc.documentElement.textContent?.trim() ?? "";
}

/** Get a friendly description of supported file types. */
export const SUPPORTED_FILE_EXTENSIONS =
  ".txt, .md, .csv, .tsv, .xlsx, .xls, .ods, .json, .pdf, .html, .xml";

/** File input accept string. */
export const FILE_ACCEPT =
  ".txt,.md,.markdown,.csv,.tsv,.xlsx,.xls,.ods,.json,.pdf,.html,.htm,.xml";
