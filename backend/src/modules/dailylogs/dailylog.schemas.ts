import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح (YYYY-MM-DD)");
const optionalNum = z.coerce.number().min(0).nullable().optional();
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const saveDailyLogBase = z.object({
  id: z.coerce.number().int().optional(),
  date: dateStr,
  equipmentId: z.coerce.number().int().positive("اختر المعدة"),
  startMeter: optionalNum,
  endMeter: optionalNum,
  operatingHours: optionalNum,
  diesel: optionalNum,
  productivity: optionalText,
  condition: z.enum(["GOOD", "BROKEN", "STOPPED"]).nullable().optional(),
  conditionNote: optionalText,
  notes: optionalText,
});

export const saveDailyLogSchema = saveDailyLogBase
  .refine(
    (d) => d.startMeter == null || d.endMeter == null || d.endMeter >= d.startMeter,
    { message: "قراءة نهاية العداد لا يمكن أن تكون أقل من البداية", path: ["endMeter"] }
  );

export const updateDailyLogSchema = saveDailyLogBase.omit({ id: true }).partial();

export const listDailyLogQuerySchema = z.object({
  q: z.string().trim().optional(),
  code: z.string().trim().optional(),
  name: z.string().trim().optional(),
  sector: z.string().trim().optional(),
  productivity: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  user: z.string().trim().optional(),
  date: dateStr.optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
  equipmentId: z.coerce.number().int().optional(),
  projectId: z.coerce.number().int().optional(),
  condition: z.enum(["GOOD", "BROKEN", "STOPPED"]).optional(),
  meterStartFrom: z.coerce.number().min(0).optional(),
  meterStartTo: z.coerce.number().min(0).optional(),
  meterEndFrom: z.coerce.number().min(0).optional(),
  meterEndTo: z.coerce.number().min(0).optional(),
  hoursFrom: z.coerce.number().min(0).optional(),
  hoursTo: z.coerce.number().min(0).optional(),
  dieselFrom: z.coerce.number().min(0).optional(),
  dieselTo: z.coerce.number().min(0).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
