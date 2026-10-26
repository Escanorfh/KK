import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح (YYYY-MM-DD)");
const optionalNum = z.coerce.number().min(0).nullable().optional();
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const NEED_STATUSES = ["DRAFT", "SENT", "FAILED"] as const;

const itemSchema = z.object({
  itemName: z.string().trim().min(1, "اسم الصنف/الطراز مطلوب"),
  itemCode: optionalText,
  unit: optionalText,
  qty: z.coerce.number().min(0, "الكمية المطلوبة غير صحيحة").nullable().optional(),
  equipmentRef: optionalText,
  currentBalance: optionalNum,
  localSupply: optionalNum,
  foreignSupply: optionalNum,
  notes: optionalText,
});

export const createNeedRequestSchema = z.object({
  projectId: z.coerce.number().int().positive("اختر المشروع").nullable().optional(),
  department: z.string().trim().min(1, "الجهة الطالبة مطلوبة"),
  requestDate: dateStr,
  items: z.array(itemSchema).min(1, "أضف صنفًا واحدًا على الأقل").max(50),
});

export const updateNeedRequestSchema = z.object({
  projectId: z.coerce.number().int().positive("اختر المشروع").nullable().optional(),
  department: z.string().trim().min(1, "الجهة الطالبة مطلوبة").optional(),
  requestDate: dateStr.optional(),
  items: z.array(itemSchema).min(1, "أضف صنفًا واحدًا على الأقل").max(50).optional(),
});

export const listNeedRequestQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(NEED_STATUSES).optional(),
  projectId: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
