import { api, getApiError, isOfflineError } from "@/lib/api";
import { addOutbox, listOutbox, removeOutbox, updateOutbox, type OutboxItem } from "./db";
import type { User } from "@/types";

export interface Queued {
  queued: true;
}

export function isQueued(value: unknown): value is Queued {
  return !!value && typeof value === "object" && (value as { queued?: boolean }).queued === true;
}

export type QueueInput = Pick<OutboxItem, "kind" | "method" | "url" | "data"> & {
  userId?: number;
};

type Listener = (items: OutboxItem[]) => void;

const listeners = new Set<Listener>();
let snapshot: OutboxItem[] = [];
let flushing = false;
let started = false;
let initialLoaded = false;
let flushLocked = false;
let initialLoadPromise: Promise<OutboxItem[]> | null = null;

/**
 * بوابة التنسيق الذري للعمليات (Atomic Operation Gate):
 * تتبع عدد عمليات queueWrite الجارية حالياً لمنع أي سباق زمني أثناء فحص وتسجيل الخروج.
 */
let activeQueueWritesCount = 0;
let queueWritesBlocked = false;
const activeWriteDrainedResolvers: Array<() => void> = [];

function notifyWritesDrainedIfIdle(): void {
  if (activeQueueWritesCount === 0 && activeWriteDrainedResolvers.length > 0) {
    const resolvers = activeWriteDrainedResolvers.splice(0, activeWriteDrainedResolvers.length);
    resolvers.forEach((resolve) => resolve());
  }
}

/**
 * ينتظر انتهاء كافة عمليات الكتابة الجارية في الـ Outbox.
 */
export function waitForActiveQueueWrites(): Promise<void> {
  if (activeQueueWritesCount === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    activeWriteDrainedResolvers.push(resolve);
  });
}

/**
 * حجز بوابة الخروج والانتقال للجلسة:
 * يقفل الـ Worker ويمنع قبول أي عمليات كتابة جديدة، ثم ينتظر اكتمال العمليات الجارية.
 */
export async function beginSessionCoordinationLock(): Promise<void> {
  flushLocked = true;
  queueWritesBlocked = true;
  await waitForActiveQueueWrites();
}

/**
 * إلغاء قفل بوابة الجلسة في حال فشل الخروج أو إلغائه بأمان.
 */
export function releaseSessionCoordinationLock(): void {
  flushLocked = false;
  queueWritesBlocked = false;
}

export function isQueueWritesBlocked(): boolean {
  return queueWritesBlocked;
}

function getCurrentAuthUser(): User | null {
  try {
    const raw = localStorage.getItem("efms_user");
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function lockOutboxWorker(): void {
  flushLocked = true;
}

export function unlockOutboxWorker(): void {
  flushLocked = false;
}

export function isOutboxWorkerLocked(): boolean {
  return flushLocked;
}

export async function waitForInitialOutboxLoad(): Promise<OutboxItem[]> {
  if (initialLoaded) return snapshot;
  if (!initialLoadPromise) {
    initialLoadPromise = publish().then(() => {
      initialLoaded = true;
      return snapshot;
    });
  }
  return initialLoadPromise;
}

async function publish(): Promise<void> {
  snapshot = await listOutbox();
  initialLoaded = true;
  listeners.forEach((l) => l(snapshot));
}

export function getOutboxItems(): OutboxItem[] {
  return snapshot;
}

export function isInitialOutboxLoaded(): boolean {
  return initialLoaded;
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void publish();
  return () => listeners.delete(listener);
}

export async function queueWrite(input: QueueInput): Promise<void> {
  if (queueWritesBlocked) {
    throw new Error("تعذّر حفظ العملية محليًا — جلسة العمل قيد الإغلاق أو تسجيل الخروج");
  }

  activeQueueWritesCount++;
  try {
    let resolvedUserId: number | "LEGACY_UNASSIGNED" = "LEGACY_UNASSIGNED";
    if (typeof input.userId === "number") {
      resolvedUserId = input.userId;
    } else {
      const user = getCurrentAuthUser();
      if (user && typeof user.id === "number") {
        resolvedUserId = user.id;
      }
    }

    // تحقق مزدوج قبل الإيداع الفعلي في قاعدة البيانات
    if (queueWritesBlocked) {
      throw new Error("تعذّر حفظ العملية محليًا — جلسة العمل قيد الإغلاق أو تسجيل الخروج");
    }

    // تمييز اللقطة الملتقطة دون اتصال: عند التخزين في Outbox نضع capturedOffline=true
    // ليتميّز الإرسال المؤجّل عن الإرسال (online) (B.2.4.3.3).
    let offlineData = input.data;
    if (offlineData && typeof offlineData === "object" && !Array.isArray(offlineData)) {
      const ctx = (offlineData as { context?: Record<string, unknown> }).context;
      if (ctx && typeof ctx === "object") {
        offlineData = { ...(offlineData as Record<string, unknown>), context: { ...ctx, capturedOffline: true } };
      }
    }

    await addOutbox({
      ...input,
      data: offlineData,
      userId: resolvedUserId,
      createdAt: Date.now(),
      attempts: 0,
      error: null,
    });
    await publish();
  } finally {
    activeQueueWritesCount--;
    notifyWritesDrainedIfIdle();
  }
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

/** يعيد إرسال ما هو محفوظ محليًا بالترتيب، ويتوقف عند أول انقطاع، مع العزل الصارم للمستخدمين */
export async function flushOutbox(): Promise<void> {
  if (flushing || flushLocked) return;

  const currentUser = getCurrentAuthUser();
  const token = localStorage.getItem("efms_token");

  // لا نقوم بالإرسال إطلاقاً إذا لم تكن هناك جلسة ومستخدم موثق
  if (!currentUser || typeof currentUser.id !== "number" || !token) {
    return;
  }

  flushing = true;
  try {
    for (const item of await listOutbox()) {
      if (flushLocked) break;
      if (item.error || item.id == null) continue;

      // العمليات القديمة بدون userId: تظل محفوظة ولا تُرسل
      if (item.userId === undefined || item.userId === null || item.userId === "LEGACY_UNASSIGNED") {
        continue;
      }

      // إذا كانت العملية تخص مستخدماً آخر: تخطاها تماماً لحمايتها وحماية هوية المستخدم الحالي
      if (item.userId !== currentUser.id) {
        continue;
      }

      if (!navigator.onLine) break;

      // تحقق إضافي في كل دورة للتأكد من عدم تغير المستخدم أو التوكن في الـ localStorage أثناء المعالجة
      const activeUser = getCurrentAuthUser();
      const activeToken = localStorage.getItem("efms_token");
      if (!activeUser || activeUser.id !== currentUser.id || !activeToken) {
        break;
      }

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
  initialLoadPromise = publish().then(() => {
    initialLoaded = true;
    if (snapshot.length) void flushOutbox();
    return snapshot;
  });
}
