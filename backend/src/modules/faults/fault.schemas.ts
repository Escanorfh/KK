import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح (YYYY-MM-DD)");
const optionalNum = z.coerce.number().min(0).nullable().optional();
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const createFaultSchema = z.object({
  date: dateStr,
  equipmentId: z.coerce.number().int().positive("اختر المعدة"),
  description: z.string().trim().min(1, "وصف العطل مطلوب"),
  cause: optionalText,
  faultType: optionalText,
  downtimeHours: optionalNum,
  actionTaken: optionalText,
  status: z.enum(["NEW", "IN_PROGRESS", "DONE", "WAITING_PARTS"]).default("NEW"),
});

export const updateFaultSchema = createFaultSchema.partial();

export const listFaultQuerySchema = z.object({
  q: z.string().trim().optional(),
  date: dateStr.optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
  equipmentId: z.coerce.number().int().optional(),
  projectId: z.coerce.number().int().optional(),
  status: z.enum(["NEW", "IN_PROGRESS", "DONE", "WAITING_PARTS"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const faultReportQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  date: dateStr.optional(),
});
