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
