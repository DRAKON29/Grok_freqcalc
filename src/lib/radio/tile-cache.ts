// Кэш HGT-тайлов в IndexedDB — переживает перезагрузку страницы.
// SRTM-тайлы весят 3–26 МБ, поэтому localStorage не подходит; IndexedDB
// хранит ArrayBuffer напрямую. При загрузке компонента тайлы восстанавливаются
// из кэша и парсятся через parseHgt.

const DB_NAME = "radio-prop-cache";
const DB_VERSION = 1;
const STORE = "hgt-tiles";

export interface CachedTileMeta {
  name: string;
  bytes: number;
  arcSec: number;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB недоступен"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Сохранить тайл в кэш. */
export async function saveTile(
  name: string,
  buffer: ArrayBuffer,
  arcSec: number
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      name,
      buffer,
      bytes: buffer.byteLength,
      arcSec,
      savedAt: Date.now(),
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Удалить один тайл из кэша. */
export async function deleteTile(name: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Очистить весь кэш тайлов. */
export async function clearAllTiles(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Список метаданных всех закэшированных тайлов (без самих данных). */
export async function listCachedTiles(): Promise<CachedTileMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      db.close();
      resolve(
        (req.result as Array<Omit<CachedTileMeta, "buffer"> & { buffer: ArrayBuffer }>).map(
          (r) => ({ name: r.name, bytes: r.bytes, arcSec: r.arcSec, savedAt: r.savedAt })
        )
      );
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Загрузить все закэшированные тайлы как Map<name, { buffer, arcSec }>.
 * Парсинг делается вызывающим кодом через parseHgt.
 */
export async function loadAllCachedBuffers(): Promise<
  Map<string, { buffer: ArrayBuffer; arcSec: number }>
> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      db.close();
      const map = new Map<string, { buffer: ArrayBuffer; arcSec: number }>();
      for (const r of req.result as Array<{
        name: string;
        buffer: ArrayBuffer;
        arcSec: number;
      }>) {
        map.set(r.name, { buffer: r.buffer, arcSec: r.arcSec });
      }
      resolve(map);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}
