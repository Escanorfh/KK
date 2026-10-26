import { z } from "zod";

export const createSectorSchema = z.object({
  projectId: z.coerce.number().int().positive("اختر المشروع"),
  name: z.string().trim().min(2, "اسم القطاع مطلوب (حرفان على الأقل)"),
});

export const updateSectorSchema = z.object({
  name: z.string().trim().min(2, "اسم القطاع مطلوب (حرفان على الأقل)"),
});

export const listSectorsQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
});
