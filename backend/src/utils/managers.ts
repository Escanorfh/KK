const TIMEOUT_MS = 20000;
const PROJECTS_TTL_MS = 5 * 60 * 1000;

export class ManagersApiError extends Error {
  status: number;
  upstreamStatus?: number;

  constructor(message: string, status: number, upstreamStatus?: number) {
    super(message);
    this.name = "ManagersApiError";
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

export interface ManagersProject {
  id: number;
  title: string;
  code: string | null;
  roomId: number | null;
  roomTitle: string | null;
  status: string | null;
}

export interface ManagersRequisition {
  id: number;
  requisition_number: string;
  status: string;
  status_label?: string | null;
}

export interface ManagersRepairOrder {
  id: number;
  order_number: string;
  status: string;
}

export interface ManagersProjectMatch {
  project: ManagersProject | null;
  ambiguous: ManagersProject[];
}

type JsonRecord = Record<string, unknown>;

let projectsCache: { expiresAt: number; data: ManagersProject[] } | null = null;

function config() {
  const baseUrl = (process.env.MANAGERS_API_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ManagersApiError("لم يتم إعداد رابط نظام المدرين (MANAGERS_API_URL)", 501);
  }
  const token = (process.env.MANAGERS_API_TOKEN || "").trim();
  if (!token) {
    throw new ManagersApiError("لم يتم إعداد مفتاح نظام المدرين (MANAGERS_API_TOKEN)", 501);
  }
  return { baseUrl, token };
}

function errorText(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 400);
  if (body && typeof body === "object") {
    const obj = body as JsonRecord;
    for (const key of ["message", "error", "errors", "detail"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 400);
      if (Array.isArray(value) && value.length) {
        return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("؛ ").slice(0, 400);
      }
      if (value && typeof value === "object") {
        const parts = Object.values(value)
          .flat()
          .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
          .filter(Boolean);
        if (parts.length) return parts.join("؛ ").slice(0, 400);
      }
    }
  }
  return fallback;
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const { baseUrl, token } = config();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    const detail = err instanceof Error ? `${err.message}${cause ? ` (${cause})` : ""}` : String(err);
    throw new ManagersApiError(`تعذر الاتصال بنظام المدرين: ${detail}`, 502);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    throw new ManagersApiError(
      `نظام المدرين رفض الطلب (HTTP ${res.status}): ${errorText(body, res.statusText || "خطأ غير معروف")}`,
      502,
      res.status
    );
  }

  if (body && typeof body === "object" && (body as JsonRecord).ok === false) {
    throw new ManagersApiError(
      `نظام المدرين رفض الطلب: ${errorText(body, "خطأ غير معروف")}`,
      502
    );
  }

  return body as T;
}

function toInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readProject(raw: JsonRecord): ManagersProject | null {
  const id = toInt(raw.id);
  const title = toText(raw.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    code: toText(raw.code),
    roomId: toInt(raw.room_id),
    roomTitle: toText(raw.room_title),
    status: toText(raw.status),
  };
}

export async function managersProjects(force = false): Promise<ManagersProject[]> {
  if (!force && projectsCache && projectsCache.expiresAt > Date.now()) {
    return projectsCache.data;
  }

  const body = await request<JsonRecord>("/requisitions/projects");
  const rawProjects = Array.isArray(body.projects) ? body.projects : [];
  const projects = rawProjects
    .map((item) => (item && typeof item === "object" ? readProject(item as JsonRecord) : null))
    .filter((item): item is ManagersProject => item !== null);

  if (!projects.length) {
    throw new ManagersApiError("لم يرجع نظام المدرين أي مشاريع متاحة", 502);
  }

  projectsCache = { expiresAt: Date.now() + PROJECTS_TTL_MS, data: projects };
  return projects;
}

const DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

export function normalizeArabic(value: string): string {
  return value
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(NON_WORD, " ")
    .trim()
    .toLowerCase();
}

function compact(value: string): string {
  return normalizeArabic(value).replace(/\s+/g, "");
}

const PROJECT_ALIASES: Record<string, string> = {
  ابوقيركباري: "ابوقير",
  ابوقيرطرق: "ابوقير",
  ابوقيركباريc: "ابوقير",
  كوبريالحمام: "ترعهالحمام",
};

function hasRoom(project: ManagersProject) {
  return project.roomId !== null;
}

function preferProject(projects: ManagersProject[]): ManagersProject {
  return [...projects].sort((a, b) => {
    if (hasRoom(a) !== hasRoom(b)) return hasRoom(a) ? -1 : 1;
    if ((a.status === "active") !== (b.status === "active")) return a.status === "active" ? -1 : 1;
    return a.id - b.id;
  })[0];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Uint32Array(b.length + 1);
  let next = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    next[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, next] = [next, prev];
  }

  return prev[b.length];
}

