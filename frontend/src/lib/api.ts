import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import type { ApiError } from "@/types";
import { apiBase } from "@/lib/serverUrl";
import { clearKv, kvGet, kvSet } from "@/lib/offline/db";

let isTransitioningSession = false;
let kvClearPromise: Promise<void> | null = null;

export async function safeClearKvCoordinated(): Promise<void> {
  if (!kvClearPromise) {
    kvClearPromise = clearKv().catch((err) => {
      console.error("KV cache clear failed safely:", err);
    }).finally(() => {
      kvClearPromise = null;
    });
  }
  return kvClearPromise;
}

export async function handleSessionTransition(reason: "401" | "logout" | "switch"): Promise<void> {
  if (isTransitioningSession) return;
  isTransitioningSession = true;

  try {
    // 1. إيقاف وقفل الـ Outbox وبوابة العمليات فوراً
    const { lockOutboxWorker, beginSessionCoordinationLock } = await import("@/lib/offline/queue");
    lockOutboxWorker();
    await beginSessionCoordinationLock();

    // 2. إزالة بيانات الجلسة من التخزين المحلي
    localStorage.removeItem("efms_token");
    localStorage.removeItem("efms_user");

    // 3. تنظيف كاش القراءة بشكل منسق مع حماية من الفشل
    await safeClearKvCoordinated();

    if (reason === "401" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  } finally {
    isTransitioningSession = false;
  }
}

export const api = axios.create({
  baseURL: apiBase(),
});

/** مفتاح الكاش بدون أصل السيرفر: تغيير عنوان السيرفر (مثلاً IP الشبكة) لا يُهدر البيانات المخزّنة */
function cacheKey(config: Pick<InternalAxiosRequestConfig, "url" | "params">) {
  const url = (config.url || "").replace(/^https?:\/\/[^/]+/, "");
  return `${url}?${JSON.stringify(config.params ?? {})}`;
}

function isCacheableGet(config: InternalAxiosRequestConfig) {
  const url = config.url || "";
  return (
    config.method === "get" &&
    (config.responseType ?? "json") === "json" &&
    !url.includes("/export") &&
    !url.includes("/health")
  );
}

api.interceptors.request.use((config) => {
  // عنوان السيرفر قابل للتغيير من الإعدادات دون إعادة بناء
  config.baseURL = apiBase();
  const token = localStorage.getItem("efms_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => {
    if (isCacheableGet(res.config)) void kvSet(cacheKey(res.config), res.data).catch(() => undefined);
    return res;
  },
  async (error) => {
    const status = error.response?.status;
    if (status === 401 && !error.config?.url?.includes("/auth/login")) {
      await handleSessionTransition("401");
    }

    // بدون اتصال: نخدم آخر نسخة مخزّنة من نفس الطلب
    if (!error.response && error.config && isCacheableGet(error.config)) {
      const hit = await kvGet(cacheKey(error.config)).catch(() => undefined);
      if (hit) {
        return {
          data: hit.data,
          status: 200,
          statusText: "offline-cache",
          headers: {},
          config: error.config,
          request: error.request,
        } as AxiosResponse;
      }
    }

    return Promise.reject(error);
  }
);

/** فشل شبكة (مفيش اتصال أو السيرفر واقع) — مش رفض من السيرفر */
export function isOfflineError(err: unknown): boolean {
  const e = err as { response?: unknown; code?: string } | null;
  return !!e && !e.response;
}

export function getApiError(err: unknown): string {
  const e = err as { response?: { data?: ApiError | string }; code?: string };
  if (!e?.response) {
    return "لا يوجد اتصال بالسيرفر — البيانات المدخلة هتتحفظ محليًا وتتبعت تلقائيًا عند عودة الاتصال";
  }
  const data = e.response.data;
  if (typeof data === "string") {
    return "تعذّر الاتصال بالسيرفر — تأكد من عنوان السيرفر في «حالة الاتصال»";
  }
  return data?.message || "حدث خطأ غير متوقع";
}

export function getApiFieldErrors(err: unknown): Record<string, string[]> {
  const e = err as { response?: { data?: ApiError } };
  return e?.response?.data?.errors || {};
}

export default api;
