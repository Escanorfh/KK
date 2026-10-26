import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function formatDate(value: string): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export function toNumberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export const CONDITION_LABELS: Record<string, string> = {
  GOOD: "صالح",
  BROKEN: "عاطل",
  STOPPED: "متوقف",
};

export const MAINT_STATUS_LABELS: Record<string, string> = {
  NEW: "جديد",
  IN_PROGRESS: "جاري صيانة",
  DONE: "تم الصيانة",
  WAITING_PARTS: "متوقف الصيانة",
};

export const MAINT_STATUS_CLS: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-600",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  DONE: "bg-emerald-100 text-emerald-700",
  WAITING_PARTS: "bg-red-100 text-red-700",
};

export const ORDER_TYPES = ["مامورية", "داخلي", "خارجي", "تصنيع"];

export const MAINT_TYPES = ["صيانة دورية", "صيانة طارئة", "رفع كفاءة"];

export const WORKSHOPS = ["ورشة الموقع", "المركز الرئيسي للصيانة", "خارجي"];

export function normalizePartName(value: string): string {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

export function isEngineOilPart(partName: string): boolean {
  const name = normalizePartName(partName);
  return name.includes("زيت") && ["محرك", "موتور", "ماتور"].some((w) => name.includes(w));
}

export function isOilFilterPart(partName: string): boolean {
  const name = normalizePartName(partName);
  if (!name.includes("فلتر")) return false;
  if (["هيدروليك", "فتيس", "جاز", "ديزل", "سولار", "هوا", "فاصل"].some((w) => name.includes(w))) {
    return false;
  }
  return ["زيت", "محرك", "موتور", "ماتور"].some((w) => name.includes(w));
}

export const SERVICE_STATUS_LABELS: Record<string, string> = {
  OVERDUE: "متأخر",
  DUE: "مطلوب التغيير",
  DUE_SOON: "أوشكت",
  SAFE: "سليم",
  UNKNOWN: "بدون سجل",
  NOT_APPLICABLE: "لا ينطبق",
};

export const SERVICE_STATUS_CLS: Record<string, string> = {
  OVERDUE: "bg-red-100 text-red-700",
  DUE: "bg-orange-100 text-orange-700",
  DUE_SOON: "bg-amber-100 text-amber-700",
  SAFE: "bg-emerald-100 text-emerald-700",
  UNKNOWN: "bg-slate-100 text-slate-600",
  NOT_APPLICABLE: "bg-slate-100 text-slate-500",
};

export const OIL_ALERT_STATE_LABELS: Record<string, string> = {
  MODE_UNCONFIRMED: "وضع التتبع غير مؤكد",
  VERIFY_DATA: "تحقق من البيانات",
  BOTH_OVERDUE: "متأخر بالحدين",
  HOURS_OVERDUE: "متأخر بالساعات",
  KM_OVERDUE: "متأخر بالكيلومترات",
  BOTH_DUE: "مطلوب التغيير بالحدين",
  HOURS_DUE: "مطلوب التغيير بالساعات",
  KM_DUE: "مطلوب التغيير بالكيلومترات",
  BOTH_DUE_SOON: "أوشكت بالحدين",
  HOURS_DUE_SOON: "أوشكت بالساعات",
  KM_DUE_SOON: "أوشكت بالكيلومترات",
  OK: "سليم",
};

export const OIL_ALERT_STATE_CLS: Record<string, string> = {
  MODE_UNCONFIRMED: "bg-slate-100 text-slate-600 border border-slate-300",
  VERIFY_DATA: "bg-slate-100 text-slate-600 border border-slate-300",
  BOTH_OVERDUE: "bg-red-100 text-red-700",
  HOURS_OVERDUE: "bg-red-100 text-red-700",
  KM_OVERDUE: "bg-red-100 text-red-700",
  BOTH_DUE: "bg-orange-100 text-orange-700",
  HOURS_DUE: "bg-orange-100 text-orange-700",
  KM_DUE: "bg-orange-100 text-orange-700",
  BOTH_DUE_SOON: "bg-amber-50 text-amber-700 border border-amber-200",
  HOURS_DUE_SOON: "bg-amber-50 text-amber-700 border border-amber-200",
  KM_DUE_SOON: "bg-amber-50 text-amber-700 border border-amber-200",
  OK: "bg-emerald-100 text-emerald-700",
};

export const TRACKING_MODE_LABELS: Record<string, string> = {
  HOURS: "ساعات التشغيل",
  KM: "الكيلومترات",
  BOTH: "ساعات + كيلومترات",
};

export const TRACKING_MODE_SHORT_LABELS: Record<string, string> = {
  HOURS: "ساعات",
  KM: "كم",
  BOTH: "ساعات + كم",
};

export const TRACKING_MODE_CLS: Record<string, string> = {
  HOURS: "bg-amber-50 text-amber-700 border border-amber-200",
  KM: "bg-sky-50 text-sky-700 border border-sky-200",
  BOTH: "bg-violet-50 text-violet-700 border border-violet-200",
};

export function trackingModeAppliesHours(mode: string | null | undefined): boolean {
  return mode !== "KM";
}

export function trackingModeAppliesKm(mode: string | null | undefined): boolean {
  return mode !== "HOURS";
}

export function isPeriodicMaintenance(value: string | null | undefined): boolean {
  return normalizePartName(value ?? "").includes("دوريه");
}

export const OVERALL_STATUS_LABELS: Record<string, string> = {
  OIL_AND_FILTER: "يحتاج زيت و فلتر",
  OIL: "يحتاج زيت",
  FILTER: "يحتاج فلتر",
  DUE_SOON: "أوشكت",
  SAFE: "سليم",
  UNKNOWN: "بدون سجل",
};

export const OVERALL_STATUS_CLS: Record<string, string> = {
  OIL_AND_FILTER: "bg-red-100 text-red-700",
  OIL: "bg-orange-100 text-orange-700",
  FILTER: "bg-orange-100 text-orange-700",
  DUE_SOON: "bg-amber-100 text-amber-700",
  SAFE: "bg-emerald-100 text-emerald-700",
  UNKNOWN: "bg-slate-100 text-slate-600",
};
