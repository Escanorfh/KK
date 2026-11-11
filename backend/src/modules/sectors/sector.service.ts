import type { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { lastDayEquipmentCounts } from "../../utils/lastDayEquipment";
import { normalizeArabic, resolveManagersProject, type ManagersRoom } from "../../utils/managers";
import { mapPrismaError } from "../../utils/prismaError";
import {
  normalizeSectorName,
  projectMembershipWhere,
  sectorScopeWhere,
} from "../../utils/sectorMembership";

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

const PROJECT_REF = { id: true, code: true, name: true } as const;

/** بيرجّع القطاع مع المشاريع المرتبطة بيه بس في نطاق المستخدم — من غير كشف باقي المشاريع. */
async function attachProjects<T extends { id: number }>(sector: T, scope?: number[] | null) {
  const projects = await prisma.projectSector.findMany({
    where: {
      sectorId: sector.id,
      active: true,
      ...(scope ? { projectId: { in: scope } } : {}),
    },
    orderBy: { projectId: "asc" },
    select: { id: true, projectId: true, active: true, project: { select: PROJECT_REF } },
  });
  return { ...sector, projects };
}

export async function list(projectId?: number, scope?: number[] | null) {
  if (projectId && scope && !scope.includes(projectId)) return [];

  const and: Prisma.SectorWhereInput[] = [];
  if (projectId) and.push(projectMembershipWhere(projectId));
  if (scope) and.push(sectorScopeWhere(scope));

  const [rows, lastDay] = await Promise.all([
    prisma.sector.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ projectId: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { equipment: true } },
        project: { select: { id: true, name: true } },
        projectSectors: {
          where: { active: true, ...(scope ? { projectId: { in: scope } } : {}) },
          orderBy: { projectId: "asc" },
          select: { id: true, projectId: true, active: true, project: { select: PROJECT_REF } },
        },
      },
    }),
    lastDayEquipmentCounts(),
  ]);

  // عدّاد المعدات من شيت الـ day (آخر يوم) — لأن المعدات بتتنقل، ولو مفيش سجل يومي خالص نرجع للإسناد الحالي
  return rows.map((row) => {
    const { projectSectors, project, ...sector } = row;
    // العمود القديم بيبقى أصل تاريخي؛ مانعرضوش لو بره نطاق المستخدم
    const legacyProject = scope && sector.projectId != null && !scope.includes(sector.projectId) ? null : project;
    return {
      ...sector,
      project: legacyProject,
      projects: projectSectors,
      activeEquipment: lastDay.lastLogDate ? (lastDay.bySector.get(sector.id) ?? 0) : row._count.equipment,
    };
  });
}

function uniqueProjectIds(data: { projectId?: number; projectIds?: number[] }): number[] {
  return Array.from(
    new Set([...(data.projectIds ?? []), ...(data.projectId != null ? [data.projectId] : [])])
  );
}

/**
 * يضمن وجود قطاع بالاسم داخل المشروع مع ربط ProjectSector، ويرجّع معرّف القطاع.
 * - ربط نشط بنفس الاسم المطبع → نفس القطاع.
 * - ربط ملغي بنفس الاسم → إعادة تفعيله (الاسم مش مملوك لقطاع تاني في المشروع).
 * - قطاع موجود بنفس الاسم (حتى لو أصله القديم مشروع تاني) → إعادة استخدامه بلا نسخة جديدة.
 * - غير كده → إنشاء Sector جديد مع عمود الأصل القديم.
 * لا يعيد كتابة `Sector.projectId` لأي قطاع موجود، ويعمل داخل transaction العميل لو اتبعت.
 */