function nameScore(localName: string, remoteName: string): number {
  const localNorm = normalizeArabic(localName);
  const remoteNorm = normalizeArabic(remoteName);
  const localCompact = localNorm.replace(/\s+/g, "");
  const remoteCompact = remoteNorm.replace(/\s+/g, "");

  if (!localCompact || !remoteCompact) return 0;
  if (localCompact === remoteCompact) return 1;

  const maxLen = Math.max(localCompact.length, remoteCompact.length);
  let score = 1 - levenshtein(localCompact, remoteCompact) / maxLen;

  const localTokens = localNorm.split(" ").filter(Boolean);
  const remoteTokens = remoteNorm.split(" ").filter(Boolean);
  const isSubset = (small: string[], big: string[]) =>
    small.length > 0 && small.length <= big.length && small.every((token) => big.includes(token));

  if (isSubset(remoteTokens, localTokens) || isSubset(localTokens, remoteTokens)) {
    const extraTokens = Math.abs(localTokens.length - remoteTokens.length);
    score = Math.max(score, 0.9 - extraTokens * 0.02);
  }

  return score;
}

const MIN_MATCH_SCORE = 0.84;

export async function matchManagersProject(project: {
  name: string;
  code?: string | null;
}): Promise<ManagersProjectMatch> {
  const projects = await managersProjects();

  if (project.code) {
    const code = project.code.trim().toLowerCase();
    const byCode = projects.filter((p) => p.code && p.code.toLowerCase() === code);
    if (byCode.length) return { project: preferProject(byCode), ambiguous: [] };
  }

  const localCompact = compact(project.name);
  if (!localCompact) return { project: null, ambiguous: [] };

  const aliasTarget = PROJECT_ALIASES[localCompact];
  if (aliasTarget) {
    const aliasMatches = projects.filter((p) => compact(p.title) === aliasTarget);
    if (aliasMatches.length) return { project: preferProject(aliasMatches), ambiguous: [] };
  }

  const exactMatches = projects.filter((p) => compact(p.title) === localCompact);
  if (exactMatches.length) return { project: preferProject(exactMatches), ambiguous: [] };

  const scored = projects
    .map((p) => ({ project: p, score: nameScore(project.name, p.title) }))
    .filter((item) => item.score >= MIN_MATCH_SCORE)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (hasRoom(a.project) !== hasRoom(b.project)) return hasRoom(a.project) ? -1 : 1;
      return a.project.id - b.project.id;
    });

  if (!scored.length) return { project: null, ambiguous: [] };

  const best = scored[0];
  const rival = scored[1];
  if (rival && best.score - rival.score < 0.02 && hasRoom(best.project) === hasRoom(rival.project)) {
    return { project: null, ambiguous: [best.project, rival.project] };
  }

  return { project: best.project, ambiguous: [] };
}

export async function resolveManagersProject(project: {
  name: string;
  code?: string | null;
}): Promise<ManagersProject> {
  const { project: matched, ambiguous } = await matchManagersProject(project);

  if (matched) return matched;

  const projects = await managersProjects();
  const available = [...new Set(projects.map((p) => p.title))].join("، ");

  if (ambiguous.length) {
    throw new ManagersApiError(
      `اسم المشروع «${project.name}» يطابق أكثر من مشروع في نظام المدرين: ${ambiguous
        .map((p) => p.title)
        .join("، ")}. راجع اسم المشروع أو اختر مشروعًا مختلفًا`,
      422
    );
  }

  throw new ManagersApiError(
    `تعذر مطابقة مشروع «${project.name}» بأي مشروع في نظام المدرين. المشاريع المتاحة: ${available}`,
    422
  );
}

function parseCreatedId(body: JsonRecord): number | null {
  const data = body.data && typeof body.data === "object" ? (body.data as JsonRecord) : null;
  const entity =
    body.requisition && typeof body.requisition === "object"
      ? (body.requisition as JsonRecord)
      : body.repair_order && typeof body.repair_order === "object"
        ? (body.repair_order as JsonRecord)
        : null;
  return (
    toInt(body.id) ??
    toInt(data?.id) ??
    toInt(entity?.id) ??
    null
  );
}

