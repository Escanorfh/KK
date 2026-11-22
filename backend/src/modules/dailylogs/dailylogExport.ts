/**
 * DailyLog CSV export row builder.
 *
 * Exported project/sector MUST be the stored snapshot of the record itself.
 * The equipment relation is used only for code/name, never for project/sector,
 * so a re-import or equipment transfer can never change an exported history.
 */

export const DAILYLOG_CSV_HEADERS = [
  "م",
  "كود المعدة",
  "الصلاحية",
  "ساعات التشغيل",
  "عداد الساعات",
  "عداد الكياومترات",
  "اسم السائق100",
  "اسم السائق200",
  "السولار",
  "الانتاجية ",
  "الانتاجية 3",
  "ملاحظات",
  "الساعة",
  "الكيلو",
  "المشروع:",
  "التاريخ",
  "القطاع",
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
  const conditionAr = r.condition ? CONDITION_AR[r.condition] ?? r.condition : "";
  return [
    r.id,                                                          // 0 م
    r.equipment.code,                                              // 1 كود المعدة
    conditionAr,                                                   // 2 الصلاحية
    r.operatingHours ?? "",                                        // 3 ساعات التشغيل
    r.endMeter ?? "",                                              // 4 عداد الساعات
    "",                                                            // 5 عداد الكياومترات
    "",                                                            // 6 اسم السائق100
    "",                                                            // 7 اسم السائق200
    r.diesel ?? "",                                                // 8 السولار
    r.productivityCount ?? r.productivityType ?? "",                // 9 الانتاجية
    "",                                                            // 10 الانتاجية 3
    r.notes ?? "",                                                 // 11 ملاحظات
    "",                                                            // 12 الساعة
    "",                                                            // 13 الكيلو
    r.projectName || r.projectCode || UNKNOWN_CONTEXT_LABEL,        // 14 المشروع:
    r.date.toISOString().slice(0, 10),                             // 15 الت日期
    r.sectorName || UNKNOWN_CONTEXT_LABEL,                         // 16 القطاع
  ];
}
