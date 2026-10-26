import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";

const projectsSelect = {
  select: { project: { select: { id: true, name: true, code: true } } },
} as const;

const publicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
} as const;

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

async function validateProjects(role: Role, projectIds: number[]): Promise<number[]> {
  const unique = [...new Set(projectIds)];
  if (role === "ROOT" || role === "ADMIN") return [];

  if (unique.length) {
    const found = await prisma.project.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      fail("أحد المشاريع المحددة غير موجود", 400);
    }
  }

  if (role === "USER") {
    if (unique.length !== 1) {
      fail("يجب تحديد مشروع واحد بالضبط لدور المستخدم", 400);
    }
    return unique;
  }
  if (unique.length < 1) {
    fail("حدد مشروعًا واحدًا على الأقل لمدير المتابعة", 400);
  }
  return unique;
}

export async function list(q?: string) {
  return prisma.user.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: {
      ...publicSelect,
      projects: projectsSelect,
      _count: { select: { dailyLogs: true, maintenance: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function create(
  input: {
    name: string;
    email: string;
    password: string;
    role: "ADMIN" | "MANAGER" | "USER";
    projectIds?: number[];
  },
  actorId: number
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    fail("البريد الإلكتروني مستخدم بالفعل", 409);
  }

  const assignments = await validateProjects(input.role, input.projectIds ?? []);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: await bcrypt.hash(input.password, 10),
      role: input.role,
      ...(assignments.length
        ? { projects: { create: assignments.map((projectId) => ({ projectId })) } }
        : {}),
    },
    select: { ...publicSelect, projects: projectsSelect },
  });

  await logAudit(actorId, "User", user.id, "CREATE", {
    email: user.email,
    role: user.role,
    projects: assignments,
  });
  return user;
}

export async function update(
  id: number,
  input: {
    name?: string;
    email?: string;
    role?: "ADMIN" | "MANAGER" | "USER";
    active?: boolean;
    password?: string;
    projectIds?: number[];
  },
  actorId: number
) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    fail("المستخدم غير موجود", 404);
  }

  if (id === actorId) {
    if (input.role !== undefined) {
      fail("لا يمكنك تغيير دور حسابك الحالي", 400);
    }
    if (input.active === false) {
      fail("لا يمكنك تعطيل حسابك الحالي", 400);
    }
  }

  if (input.email && input.email !== existing.email) {
    const taken = await prisma.user.findUnique({ where: { email: input.email } });
    if (taken) {
      fail("البريد الإلكتروني مستخدم بالفعل", 409);
    }
  }

  const finalRole: Role = input.role ?? existing.role;
  let assignments: number[] | null = null;
  if (input.projectIds !== undefined) {
    assignments = await validateProjects(finalRole, input.projectIds);
  } else if (input.role !== undefined && input.role !== existing.role) {
    const current = await prisma.userProject.findMany({
      where: { userId: id },
      select: { projectId: true },
    });
    assignments = await validateProjects(finalRole, current.map((p) => p.projectId));
  }

  const hashed = input.password !== undefined ? await bcrypt.hash(input.password, 10) : undefined;

  const user = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(hashed ? { password: hashed } : {}),
        },
        select: { ...publicSelect, projects: projectsSelect },
      });

      if (assignments !== null) {
        await tx.userProject.deleteMany({ where: { userId: id } });
        if (assignments.length) {
          await tx.userProject.createMany({
            data: assignments.map((projectId) => ({ userId: id, projectId })),
          });
        }
        return tx.user.findUniqueOrThrow({
          where: { id },
          select: { ...publicSelect, projects: projectsSelect },
        });
      }

      return updated;
    },
    { timeout: 15000, maxWait: 10000 }
  );

  await logAudit(actorId, "User", id, "UPDATE", {
    ...input,
    password: undefined,
    ...(assignments !== null ? { projects: assignments } : {}),
  });
  return user;
}

export async function remove(id: number, actorId: number) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    fail("المستخدم غير موجود", 404);
  }
  if (id === actorId) {
    fail("لا يمكنك حذف حسابك الحالي", 400);
  }

  await prisma.user.delete({ where: { id } });
  await logAudit(actorId, "User", id, "DELETE", {
    email: existing.email,
    role: existing.role,
  });
  return { message: "تم حذف المستخدم" };
}
