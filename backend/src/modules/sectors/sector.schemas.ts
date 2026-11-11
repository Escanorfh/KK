import { z } from "zod";

const projectIdSchema = z.coerce.number().int().positive("اختر المشروع");

export const createSectorSchema = z
  .object({
    name: z.string().trim().min(2, "اسم القطاع مطلوب (حرفان على الأقل)"),
    /** التوافق القديم: مشروع واحد. */
    projectId: projectIdSchema.optional(),
    /** الشكل الجديد: قطاع واحد مرتبط بأكتر من مشروع. */
    projectIds: z.array(projectIdSchema).min(1, "اختر مشروعًا واحدًا على الأقل").optional(),
  })
  .refine((value) => value.projectId !== undefined || (value.projectIds?.length ?? 0) > 0, {
    message: "اختر المشروع",
    path: ["projectId"],
  });

export const updateSectorSchema = z.object({
  name: z.string().trim().min(2, "اسم القطاع مطلوب (حرفان على الأقل)"),
});

export const listSectorsQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
});

export const linkManagersRoomSchema = z.object({
  managersRoomId: z.coerce.number().int().positive("اختر قطاع نظام المدرين").nullable(),
});

export const managersRoomsQuerySchema = z.object({
  projectId: z.coerce.number().int().positive("اختر المشروع"),
});

export const associateSectorProjectSchema = z.object({
  projectId: projectIdSchema,
});
