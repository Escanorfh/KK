const DB_NAME = "efms-offline";
const DB_VERSION = 1;
const OUTBOX = "outbox";
const KV = "kv";

/** أقصى عدد من استجابات الـGET المخزّنة — الأقدم يُمسح أولًا */
const KV_LIMIT = 300;

export interface OutboxItem {
  id?: number;
  kind: string;
  method: "post" | "put";
  url: string;
  data: unknown;
  createdAt: number;
  attempts: number;
  /** سبب الفشل من السيرفر (رفض/تحقق) — العناصر المرفوضة لا تُعاد تلقائيًا */
  error?: string | null;
}

export interface CachedResponse<T = unknown> {
  key: string;
  data: T;
  at: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX)) {
          db.createObjectStore(OUTBOX, { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(KV)) {
          db.createObjectStore(KV, { keyPath: "key" }).createIndex("at", "at");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (objectStore: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = action(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function mutate(store: string, action: (objectStore: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        action(tx.objectStore(store));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

export function addOutbox(item: Omit<OutboxItem, "id">): Promise<IDBValidKey> {
  return run(OUTBOX, "readwrite", (s) => s.add(item as unknown as OutboxItem));
}

export function listOutbox(): Promise<OutboxItem[]> {
  return run(OUTBOX, "readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
}

export async function updateOutbox(id: number, patch: Partial<OutboxItem>): Promise<void> {
  const current = await run<OutboxItem | undefined>(OUTBOX, "readonly", (s) => s.get(id));
  if (!current) return;
  await run(OUTBOX, "readwrite", (s) => s.put({ ...current, ...patch }));
}

export function removeOutbox(id: number): Promise<void> {
  return mutate(OUTBOX, (s) => s.delete(id));
}

export function clearOutbox(): Promise<void> {
  return mutate(OUTBOX, (s) => s.clear());
}

export function kvSet(key: string, data: unknown): Promise<IDBValidKey> {
  return run(KV, "readwrite", (s) => s.put({ key, data, at: Date.now() } satisfies CachedResponse));
}

/** يمسح كاش القراءة فقط (الـ outbox يفضل) — مفتاح الكاش هو الـ URL وحده، فبدون المسح أي حساب على نفس الجهاز يقرأ داتا من سبقه. */
export function clearKv(): Promise<void> {
  return mutate(KV, (s) => s.clear());
}

export async function kvGet<T = unknown>(key: string): Promise<CachedResponse<T> | undefined> {
  return run<CachedResponse<T> | undefined>(KV, "readonly", (s) => s.get(key));
}

export async function kvLatestAt(): Promise<number | null> {
  const all = await run<CachedResponse[]>(KV, "readonly", (s) => s.getAll() as IDBRequest<CachedResponse[]>);
  return all.reduce((max, row) => Math.max(max, row.at), 0) || null;
}

/** تنظيف كاش الـGET عند بدء التشغيل */
export async function kvPrune(): Promise<void> {
  const all = await run<CachedResponse[]>(KV, "readonly", (s) => s.getAll() as IDBRequest<CachedResponse[]>);
  if (all.length <= KV_LIMIT) return;
  const stale = all.sort((a, b) => a.at - b.at).slice(0, all.length - KV_LIMIT);
  await mutate(KV, (s) => stale.forEach((row) => s.delete(row.key)));
}