export async function ensureSectorLink(
  projectId: number,
  name: string,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const db = tx ?? prisma;
  const clean = name.trim();
  const normalizedName = normalizeSectorName(clean);
  if (!clean || !normalizedName) fail("اسم القطاع مطلوب", 400);

  const nameLinks = await db.projectSector.findMany({
    where: { projectId, normalizedName },
    orderBy: { id: "asc" },
    select: { id: true, sectorId: true, active: true },
  });
  const activeLink = nameLinks.find((link) => link.active);
  if (activeLink) return activeLink.sectorId;
  if (nameLinks.length > 0) {
    // ربط ملغي لنفس الاسم: إعادة التفعيل مقصودة، ومفيش قطاع آخر يملك الاسم ده في المشروع
    const link = nameLinks[0];
    await db.projectSector.update({
      where: { id: link.id },
      data: { active: true, normalizedName },
    });
    return link.sectorId;
  }

  const candidates = await db.sector.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, projectId: true },
  });
  const exact = candidates.filter((sector) => sector.name === clean);
  const pool = exact.length
    ? exact
    : candidates.filter((sector) => normalizeSectorName(sector.name) === normalizedName);
  // نفضّل قطاعًا أصله من نفس المشروع، وإلا الأقدم معرّفًا — عشان نعيد استخدام ID موجود
  pool.sort((a, b) => {
    const aSame = a.projectId === projectId ? 0 : 1;
    const bSame = b.projectId === projectId ? 0 : 1;
    return aSame - bSame || a.id - b.id;
  });

  for (const candidate of pool) {
    const pair = await db.projectSector.findUnique({
      where: { projectId_sectorId: { projectId, sectorId: candidate.id } },
      select: { id: true, active: true },
    });
    if (pair) {
      // القطاع موجود في المشروع بالفعل — نزامن اسم الربط المطبع مع اسمه الحالي بدل إنشاء نسخة
      await db.projectSector.update({
        where: { id: pair.id },
        data: { active: true, normalizedName },
      });
      return candidate.id;
    }
    await db.projectSector.create({
      data: { projectId, sectorId: candidate.id, normalizedName, active: true },
    });
    return candidate.id;
  }

  const made = await db.sector.create({
    data: { name: clean, projectId },
    select: { id: true },
  });
  await db.projectSector.create({
    data: { projectId, sectorId: made.id, normalizedName, active: true },
  });
  return made.id;
}

/**
 * إنشاء قطاع وربطه بمشروع واحد أو أكثر.
 * لو فيه قطاع بنفس الاسم موجود بالفعل، بيتعاد استخدامه بنفس المعرّف بدل عمل نسخة جديدة.
 * كل الكتابات المتعلقة بالربط بتتم في معاملة واحدة.
 */
