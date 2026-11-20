import { z } from "zod";

/** الأنواع الأربعة اللي بتظهر في مراجعة البيانات. */
export const REVIEW_ENTITIES = ["dailylog", "maintenance", "repairorder", "needrequest"] as const;
export type ReviewEntity = (typeof REVIEW_ENTITIES)[number];

export const listReviewQuerySchema = z.object({
  entity: z.enum(REVIEW_ENTITIES).optional(),
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]).optional(),
  submittedBy: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const createReviewSchema = z.object({
  entity: z.enum(REVIEW_ENTITIES),
  data: z.record(z.unknown()),
  /** معرف السجل الموجود فعلًا (أمر إصلاح / طلب احتياج) — يُستخدم لمنع الإرسال قبل الاعتماد. */
  recordId: z.coerce.number().int().positive().optional(),
  clientRequestId: z.string().trim().min(1).max(120).optional(),
  context: z
    .object({
      projectId: z.coerce.number().int().nullable().optional(),
      projectCode: z.string().trim().nullable().optional(),
      sectorId: z.coerce.number().int().nullable().optional(),
      projectName: z.string().trim().nullable().optional(),
      sectorName: z.string().trim().nullable().optional(),
      equipmentCode: z.string().trim().nullable().optional(),
      equipmentName: z.string().trim().nullable().optional(),
      contextSource: z.enum(["SNAPSHOT", "UNKNOWN"]).optional(),
      capturedAt: z.string().trim().optional(),
    })
    .optional(),
});

export const updateReviewSchema = z.object({
  data: z.record(z.unknown()).optional(),
});

export const rejectReviewSchema = z.object({
  reason: z.string().trim().min(1, "سبب الرفض مطلوب"),
});

/** اعتماد كل سجلات مجموعة (يوم · مستخدم · نوع · مشروع) في طلب واحد. */
export const bulkApproveReviewSchema = z.object({
  ids: z
    .array(z.coerce.number().int().positive())
    .min(1, "اختر سجلًا واحدًا على الأقل")
    .max(200, "لا يمكن اعتماد أكثر من 200 سجل في مرة واحدة"),
});
