import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("بريد إلكتروني غير صحيح"),
  password: z.string().min(4, "كلمة السر 4 أحرف على الأقل"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "كلمة السر الحالية مطلوبة"),
  newPassword: z.string().min(4, "كلمة السر الجديدة 4 أحرف على الأقل"),
});