export async function create(
  data: { projectId?: number; projectIds?: number[]; name: string },
  userId: number,
  scope?: number[] | null
) {
  const name = data.name.trim();
  if (!name) fail("اسم القطاع مطلوب", 400);
  const normalizedName = normalizeSectorName(name);
  if (!normalizedName) fail("اسم القطاع غير صالح", 400);

  const projectIds = uniqueProjectIds(data);
  if (!projectIds.length) fail("اختر مشروعًا واحدًا على الأقل", 400);

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true },
  });
  if (projects.length !== projectIds.length) fail("المشروع غير موجود", 404);

  if (scope) {
    const allowed = new Set(scope);
    if (projectIds.some((id) => !allowed.has(id))) {
      fail("غير مصرح بربط القطاع بمشروع خارج نطاق صلاحيتك", 403);
    }
  }

  // إعادة استخدام قطاع موجود بنفس الاسم بدل تكرار سجل القطاع (مع تفضيل قطاع أصله في أحد المشاريع المطلوبة)
  const sameName = await prisma.sector.findMany({
    where: { name },
    select: { id: true, projectId: true },
    orderBy: { id: "asc" },
  });
  const reusable =
    sameName.find((s) => s.projectId != null && projectIds.includes(s.projectId)) ?? sameName[0] ?? null;

  const collisions = await prisma.projectSector.findMany({
    where: { projectId: { in: projectIds }, normalizedName },
    select: { id: true, projectId: true, sectorId: true, active: true },
  });
  const collisionByProject = new Map(collisions.map((row) => [row.projectId, row]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const toCreate: number[] = [];
  const toReactivate: number[] = [];
  for (const projectId of projectIds) {
    const hit = collisionByProject.get(projectId);
    if (!hit) {
      toCreate.push(projectId);
      continue;
    }
    if (reusable && hit.sectorId === reusable.id && !hit.active) {
      toReactivate.push(hit.id);
      continue;
    }
    fail(
      `القطاع «${name}» موجود بالفعل في المشروع «${projectName.get(projectId) ?? projectId}»`,
      409
    );
  }

  const sectorId = await prisma.$transaction(async (tx) => {
    let targetId = reusable?.id;
    if (targetId == null) {
      const made = await tx.sector.create({
        data: { name, projectId: projectIds[0] },
        select: { id: true },
      });
      targetId = made.id;
    }
    for (const projectId of toCreate) {
      await tx.projectSector.create({
        data: { projectId, sectorId: targetId, normalizedName, active: true },
      });
    }
    for (const linkId of toReactivate) {
      await tx.projectSector.update({
        where: { id: linkId },
        data: { active: true, normalizedName },
      });
    }
    return targetId;
  });

  const sector = await prisma.sector.findUnique({ where: { id: sectorId } });
  await logAudit(userId, "Sector", sectorId, "CREATE", {
    name,
    projectIds,
    reusedSector: reusable != null,
  });
  return attachProjects(sector!, scope);
}

export async function update(id: number, name: string, userId: number, scope?: number[] | null) {
  const existing = await prisma.sector.findUnique({
    where: { id },
    select: { id: true, name: true, projectId: true },
  });
  if (!existing) fail("القطاع غير موجود", 404);

  const clean = name.trim();
  if (!clean) fail("اسم القطاع مطلوب", 400);
  const normalizedName = normalizeSectorName(clean);
  if (!normalizedName) fail("اسم القطاع غير صالح", 400);

  const links = await prisma.projectSector.findMany({
    where: { sectorId: id },
    select: { id: true, projectId: true, active: true },
  });

  // الاسم مشترك بين كل المشاريع المرتبطة (حتى الملغاة، لأن صف الربط محفوظ)،
  // فأي تعديل لازم يكون مصرّح بيه في كل المشاريع دي
  const related = new Set<number>(links.map((l) => l.projectId));
  if (existing.projectId != null) related.add(existing.projectId);
  const relatedIds = Array.from(related);

  if (scope) {
    const allowed = new Set(scope);
    if (relatedIds.some((projectId) => !allowed.has(projectId))) {
      fail("غير مصرح بتعديل قطاع مرتبط بمشروع خارج نطاق صلاحيتك", 403);
    }
  }

  if (relatedIds.length) {
    const clash = await prisma.projectSector.findMany({
      where: {
        projectId: { in: relatedIds },
        normalizedName,
        sectorId: { not: id },
      },
      select: { projectId: true },
    });
    if (clash.length) {
      fail("يوجد قطاع آخر بنفس الاسم في أحد المشاريع المرتبطة", 409);
    }
  }

  if (existing.projectId != null) {
    const legacyDup = await prisma.sector.findFirst({
      where: { projectId: existing.projectId, name: clean, id: { not: id } },
      select: { id: true },
    });
    if (legacyDup) fail("القطاع موجود في المشروع ده من قبل", 409);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const sector = await tx.sector.update({ where: { id }, data: { name: clean } });
    if (links.length) {
      await tx.projectSector.updateMany({ where: { sectorId: id }, data: { normalizedName } });
    }
    return sector;
  });

  await logAudit(userId, "Sector", id, "UPDATE", { name: clean });
  return attachProjects(updated, scope);
}

