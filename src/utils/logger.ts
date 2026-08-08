/** Lightweight error logger with a fixed-size circular buffer. */

const MAX_ENTRIES = 50;

type LogEntry = {
  ts: number;
  level: "error" | "warn" | "info";
  message: string;
  stack?: string;
};

const buffer: LogEntry[] = [];
let cursor = 0;
let count = 0;

/** Push an entry into the ring buffer. */
function push(entry: LogEntry): void {
  if (count < MAX_ENTRIES) {
    buffer.push(entry);
    count++;
  } else {
    buffer[cursor] = entry;
  }
  cursor = (cursor + 1) % MAX_ENTRIES;
}

/** Log an error. */
export function logError(message: string, stack?: string): void {
  push({ ts: Date.now(), level: "error", message, stack });
}

/** Log a warning. */
export function logWarn(message: string): void {
  push({ ts: Date.now(), level: "warn", message });
}

/** Log an info message. */
export function logInfo(message: string): void {
  push({ ts: Date.now(), level: "info", message });
}

/** Return a chronologically-ordered snapshot of the buffer. */
export function getEntries(): readonly LogEntry[] {
  if (count < MAX_ENTRIES) return buffer.slice();
  return [...buffer.slice(cursor), ...buffer.slice(0, cursor)];
}

// Expose for devtools debugging
declare global {
  // eslint-disable-next-line no-var
  var __clustrErrors: () => readonly LogEntry[];
}
globalThis.__clustrErrors = getEntries;