function parseCreatedNumber(body: JsonRecord, keys: string[]): string | null {
  const data = body.data && typeof body.data === "object" ? (body.data as JsonRecord) : null;
  const entity =
    body.requisition && typeof body.requisition === "object"
      ? (body.requisition as JsonRecord)
      : body.repair_order && typeof body.repair_order === "object"
        ? (body.repair_order as JsonRecord)
        : null;

  for (const source of [body, data, entity]) {
    if (!source) continue;
    for (const key of keys) {
      const value = toText(source[key]);
      if (value) return value;
    }
  }
  return null;
}

export async function createRequisition(payload: JsonRecord): Promise<{ id: number; number: string | null }> {
  const body = await request<JsonRecord>("/requisitions", { method: "POST", body: payload });
  const id = parseCreatedId(body);
  if (!id) throw new ManagersApiError("تم إرسال الطلب لكن استجابة نظام المدرين لا تحتوي على رقم تعريفي", 502);
  return { id, number: parseCreatedNumber(body, ["requisition_number", "number"]) };
}

export async function getRequisition(id: number): Promise<ManagersRequisition> {
  const body = await request<JsonRecord>(`/requisitions/${id}`);
  const raw = body.requisition;
  if (!raw || typeof raw !== "object") {
    throw new ManagersApiError("استجابة نظام المدرين لطلب الاحتياج غير صحيحة", 502);
  }
  const record = raw as JsonRecord;
  return {
    id: toInt(record.id) ?? id,
    requisition_number: toText(record.requisition_number) ?? "",
    status: toText(record.status) ?? "",
    status_label: toText(record.status_label),
  };
}

export async function updateRequisition(id: number, payload: JsonRecord): Promise<void> {
  await request<JsonRecord>(`/requisitions/${id}`, { method: "PUT", body: payload });
}

export async function deleteRequisition(id: number): Promise<"deleted" | "missing"> {
  try {
    await request<JsonRecord>(`/requisitions/${id}`, { method: "DELETE" });
    return "deleted";
  } catch (err) {
    if (err instanceof ManagersApiError && err.upstreamStatus === 404) return "missing";
    throw err;
  }
}

export async function createRepairOrder(payload: JsonRecord): Promise<{ id: number; number: string | null }> {
  const body = await request<JsonRecord>("/repair-orders", { method: "POST", body: payload });
  const id = parseCreatedId(body);
  if (!id) throw new ManagersApiError("تم إرسال الطلب لكن استجابة نظام المدرين لا تحتوي على رقم تعريفي", 502);
  return { id, number: parseCreatedNumber(body, ["order_number", "number"]) };
}

export async function getRepairOrder(id: number): Promise<ManagersRepairOrder> {
  const body = await request<JsonRecord>(`/repair-orders/${id}`);
  const raw = body.repair_order;
  if (!raw || typeof raw !== "object") {
    throw new ManagersApiError("استجابة نظام المدرين لأمر الإصلاح غير صحيحة", 502);
  }
  const record = raw as JsonRecord;
  return {
    id: toInt(record.id) ?? id,
    order_number: toText(record.order_number) ?? "",
    status: toText(record.status) ?? "",
  };
}

export async function updateRepairOrder(id: number, payload: JsonRecord): Promise<void> {
  await request<JsonRecord>(`/repair-orders/${id}`, { method: "PUT", body: payload });
}

export async function deleteRepairOrder(id: number): Promise<"deleted" | "missing"> {
  try {
    await request<JsonRecord>(`/repair-orders/${id}`, { method: "DELETE" });
    return "deleted";
  } catch (err) {
    if (err instanceof ManagersApiError && err.upstreamStatus === 404) return "missing";
    throw err;
  }
}

export const requisitionStatusLabels: Record<string, string> = {
  review_in_progress: "قيد المراجعة",
  reviewed: "تمت المراجعة",
  warehouse_in_progress: "قيد التنفيذ بالمخازن",
  warehouse_completed: "تم التوريد من المخازن",
  purchasing_in_progress: "قيد الشراء",
  purchasing_completed: "تم الشراء",
  cancelled: "ملغي",
  postponed: "مؤجل",
};

export const repairOrderStatusLabels: Record<string, string> = {
  in_repair: "قيد الإصلاح",
  repaired_disbursed: "تم الإصلاح والصرف",
  cancelled: "ملغي",
};

export function requisitionStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return requisitionStatusLabels[status] ?? status;
}

export function repairOrderStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return repairOrderStatusLabels[status] ?? status;
}

export function mapRequisitionDepartment(value: string): "مخازن" | "مشتريات" | "متابعة" {
  const normalized = normalizeArabic(value);
  if (normalized.includes("مشتريات")) return "مشتريات";
  if (normalized.includes("متابعه")) return "متابعة";
  return "مخازن";
}

export function managersDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
