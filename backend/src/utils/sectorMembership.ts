import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "../config/prisma";
import { normalizeArabic } from "./managers";

/**
 * القاعدة الانتقالية الوحيدة لعضوية القطاع في مشروع:
 * - ربط ProjectSector نشط للمشروع، أو
 * - صفر صفوف ProjectSector (أي ربط حتى لو ملغي يمنع الرجوع للعمود القديم)
 *   مع Sector.projectId المطابق للمشروع.
 */
export interface SectorMembershipRow {
  projectId: number | null;
  projectSectors?: { projectId: number; active: boolean }[] | null;
}

/** التطبيع القانوني الوحيد لأسماء القطاعات — نفس دالة المدرين */
export function normalizeSectorName(value: string): string {
  return normalizeArabic(value);
}

export function hasSectorAssociations(sector: SectorMembershipRow): boolean {
  return (sector.projectSectors?.length ?? 0) > 0;
}

export function isSectorMemberOfProject(
  sector: SectorMembershipRow,
  projectId: number
): boolean {
  const links = sector.projectSectors ?? [];
  if (links.length > 0) {
    return links.some((link) => link.projectId === projectId && link.active);
  }
  return sector.projectId === projectId;
}

/** أول مشروع نشط مرتبط بالقطاع — لو مفيش روابط نشطة بيرجع null */
export function firstActiveProjectId(sector: SectorMembershipRow): number | null {
  const active = (sector.projectSectors ?? [])
    .filter((link) => link.active)
    .map((link) => link.projectId)
    .sort((a, b) => a - b);
  return active[0] ?? null;
}

/** شرط Prisma لقطاعات المشروع — مستخدم في القوائم والعدّ */
export function projectMembershipWhere(projectId: number): Prisma.SectorWhereInput {
  return {
    OR: [
      { projectSectors: { some: { projectId, active: true } } },
      { AND: [{ projectId }, { projectSectors: { none: {} } }] },
    ],
  };
}

/** شرط Prisma لرؤية القطاعات ضمن نطاق مشاريع المستخدم */
export function sectorScopeWhere(scope: number[]): Prisma.SectorWhereInput {
  return {
    OR: [
      { projectSectors: { some: { active: true, projectId: { in: scope } } } },
      { AND: [{ projectId: { in: scope } }, { projectSectors: { none: {} } }] },
    ],
  };
}

export type SectorMembershipClient = Pick<PrismaClient, "sector">;

/** عضوية قطاع محدد — تقرأ القطاع وروابطه مرة واحدة */
export async function isSectorInProject(
  sectorId: number,
  projectId: number,
  client: SectorMembershipClient = prisma
): Promise<boolean> {
  const sector = await client.sector.findUnique({
    where: { id: sectorId },
    select: {
      projectId: true,
      projectSectors: { select: { projectId: true, active: true } },
    },
  });
  if (!sector) return false;
  return isSectorMemberOfProject(sector, projectId);
}