/** ربط قطاع موجود بمشروع إضافي — من غير إنشاء قطاع جديد أو لمس تاريخه. */
export async function associateToProject(
  sectorId: number,
  projectId: number,
  userId: number,
  scope?: number[] | null
) {
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true, name: true, projectId: true },
  });
  if (!sector) fail("القطاع غير موجود", 404);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) fail("المشروع غير موجود", 404);

  if (scope && !scope.includes(projectId)) {
    fail("غير مصرح بربط القطاع بمشروع خارج نطاق صلاحيتك", 403);
  }

  const normalizedName = normalizeSectorName(sector.name);
  if (!normalizedName) fail("اسم القطاع غير صالح", 400);

  const existing = await prisma.projectSector.findUnique({
    where: { projectId_sectorId: { projectId, sectorId } },
    select: { id: true, active: true },
  });
  if (existing?.active) {
    fail("القطاع مرتبط بالمشروع ده من قبل", 409);
  }

  const nameTaken = await prisma.projectSector.findUnique({
    where: { projectId_normalizedName: { projectId, normalizedName } },
    select: { id: true, sectorId: true },
  });
  if (nameTaken && nameTaken.sectorId !== sectorId) {
    fail(`يوجد قطاع آخر بنفس الاسم في المشروع «${project.name}»`, 409);
  }

  const link = await prisma.$transaction(async (tx) => {
    if (existing) {
      return tx.projectSector.update({
        where: { id: existing.id },
        data: { active: true, normalizedName },
      });
    }
    return tx.projectSector.create({
      data: { projectId, sectorId, normalizedName, active: true },
    });
  });

  await logAudit(userId, "Sector", sectorId, "UPDATE", {
    associatedProjectId: projectId,
    associationId: link.id,
  });

  // من غير كشف العمود القديم (أصل تاريخي) لو بره نطاق المستخدم
  return { ...link, sector: { id: sector.id, name: sector.name }, project };
}

/** المشاريع المرتبطة بقطاع — مقصورة على نطاق المستخدم. */
export async function listSectorProjects(sectorId: number, scope?: number[] | null) {
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true, name: true, projectId: true },
  });
  if (!sector) fail("القطاع غير موجود", 404);

  const all = await prisma.projectSector.findMany({
    where: { sectorId },
    orderBy: { projectId: "asc" },
    select: {
      id: true,
      projectId: true,
      active: true,
      project: { select: PROJECT_REF },
    },
  });

  const visible = all.filter(
    (row) => row.active && (!scope || scope.includes(row.projectId))
  );
  if (visible.length) return visible;

  // توافق انتقالي: قطاع قديم ملهوش أي صف ربط خالص — نعرض مشروعه القديم لو في النطاق
  if (all.length === 0 && sector.projectId != null && (!scope || scope.includes(sector.projectId))) {
    const project = await prisma.project.findUnique({
      where: { id: sector.projectId },
      select: PROJECT_REF,
    });
    if (project) return [{ id: null, projectId: project.id, active: true, project, legacy: true }];
  }

  return [];
}

/** قطاعات مشروع — بنفس قواعد وقائمة `list` لضمان توافق الشاشات القديمة. */
export async function listProjectSectors(projectId: number, scope?: number[] | null) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) fail("المشروع غير موجود", 404);
  if (scope && !scope.includes(projectId)) {
    fail("غير مصرح بالوصول لهذا المشروع", 403);
  }
  return list(projectId, scope);
}

/**
 * إلغاء ربط القطاع بمشروع: soft-delete على صف الربط فقط.
 * القطاع نفسه وسجلات التشغيل والتاريخ (DailyLog/Maintenance/RepairOrder/NeedRequest/Fault) ما بتتلمسش.
 */
