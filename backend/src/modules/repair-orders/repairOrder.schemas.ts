import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح (YYYY-MM-DD)");
const optionalNum = z.coerce.number().min(0).nullable().optional();
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optionalId = z.coerce.number().int().positive().nullable().optional();

export const REPAIR_STATUSES = ["PENDING", "RECEIVED", "IN_REPAIR", "REPAIRED", "LOADED", "RETURNED"] as const;
export const REPAIR_CONDITIONS = ["عاطلة", "صالح", "هالك"] as const;

const partSchema = z.object({
  name: z.string().trim().min(1, "اسم الصنف مطلوب"),
  code: optionalText,
  qty: optionalNum,
  notes: optionalText,
});

export const createRepairOrderSchema = z.object({
  type: z.enum(["INTERNAL", "EXTERNAL"]).default("INTERNAL"),
  equipmentId: z.coerce.number().int().positive("اختر المعدة"),
  projectId: z.coerce.number().int().positive().nullable().optional(),
  sectorId: z.coerce.number().int().positive().nullable().optional(),
  entryDate: dateStr.nullable().optional(),
  exitDate: dateStr.nullable().optional(),
  hours: optionalNum,
  km: optionalNum,
  workshop: optionalText,
  faultDescription: z.string().trim().min(1, "وصف العطل مطلوب"),
  actionTaken: optionalText,
  itemName: z.string().trim().min(1, "اسم القطعة مطلوب"),
  partModel: optionalText,
  itemCode: optionalText,
  technicalCode: optionalText,
  quantity: z.coerce.number().int().min(1).nullable().optional(),
  unit: optionalText,
  itemCondition: z.enum(REPAIR_CONDITIONS).nullable().optional(),
  siteName: optionalText,
  requesterName: optionalText,
  sourceWarehouseId: optionalId,
  destinationWarehouseId: optionalId,
  technicianPhone: optionalText,
  imageUrl: optionalText,
  imageBase64: optionalText,
  estimatedCost: optionalNum,
  actualCost: optionalNum,
  notes: optionalText,
  parts: z.array(partSchema).max(30).default([]),
});

export const updateRepairOrderSchema = createRepairOrderSchema.partial();

export const statusSchema = z.object({
  status: z.enum(REPAIR_STATUSES),
  note: optionalText,
});

export const listRepairOrderQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(REPAIR_STATUSES).optional(),
  projectId: z.coerce.number().int().optional(),
  equipmentId: z.coerce.number().int().optional(),
  type: z.enum(["INTERNAL", "EXTERNAL"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
