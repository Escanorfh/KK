import { api, getApiError, isOfflineError } from "@/lib/api";
import { addOutbox, listOutbox, removeOutbox, updateOutbox, type OutboxItem } from "./db";

export interface Queued {
  queued: true;
}

export function isQueued(value: unknown): value is Queued {
  return !!value && typeof value === "object" && (value as { queued?: boolean }).queued === true;
}

export type QueueInput = Pick<OutboxItem, "kind" | "method" | "url" | "data">;

type Listener = (items: OutboxItem[]) => void;

const listeners = new Set<Listener>();
let snapshot: OutboxItem[] = [];
let flushing = false;
let started = false;

async function publish(): Promise<void> {
  snapshot = await listOutbox();
  listeners.forEach((l) => l(snapshot));
}

export function getOutboxItems(): OutboxItem[] {
  return snapshot;
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void publish();
  return () => listeners.delete(listener);
}

export async function queueWrite(input: QueueInput): Promise<void> {
  await addOutbox({ ...input, createdAt: Date.now(), attempts: 0, error: null });
  await publish();
}

export async function discardQueued(id: number): Promise<void> {
  await removeOutbox(id);
  await publish();
}

export async function retryQueued(id: number): Promise<void> {
  await updateOutbox(id, { error: null });
  await publish();
  await flushOutbox();
}

/** يعيد إرسال ما هو محفوظ محليًا بالترتيب، ويتوقف عند أول انقطاع */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of await listOutbox()) {
      if (item.error || item.id == null) continue;
      if (!navigator.onLine) break;
      try {
        await api.request({ method: item.method, url: item.url, data: item.data });
        await removeOutbox(item.id);
      } catch (err) {
        // لسه من غير اتصال، أو الجلسة انتهت: نحتفظ بالعناصر ونحاول لاحقًا
        if (isOfflineError(err) || (err as { response?: { status?: number } }).response?.status === 401) break;
        await updateOutbox(item.id, { attempts: (item.attempts ?? 0) + 1, error: getApiError(err) });
      }
      await publish();
    }
  } finally {
    flushing = false;
    await publish();
  }
}

export function startOutboxWorker(): void {
  if (started) return;
  started = true;
  window.addEventListener("online", () => void flushOutbox());
  window.addEventListener("focus", () => {
    if (getOutboxItems().length) void flushOutbox();
  });
  setInterval(() => {
    if (getOutboxItems().length && navigator.onLine) void flushOutbox();
  }, 30_000);
  void publish().then(() => {
    if (snapshot.length) void flushOutbox();
  });
}
