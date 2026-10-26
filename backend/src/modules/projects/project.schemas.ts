import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const createProjectSchema = z.object({
  code: optionalText,
  name: z.string().trim().min(2, "اسم المشروع مطلوب (حرفان على الأقل)"),
  description: optionalText,
});

export const updateProjectSchema = createProjectSchema.partial();

export const listProjectsQuerySchema = z.object({
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
