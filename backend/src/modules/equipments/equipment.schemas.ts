import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalInt = z.coerce.number().int().nullable().optional();
const trackingModeSchema = z.enum(["HOURS", "KM", "BOTH"], {
  errorMap: () => ({ message: "وضع التتبع يجب أن يكون HOURS أو KM أو BOTH" }),
});

export const createEquipmentSchema = z.object({
  code: z.string().trim().min(1, "كود المعدة مطلوب"),
  name: z.string().trim().min(1, "اسم المعدة مطلوب"),
  projectId: optionalInt,
  sectorId: optionalInt,
  categoryId: optionalInt,
  trackingMode: trackingModeSchema.optional(),
  trackingModeConfirmed: z.boolean().optional(),
});

export const updateEquipmentSchema = createEquipmentSchema.partial();

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "اسم الفئة مطلوب"),
  codePrefixes: z
    .array(z.string().trim().regex(/^[A-Za-z]+$/, "بادئة الكود يجب أن تكون حروفًا فقط"))
    .max(20)
    .default([]),
  defaultTrackingMode: trackingModeSchema.default("BOTH"),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createMeterResetSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح"),
    hours: z.coerce.number().min(0).nullable().optional(),
    km: z.coerce.number().min(0).nullable().optional(),
    notes: optionalText,
  })
  .refine((v) => v.hours != null || v.km != null, {
    message: "أدخل قراءة الساعات أو الكيلومترات بعد التصفير",
  });

export const lookupQuerySchema = z.object({
  code: z.string().trim().min(1, "اكتب الكود أو اسم المعدة"),
});

export const listEquipmentQuerySchema = z.object({
  q: z.string().trim().optional(),
  projectId: optionalInt,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const lastMeterQuerySchema = z.object({
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح")
    .optional(),
});
