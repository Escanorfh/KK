import { z } from "zod";

const optionalId = z.coerce.number().int().positive().nullable().optional();

export const listReviewQuerySchema = z.object({
  entity: z.enum(["dailylog", "maintenance"]).optional(),
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]).optional(),
  submittedBy: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export const createReviewSchema = z.object({
  entity: z.enum(["dailylog", "maintenance"]),
  data: z.record(z.unknown()),
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
