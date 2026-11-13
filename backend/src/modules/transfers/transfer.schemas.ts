import { z } from "zod";

const optionalText = z.string().trim().transform((v) => (v === "" ? null : v)).nullable().optional();

export const createTransferSchema = z.object({
  equipmentId: z.coerce.number().int().positive("اختر المعدة"),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح"),
  reason: optionalText,
  notes: optionalText,
});

export const approveTransferSchema = z.object({
  toProjectId: z.coerce.number().int().positive("اختر المشروع المستهدف"),
  toSectorId: z.coerce.number().int().positive().nullable().optional(),
});

export const listTransferQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]).optional(),
  projectId: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const rejectTransferSchema = z.object({
  reason: z.string().trim().min(1, "سبب الرفض مطلوب"),
});
