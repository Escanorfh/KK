import { z } from "zod";

const assignableRole = z.enum(["ADMIN", "MANAGER", "USER"]);
const projectIds = z.array(z.number().int().positive()).default([]);

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "الاسم قصير جدًا"),
  email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صحيح"),
  password: z.string().min(4, "كلمة السر 4 أحرف على الأقل"),
  role: assignableRole.default("USER"),
  projectIds,
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2, "الاسم قصير جدًا").optional(),
    email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صحيح").optional(),
    role: assignableRole.optional(),
    active: z.boolean().optional(),
    password: z.string().min(4, "كلمة السر 4 أحرف على الأقل").optional(),
    projectIds: z.array(z.number().int().positive()).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "لا يوجد بيانات للتعديل",
  });

export const listUsersQuerySchema = z.object({
  q: z.string().trim().optional(),
});
