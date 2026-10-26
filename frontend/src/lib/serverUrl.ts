const SERVER_URL_KEY = "efms_server_url";

/** عنوان السيرفر كما أدخله المستخدم، بلا شرطة أخيرة وبلا /api */
export function getServerUrl(): string {
  return (localStorage.getItem(SERVER_URL_KEY) || "").trim().replace(/\/+$/, "");
}

/** قيمة فارغة تعني العودة لنفس الأصل (الاستضافة) */
export function setServerUrl(url: string) {
  const clean = normalizeServerUrl(url);
  if (clean) localStorage.setItem(SERVER_URL_KEY, clean);
  else localStorage.removeItem(SERVER_URL_KEY);
}

export function normalizeServerUrl(url: string): string {
  let v = url.trim().replace(/\/+$/, "");
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v.replace(/\/api$/i, "");
}

/** بادئة الـAPI: إعداد المستخدم ← متغيّر البناء ← نفس الأصل */
export function apiBase(): string {
  const stored = getServerUrl();
  if (stored) return `${stored}/api`;
  const env = import.meta.env.VITE_API_BASE_URL;
  if (env) return normalizeServerUrl(env) + "/api";
  return "/api";
}

export function apiRoot(): string {
  return getServerUrl() || window.location.origin;
}