export async function removeFromProject(
  sectorId: number,
  projectId: number,
  userId: number,
  scope?: number[] | null
) {
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true, name: true },
  });
  if (!sector) fail("القطاع غير موجود", 404);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) fail("المشروع غير موجود", 404);

  if (scope && !scope.includes(projectId)) {
    fail("غير مصرح بإلغاء ربط القطاع بمشروع خارج نطاق صلاحيتك", 403);
  }

  const link = await prisma.projectSector.findUnique({
    where: { projectId_sectorId: { projectId, sectorId } },
    select: { id: true, active: true },
  });
  if (!link || !link.active) fail("القطاع غير مرتبط بهذا المشروع", 404);

  await prisma.projectSector.update({ where: { id: link.id }, data: { active: false } });

  // ملاحظة: Sector.projectId (العمود القديم) ما بيتغيرش — أصل تاريخي مش علاقة حالية
  await logAudit(userId, "Sector", sectorId, "UPDATE", {
    removedProjectId: projectId,
    associationId: link.id,
  });

  return {
    message: "تم إلغاء ربط القطاع بالمشروع",
    sectorId,
    projectId,
    associationId: link.id,
    active: false,
  };
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.sector.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          projectSectors: true,
          equipment: true,
          dailyLogs: true,
          maintenance: true,
          faults: true,
          needRequests: true,
          repairOrders: true,
        },
      },
    },
  });
  if (!existing) {
    throw Object.assign(new Error("القطاع غير موجود"), { status: 404 });
  }

  const counts = existing._count;
  const references =
    counts.projectSectors +
    counts.equipment +
    counts.dailyLogs +
    counts.maintenance +
    counts.faults +
    counts.needRequests +
    counts.repairOrders;
  if (references > 0) {
    throw Object.assign(
      new Error(
        "لا يمكن حذف القطاع لأنه مرتبط بمشاريع أو بسجلات تشغيلية/تاريخية — افصل الارتباطات أولًا بدل حذف السجل"
      ),
      { status: 409 }
    );
  }

  try {
    await prisma.sector.delete({ where: { id } });
  } catch (err) {
    // سباق حذف/ربط بين الفحص والحذف: P2003 معناه إن مرجعًا ظهر في اللحظة الأخيرة
    const mapped = mapPrismaError(err);
    if (mapped) throw Object.assign(new Error(mapped.message), { status: mapped.status });
    throw err;
  }
  await logAudit(userId, "Sector", id, "DELETE", { name: existing.name });
  return { message: "تم حذف القطاع" };
}

// القطاعات المصرّح بها للتوكن عند المدرين للمشروع المحلي — للمراجعة البشرية قبل الربط
export async function managersRooms(projectId: number, scope?: number[] | null) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) fail("المشروع غير موجود", 404);
  if (scope && !scope.includes(projectId)) {
    fail("غير مصرح بالوصول لهذا المشروع", 403);
  }

  let remoteProject: { id: number; title: string; code: string | null } | null = null;
  let rooms: ManagersRoom[] = [];
  let warning: string | null = null;

  try {
    const matched = await resolveManagersProject({ name: project.name, code: project.code });
    remoteProject = { id: matched.id, title: matched.title, code: matched.code };
    rooms = matched.rooms;
    if (!rooms.length) {
      warning = `المشروع «${matched.title}» مربوط، لكن التوكن الحالي لا يملك أي قطاع مصرّح به فيه`;
    }
  } catch (err) {
    warning = err instanceof Error ? err.message : String(err);
  }

  return { project, remoteProject, rooms, warning };
}

