/** Min character length to consider a cell as meaningful text. */
const MIN_CELL_LENGTH = 20;

/** Parse a CSV file and extract text from the longest-text column. */
export async function parseCsvFile(file: File): Promise<string> {
  const raw = await file.text();
  const rows = parseCsvRows(raw);
  if (rows.length < 2) throw new Error("CSV has no data rows");

  const headers = rows[0];
  const dataRows = rows.slice(1);

  // Find the column with the most text content (auto-detect)
  const colScores = headers.map((_, i) => {
    let totalLen = 0;
    for (const row of dataRows) {
      totalLen += (row[i] ?? "").length;
    }
    return totalLen;
  });
  const bestCol = colScores.indexOf(Math.max(...colScores));

  const texts: string[] = [];
  for (const row of dataRows) {
    const cell = (row[bestCol] ?? "").trim();
    if (cell.length >= MIN_CELL_LENGTH) texts.push(cell);
  }

  if (texts.length === 0) throw new Error("No text content found in CSV");
  return texts.join("\n\n");
}

/** Simple CSV parser that handles quoted fields. */
function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuote = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        current.push(field);
        field = "";
        if (current.some((c) => c.trim().length > 0)) rows.push(current);
        current = [];
        if (ch === "\r") i++;
      } else {
        field += ch;
      }
    }
  }

  // Final field/row
  current.push(field);
  if (current.some((c) => c.trim().length > 0)) rows.push(current);

  return rows;
}
