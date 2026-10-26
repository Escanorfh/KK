import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح (YYYY-MM-DD)");
const optionalNum = z.coerce.number().min(0).nullable().optional();
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const partSchema = z.object({
  name: z.string().trim().min(1, "اسم الصنف مطلوب"),
  code: optionalText,
  qty: z.coerce.number().min(0).nullable().optional(),
  notes: optionalText,
});

export const createMaintenanceSchema = z.object({
  workOrderNo: z.coerce.number().int().nullable().optional(),
  date: dateStr,
  endDate: dateStr.nullable().optional(),
  equipmentId: z.coerce.number().int().positive("اختر المعدة"),
  workType: z.enum(["MAINTENANCE", "REPAIR"]).default("MAINTENANCE"),
  orderType: optionalText,
  maintenanceType: optionalText,
  workshop: optionalText,
  description: optionalText,
  action: optionalText,
  meterReading: optionalNum,
  kmMeter: optionalNum,
  downtime: optionalNum,
  status: z.enum(["NEW", "IN_PROGRESS", "DONE", "WAITING_PARTS"]).default("NEW"),
  notes: optionalText,
  parts: z.array(partSchema).default([]),
});

export const updateMaintenanceSchema = createMaintenanceSchema.partial();

export const listMaintenanceQuerySchema = z.object({
  q: z.string().trim().optional(),
  date: dateStr.optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
  endDateFrom: dateStr.optional(),
  endDateTo: dateStr.optional(),
  equipmentId: z.coerce.number().int().optional(),
  projectId: z.coerce.number().int().optional(),
  code: z.string().trim().optional(),
  name: z.string().trim().optional(),
  orderType: z.string().trim().optional(),
  maintenanceType: z.string().trim().optional(),
  workshop: z.string().trim().optional(),
  description: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  user: z.string().trim().optional(),
  part: z.string().trim().optional(),
  workOrderNo: z.coerce.number().int().optional(),
  meterFrom: z.coerce.number().min(0).optional(),
  meterTo: z.coerce.number().min(0).optional(),
  status: z.enum(["NEW", "IN_PROGRESS", "DONE", "WAITING_PARTS"]).optional(),
  workType: z.enum(["MAINTENANCE", "REPAIR"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