// الربط يدوي ومراجع: معرّف قطاع المدرين وبيتهخزّن من القائمة المصرّح بها، مش من تشابه الأسماء
export async function linkManagersRoom(id: number, managersRoomId: number | null, userId: number) {
  const sector = await prisma.sector.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      projectId: true,
      project: { select: { name: true } },
      projectSectors: {
        orderBy: { projectId: "asc" },
        select: {
          id: true,
          projectId: true,
          active: true,
          project: { select: { name: true } },
        },
      },
    },
  });
  if (!sector) fail("القطاع غير موجود", 404);

  if (managersRoomId === null) {
    const cleared = await prisma.sector.update({
      where: { id },
      data: { managersRoomId: null, managersRoomTitle: null },
    });
    await logAudit(userId, "Sector", id, "UPDATE", { name: sector.name, unlinked: true });
    return cleared;
  }

  // المشروع بيتحدد من الربط النشط أولًا؛ العمود القديم بديل فقط لما مفيش أي صف ربط خالص.
  // وجود ربط ملغي يمنع الرجوع للعمود القديم (نفس القاعدة الانتقالية).
  let projectId: number | null = null;
  let projectName = "";
  const links = sector.projectSectors ?? [];
  if (links.length > 0) {
    const active = links.find((link) => link.active);
    if (!active) {
      fail("القطاع غير مرتبط بأي مشروع نشط — أعد ربطه بمشروع أولًا", 422);
    }
    projectId = active.projectId;
    projectName = active.project?.name ?? "";
  } else if (sector.projectId != null) {
    projectId = sector.projectId;
    projectName = sector.project?.name ?? "";
  } else {
    fail("القطاع غير مربوط بمشروع — cannot link managers room without project", 422);
  }

  const { rooms } = await managersRooms(projectId);
  const room = rooms.find((item) => item.id === managersRoomId);
  if (!room) {
    fail(
      `قطاع نظام المدرين بمعرّف ${managersRoomId} ليس ضمن القطاعات المصرّح بها لمشروع «${projectName}»`,
      422
    );
  }

  const updated = await prisma.sector.update({
    where: { id },
    data: { managersRoomId: room!.id, managersRoomTitle: room!.title },
  });
  await logAudit(userId, "Sector", id, "UPDATE", {
    name: sector.name,
    managersRoomId: room!.id,
    managersRoomTitle: room!.title,
  });
  return updated;
}

export interface SectorSyncResult {
  created: number;
  linked: number;
  unchanged: number;
  skipped: { roomTitle: string; reason: string }[];
  stale: { id: number; name: string; managersRoomId: number }[];
}

function sectorKey(name: string): string {
  return normalizeArabic(name).replace(/\s+/g, "");
}

type SyncSector = {
  id: number;
  name: string;
  managersRoomId: number | null;
  managersRoomTitle: string | null;
};

/**
 * مزامنة قطاعات مشروع مع الغرف المصرّح بها عنده عند المدرين (rooms[] من /requisitions/projects):
 * المطابقة بمعرّف الغرفة أولًا، وبعدين بالاسم الحرفي داخل نفس المشروع — التشابه التقريبي ما كانش يومًا مصدر ربط.
 * مافيش حذف ولا إعادة تسمية لقطاع موجود؛ الغرفة اللي ملهاش قطاع بتتعمل جديدة وهي مربوطة،
 * والقطاع المربوط بغرفة اتسحبت من التصريح بيفضل زي ما هو وبيتبلّغ عنه للمراجعة.
 *
 * القطاعات بتتقرأ من روابط ProjectSector الخاصة بالمشروع (نشطة أو ملغية) + القطاعات القديمة
 * اللي ملهاش أي صف ربط خالص — عشان القطاع المشترك مع مشروع تاني يفضل قابل للاكتشاف.
 */
