import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const UNIT_VALUES = ["ساعة", "كم", "يوم", "شهر"] as const;

export const createPartScheduleSchema = z.object({
  equipmentId: z.coerce.number().int().positive("اختر المعدة"),
  partName: z.string().trim().min(1, "اسم الصنف مطلوب"),
  interval: z.coerce.number().positive("الفترة لازم تكون أكبر من صفر"),
  unit: z.enum(UNIT_VALUES).default("ساعة"),
  notes: optionalText,
});

export const updatePartScheduleSchema = createPartScheduleSchema.partial();

export const listPartScheduleQuerySchema = z.object({
  equipmentId: z.coerce.number().int().positive("اختر المعدة"),
});

export const OVERALL_STATUS_VALUES = [
  "OIL_AND_FILTER",
  "OIL",
  "FILTER",
  "DUE_SOON",
  "SAFE",
  "UNKNOWN",
] as const;

// OIL_DUE = قائمة معدات الزيت (تشمل OIL_AND_FILTER)، والفلتر دائمًا مجموعة فرعية منها
export const ALERT_FILTER_VALUES = [
  ...OVERALL_STATUS_VALUES,
  "OIL_DUE",
  "MODE_UNCONFIRMED",
] as const;

export const alertsQuerySchema = z.object({
  status: z.enum(ALERT_FILTER_VALUES).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().optional(),
});
