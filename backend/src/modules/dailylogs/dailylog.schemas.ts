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
  endMeter: optionalNum,
  operatingHours: optionalNum,
  diesel: optionalNum,
  productivityType: optionalText,
  productivityCount: optionalNum,
  condition: z.enum(["GOOD", "BROKEN", "STOPPED"]).nullable().optional(),
  conditionNote: optionalText,
  notes: optionalText,
  clientRequestId: z.string().trim().min(1).max(120).optional(),
});

export const saveDailyLogSchema = saveDailyLogBase;

export const updateDailyLogSchema = saveDailyLogBase.omit({ id: true }).partial();

export const listDailyLogQuerySchema = z.object({
  q: z.string().trim().optional(),
  code: z.string().trim().optional(),
  name: z.string().trim().optional(),
  sector: z.string().trim().optional(),
  projectName: z.string().trim().optional(),
  productivityType: z.string().trim().optional(),
  productivityCountFrom: z.coerce.number().min(0).optional(),
  productivityCountTo: z.coerce.number().min(0).optional(),
  notes: z.string().trim().optional(),
  user: z.string().trim().optional(),
  date: dateStr.optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
  equipmentId: z.coerce.number().int().optional(),
  projectId: z.coerce.number().int().optional(),
  sectorId: z.coerce.number().int().optional(),
  condition: z.enum(["GOOD", "BROKEN", "STOPPED"]).optional(),
  meterEndFrom: z.coerce.number().min(0).optional(),
  meterEndTo: z.coerce.number().min(0).optional(),
  hoursFrom: z.coerce.number().min(0).optional(),
  hoursTo: z.coerce.number().min(0).optional(),
  dieselFrom: z.coerce.number().min(0).optional(),
  dieselTo: z.coerce.number().min(0).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
