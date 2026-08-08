/* ═══════════════════════════════════════════════════
 *  IndexedDB-backed storage with in-memory cache.
 *  Reads are synchronous (from cache). Writes persist
 *  to IndexedDB asynchronously via transactions.
 *  Falls back to localStorage if IndexedDB is unavailable.
 * ═══════════════════════════════════════════════════ */

const DB_NAME = "clustr";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const CLUSTR_PREFIX = "clustr_";

const cache = new Map<string, string>();
let db: IDBDatabase | null = null;
let idbReady = false;

/** Open (or create) the IndexedDB database. */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Read every key/value from the object store into the cache. */
function loadAll(database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        if (typeof cursor.key === "string" && typeof cursor.value === "string")
          cache.set(cursor.key, cursor.value);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Boot the storage layer — call once before first read. */
export async function initStorage(): Promise<void> {
  try {
    db = await openDB();
    await loadAll(db);

    // Migrate localStorage → IndexedDB (first run after upgrade)
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CLUSTR_PREFIX) && !cache.has(key)) {
          const value = localStorage.getItem(key);
          if (value !== null) {
            cache.set(key, value);
            store.put(value, key);
          }
        }
      }
    } catch {
      /* localStorage may be blocked — skip migration */
    }

    idbReady = true;
  } catch {
    console.warn("IndexedDB unavailable — using localStorage fallback");
  }
}

/** Read a string value. */
export function getItem(key: string): string | null {
  if (idbReady) return cache.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a string value. */
export function setItem(key: string, value: string): void {
  if (idbReady) {
    cache.set(key, value);
    idbPut(key, value);
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    console.warn(`Storage write failed: ${key}`);
  }
}

/** Remove a value. */
export function removeItem(key: string): void {
  if (idbReady) {
    cache.delete(key);
    idbDelete(key);
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    console.warn(`Storage remove failed: ${key}`);
  }
}

/** Read and parse JSON. */
export function getJSON<T>(key: string): T | null {
  const raw = getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Stringify and write JSON. */
export function setJSON<T>(key: string, value: T): void {
  setItem(key, JSON.stringify(value));
}

/** Delete the entire database + localStorage clustr keys, then reinitialize. */
export async function wipeAll(): Promise<void> {
  cache.clear();
  if (db) {
    db.close();
    db = null;
  }
  idbReady = false;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CLUSTR_PREFIX)) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    /* blocked */
  }
  // Reinitialize so the app isn't left in a broken state
  await initStorage();
}

/* ── Internal IndexedDB helpers ── */

/** Persist a value — fire-and-forget, transactional. */
function idbPut(key: string, value: string): void {
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
  } catch (e) {
    console.warn(`IDB write failed: ${key}`, e);
  }
}

/** Delete a value — fire-and-forget. */
function idbDelete(key: string): void {
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
  } catch (e) {
    console.warn(`IDB delete failed: ${key}`, e);
  }
}
