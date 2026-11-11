/**
 * DailyLog CSV export row builder.
 *
 * Exported project/sector MUST be the stored snapshot of the record itself.
 * The equipment relation is used only for code/name, never for project/sector,
 * so a re-import or equipment transfer can never change an exported history.
 */

export const DAILYLOG_CSV_HEADERS = [
  "رقم السجل",
  "التاريخ",
  "كود المعدة",
  "اسم المعدة",
  "المشروع",
  "القطاع",
  "نهاية العداد",
  "ساعات التشغيل",
  "الديزل",
  "نوع الإنتاجية",
  "عدد الإنتاجية",
  "الصلاحية",
  "تفصيل الصلاحية",
  "ملاحظات",
  "المستخدم",
];

const CONDITION_AR: Record<string, string> = {
  GOOD: "صالح",
  BROKEN: "عاطل",
  STOPPED: "متوقف",
};

export interface DailyLogExportRecord {
  id: number;
  date: Date;
  equipment: { code: string; name: string };
  projectName?: string | null;
  projectCode?: string | null;
  sectorName?: string | null;
  endMeter?: number | null;
  operatingHours?: number | null;
  diesel?: number | null;
  productivityType?: string | null;
  productivityCount?: number | null;
  condition?: string | null;
  conditionNote?: string | null;
  notes?: string | null;
  user?: { name: string } | null;
}

export const UNKNOWN_CONTEXT_LABEL = "غير محدد";

/** Same values the Data Day table shows, in the same order. */
export function buildDailyLogExportRow(r: DailyLogExportRecord): unknown[] {
  return [
    r.id,
    r.date.toISOString().slice(0, 10),
    r.equipment.code,
    r.equipment.name,
    r.projectName || r.projectCode || UNKNOWN_CONTEXT_LABEL,
    r.sectorName || UNKNOWN_CONTEXT_LABEL,
    r.endMeter ?? "",
    r.operatingHours ?? "",
    r.diesel ?? "",
    r.productivityType ?? "",
    r.productivityCount ?? "",
    r.condition ? CONDITION_AR[r.condition] ?? r.condition : "",
    r.conditionNote ?? "",
    r.notes ?? "",
    r.user?.name ?? "",
  ];
}
