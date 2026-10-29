import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const OIL_TYPE_VALUES = ["ENGINE", "HYDRAULIC", "STEERING", "GEARBOX", "OTHER"] as const;
export const OIL_SOURCE_VALUES = ["MANUAL", "MAINTENANCE"] as const;

export const createOilConsumptionSchema = z.object({
  date: z.string().trim().min(1, "التاريخ مطلوب"),
  equipmentId: z.coerce.number().int().positive("اختر المعدة"),
  oilType: z.enum(OIL_TYPE_VALUES, { errorMap: () => ({ message: "اختر نوع الزيت" }) }),
  oilName: optionalText,
  liters: z.coerce.number().positive("الكمية لازم تكون أكبر من صفر"),
  pricePerLiter: z.coerce.number().min(0, "السعر لا يكون سالبًا").nullable().optional(),
  notes: optionalText,
});

export const updateOilConsumptionSchema = createOilConsumptionSchema.partial();

export const listOilConsumptionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  projectId: z.coerce.number().int().positive().optional(),
  equipmentId: z.coerce.number().int().positive().optional(),
  oilType: z.enum(OIL_TYPE_VALUES).optional(),
  source: z.enum(OIL_SOURCE_VALUES).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  q: z.string().trim().optional(),
});

export const oilConsumptionSummaryQuerySchema = listOilConsumptionQuerySchema.omit({
  page: true,
  pageSize: true,
  q: true,
});
