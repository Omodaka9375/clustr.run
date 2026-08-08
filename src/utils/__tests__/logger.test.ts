import { describe, it, expect } from "vitest";
import { logError, logWarn, logInfo, getEntries } from "../logger";

describe("logger", () => {
  it("records error entries", () => {
    logError("test error", "stack trace");
    const entries = getEntries();
    const last = entries[entries.length - 1];
    expect(last.level).toBe("error");
    expect(last.message).toBe("test error");
    expect(last.stack).toBe("stack trace");
  });

  it("records warn entries", () => {
    logWarn("test warning");
    const entries = getEntries();
    const last = entries[entries.length - 1];
    expect(last.level).toBe("warn");
    expect(last.message).toBe("test warning");
  });

  it("records info entries", () => {
    logInfo("test info");
    const entries = getEntries();
    const last = entries[entries.length - 1];
    expect(last.level).toBe("info");
    expect(last.message).toBe("test info");
  });

  it("includes timestamps", () => {
    const before = Date.now();
    logInfo("timestamp test");
    const entries = getEntries();
    const last = entries[entries.length - 1];
    expect(last.ts).toBeGreaterThanOrEqual(before);
    expect(last.ts).toBeLessThanOrEqual(Date.now());
  });

  it("exposes entries via window.__clustrErrors", () => {
    expect(typeof globalThis.__clustrErrors).toBe("function");
    const entries = globalThis.__clustrErrors();
    expect(Array.isArray(entries)).toBe(true);
  });
});
