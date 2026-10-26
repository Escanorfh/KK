import type { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";

interface ListParams {
  q?: string;
  page: number;
  pageSize: number;
  scope?: number[] | null;
}

export async function list({ q, page, pageSize, scope }: ListParams) {
  const where: Prisma.ProjectWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { code: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  if (scope) {
    where.AND = [{ id: { in: scope } }];
  }

  const [data, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { equipment: true, sectors: true } } },
    }),
    prisma.project.count({ where }),
  ]);

  return { data, total, page, pageSize };
}

export async function options(scope?: number[] | null) {
  return prisma.project.findMany({
    where: scope ? { id: { in: scope } } : {},
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function create(
  data: { code: string | null; name: string; description: string | null },
  userId: number
) {
  if (data.code) {
    const exists = await prisma.project.findUnique({ where: { code: data.code } });
    if (exists) {
      throw Object.assign(new Error("كود المشروع مستخدم من قبل"), { status: 409 });
    }
  }

  const project = await prisma.project.create({ data });
  await logAudit(userId, "Project", project.id, "CREATE", { name: project.name });
  return project;
}

export async function update(
  id: number,
  data: Partial<{ code: string | null; name: string; description: string | null }>,
  userId: number
) {
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) {
    throw Object.assign(new Error("المشروع غير موجود"), { status: 404 });
  }

  if (data.code && data.code !== existing.code) {
    const duplicate = await prisma.project.findUnique({ where: { code: data.code } });
    if (duplicate) {
      throw Object.assign(new Error("كود المشروع مستخدم من قبل"), { status: 409 });
    }
  }

  const project = await prisma.project.update({ where: { id }, data });
  await logAudit(userId, "Project", id, "UPDATE", data);
  return project;
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.project.findUnique({
    where: { id },
    include: { _count: { select: { equipment: true } } },
  });
  if (!existing) {
    throw Object.assign(new Error("المشروع غير موجود"), { status: 404 });
  }
  if (existing._count.equipment > 0) {
    throw Object.assign(
      new Error("لا يمكن حذف مشروع به معدات — احذف أو انقل المعدات أولًا"),
      { status: 409 }
    );
  }

  await prisma.project.delete({ where: { id } });
  await logAudit(userId, "Project", id, "DELETE", { name: existing.name });
  return { message: "تم حذف المشروع" };
}