export async function syncSectorsForProject(
  projectId: number,
  rooms: ManagersRoom[]
): Promise<SectorSyncResult> {
  const result: SectorSyncResult = { created: 0, linked: 0, unchanged: 0, skipped: [], stale: [] };

  const linkRows = await prisma.projectSector.findMany({
    where: { projectId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      sectorId: true,
      active: true,
      sector: {
        select: { id: true, name: true, managersRoomId: true, managersRoomTitle: true },
      },
    },
  });
  const linkBySectorId = new Map(linkRows.map((link) => [link.sectorId, link]));

  const legacy = await prisma.sector.findMany({
    where: { projectId, projectSectors: { none: {} } },
    select: { id: true, name: true, managersRoomId: true, managersRoomTitle: true },
  });

  const existing: SyncSector[] = [
    ...linkRows.map((link) => link.sector),
    ...legacy,
  ];
  const knownIds = new Set(existing.map((sector) => sector.id));

  const byRoomId = new Map<number, SyncSector>();
  const byName = new Map<string, SyncSector>();
  for (const s of existing) {
    if (s.managersRoomId != null && !byRoomId.has(s.managersRoomId)) byRoomId.set(s.managersRoomId, s);
    const key = sectorKey(s.name);
    if (key && !byName.has(key)) byName.set(key, s);
  }

  for (const room of rooms) {
    const already = byRoomId.get(room.id);
    if (already) {
      const link = linkBySectorId.get(already.id);
      if (link && !link.active) {
        const owner = byName.get(sectorKey(already.name));
        if (owner && owner.id !== already.id) {
          result.skipped.push({
            roomTitle: room.title,
            reason: `اسم القطاع «${already.name}» مستخدم بواسطة قطاع آخر في المشروع`,
          });
          continue;
        }
        await prisma.projectSector.update({
          where: { id: link.id },
          data: { active: true, normalizedName: normalizeSectorName(already.name) },
        });
        link.active = true;
        result.linked++;
      } else {
        result.unchanged++;
      }
      if (already.managersRoomTitle !== room.title) {
        await prisma.sector.update({ where: { id: already.id }, data: { managersRoomTitle: room.title } });
        already.managersRoomTitle = room.title;
      }
      continue;
    }

    const sameName = byName.get(sectorKey(room.title));
    if (sameName) {
      if (sameName.managersRoomId != null && sameName.managersRoomId !== room.id) {
        // الاسم مشغول بقطاع مربوط بغرفة تانية — مراجعة بشرية بدل دمج قطاعين
        result.skipped.push({
          roomTitle: room.title,
          reason: `القطاع «${sameName.name}» مربوط بالفعل بغرفة أخرى (${sameName.managersRoomId})`,
        });
        continue;
      }

      const link = linkBySectorId.get(sameName.id);
      if (!link) {
        await prisma.projectSector.create({
          data: {
            projectId,
            sectorId: sameName.id,
            normalizedName: normalizeSectorName(sameName.name),
            active: true,
          },
        });
        result.linked++;
      } else {
        if (!link.active) {
          await prisma.projectSector.update({
            where: { id: link.id },
            data: { active: true, normalizedName: normalizeSectorName(sameName.name) },
          });
          link.active = true;
        }
        result.linked++;
      }

      await prisma.sector.update({
        where: { id: sameName.id },
        data: { managersRoomId: room.id, managersRoomTitle: room.title },
      });
      sameName.managersRoomId = room.id;
      sameName.managersRoomTitle = room.title;
      byRoomId.set(room.id, sameName);
      continue;
    }

    const sectorId = await ensureSectorLink(projectId, room.title);
    const reused = existing.find((sector) => sector.id === sectorId);
    if (reused && reused.managersRoomId != null && reused.managersRoomId !== room.id) {
      result.skipped.push({
        roomTitle: room.title,
        reason: `القطاع «${reused.name}» مربوط بالفعل بغرفة أخرى (${reused.managersRoomId})`,
      });
      if (!knownIds.has(sectorId)) {
        knownIds.add(sectorId);
        result.linked++;
      }
      continue;
    }

    await prisma.sector.update({
      where: { id: sectorId },
      data: { managersRoomId: room.id, managersRoomTitle: room.title },
    });

    let row: SyncSector;
    if (reused) {
      result.linked++;
      reused.managersRoomId = room.id;
      reused.managersRoomTitle = room.title;
      row = reused;
    } else {
      result.created++;
      knownIds.add(sectorId);
      row = {
        id: sectorId,
        name: room.title,
        managersRoomId: room.id,
        managersRoomTitle: room.title,
      };
      existing.push(row);
      byName.set(sectorKey(room.title), row);
    }
    byRoomId.set(room.id, row);
  }

  const authorized = new Set(rooms.map((r) => r.id));
  for (const s of existing) {
    if (s.managersRoomId != null && !authorized.has(s.managersRoomId)) {
      result.stale.push({ id: s.id, name: s.name, managersRoomId: s.managersRoomId });
    }
  }
  return result;
}
