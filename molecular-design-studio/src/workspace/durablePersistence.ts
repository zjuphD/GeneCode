/**
 * Transactional browser persistence for the canonical workspace/project state.
 *
 * localStorage remains the synchronous first-paint cache used by the existing
 * hooks. IndexedDB is the durable mirror: writes are a single read/write
 * transaction and failures are returned to the caller instead of being
 * swallowed. Tauri/webview environments without IndexedDB safely fall back to
 * the existing localStorage path.
 */

export type DurableStore = "projects" | "workspace";

export interface DurableRecord<T> {
  id: "current";
  savedAt: number;
  payload: T;
}

const DB_NAME = "genecode-durable-v1";
const DB_VERSION = 1;
const RECORD_ID = "current";
let databasePromise: Promise<IDBDatabase> | null = null;

export function durableStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined" && typeof IDBDatabase !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!durableStorageAvailable()) {
    return Promise.reject(new Error("IndexedDB is unavailable in this runtime."));
  }
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Unable to open durable storage."));
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of ["projects", "workspace"] satisfies DurableStore[]) {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: "id" });
        }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export async function readDurable<T>(store: DurableStore): Promise<DurableRecord<T> | null> {
  if (!durableStorageAvailable()) return null;
  try {
    const database = await openDatabase();
    return await new Promise<DurableRecord<T> | null>((resolve, reject) => {
      const transaction = database.transaction(store, "readonly");
      const request = transaction.objectStore(store).get(RECORD_ID);
      request.onerror = () => reject(request.error ?? new Error("Unable to read durable storage."));
      request.onsuccess = () => resolve((request.result as DurableRecord<T> | undefined) ?? null);
    });
  } catch {
    // A corrupt/unavailable browser database should never prevent first paint;
    // the synchronous cache remains the source until the next successful save.
    return null;
  }
}

export async function writeDurable<T>(
  store: DurableStore,
  payload: T,
  savedAt = Date.now(),
): Promise<void> {
  if (!durableStorageAvailable()) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Durable storage write failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Durable storage write aborted."));
    transaction.objectStore(store).put({ id: RECORD_ID, savedAt, payload } satisfies DurableRecord<T>);
  });
}

export async function clearDurable(store: DurableStore): Promise<void> {
  if (!durableStorageAvailable()) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Durable storage clear failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Durable storage clear aborted."));
    transaction.objectStore(store).delete(RECORD_ID);
  });
}

/** Test-only reset hook; harmless in production and useful after browser DB errors. */
export function resetDurableDatabaseConnection(): void {
  databasePromise = null;
}
