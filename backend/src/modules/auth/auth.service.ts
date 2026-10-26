import bcrypt from "bcryptjs";
import prisma from "../../config/prisma";
import { signToken } from "../../utils/jwt";

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    throw Object.assign(new Error("البريد أو كلمة السر غير صحيحة"), { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    throw Object.assign(new Error("البريد أو كلمة السر غير صحيحة"), { status: 401 });
  }

  const token = signToken({ id: user.id, role: user.role, name: user.name });

  const assignments = await prisma.userProject.findMany({
    where: { userId: user.id },
    select: { project: { select: { id: true, name: true } } },
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      projects: assignments.map((a) => a.project),
    },
  };
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      projects: { select: { project: { select: { id: true, name: true } } } },
    },
  });
  if (!user) {
    throw Object.assign(new Error("المستخدم غير موجود"), { status: 404 });
  }
  const { projects, ...rest } = user;
  return { ...rest, projects: projects.map((p) => p.project) };
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw Object.assign(new Error("المستخدم غير موجود"), { status: 404 });
  }

  const ok = await bcrypt.compare(currentPassword, user.password);
  if (!ok) {
    throw Object.assign(new Error("كلمة السر الحالية غير صحيحة"), { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { password: await bcrypt.hash(newPassword, 10) },
  });

  return { message: "تم تغيير كلمة السر" };
}
