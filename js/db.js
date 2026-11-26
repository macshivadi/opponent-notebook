const DB_NAME = "opponent-notebook";
const DB_VER = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("opponents")) {
        db.createObjectStore("opponents", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("otb")) {
        const s = db.createObjectStore("otb", { keyPath: "id" });
        s.createIndex("byOpponent", "opponentId", { unique: false });
      }
      if (!db.objectStoreNames.contains("online")) {
        const s = db.createObjectStore("online", { keyPath: "id" });
        s.createIndex("byOpponent", "opponentId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("aborted"));
  });
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function uid() {
  return crypto.randomUUID();
}

export async function getAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const r = t.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function getById(store, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const r = t.objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

export async function put(store, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).put(value);
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error);
  });
}

export async function remove(store, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getByOpponent(store, opponentId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const idx = t.objectStore(store).index("byOpponent");
    const r = idx.getAll(opponentId);
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function clearStore(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function replaceAll(data) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["opponents", "otb", "online", "meta"], "readwrite");
    t.objectStore("opponents").clear();
    t.objectStore("otb").clear();
    t.objectStore("online").clear();
    for (const o of data.opponents || []) t.objectStore("opponents").put(o);
    for (const g of data.otb || []) t.objectStore("otb").put(g);
    for (const g of data.online || []) t.objectStore("online").put(g);
    if (data.meta) {
      for (const [k, v] of Object.entries(data.meta)) t.objectStore("meta").put(v, k);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function exportAll() {
  const [opponents, otb, online] = await Promise.all([
    getAll("opponents"),
    getAll("otb"),
    getAll("online"),
  ]);
  return {
    version: 1,
    app: "opponent-notebook",
    exportedAt: new Date().toISOString(),
    opponents,
    otb,
    online,
  };
}

export { openDb, req };
