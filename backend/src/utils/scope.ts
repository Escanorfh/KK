import type { Role } from "@prisma/client";
import prisma from "../config/prisma";

export async function scopeProjectIds(user: {
  id: number;
  role: Role;
}): Promise<number[] | null> {
  if (user.role === "ROOT" || user.role === "ADMIN") return null;
  const rows = await prisma.userProject.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

type ProjectFilter = { projectId: { in: number[] } } | { projectId: null };

// السجلات بلا إسناد مشروع ملك المستخدم في الميدان عمليًا، فاستبعادها يخلي شاشته ناقصة
/** null = بلا تضييق (أدمن/root). الأعمدة اللي projectId إلزامي فيها (Sector/Project) تفضل `in: scope` بس. */
export function scopeOr(scope?: number[] | null): ProjectFilter[] | null {
  if (!scope) return null;
  return [{ projectId: { in: scope } }, { projectId: null }];
}
