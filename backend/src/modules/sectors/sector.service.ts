import type { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { lastDayEquipmentCounts } from "../../utils/lastDayEquipment";
import { normalizeArabic, resolveManagersProject, type ManagersRoom } from "../../utils/managers";

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export async function list(projectId?: number, scope?: number[] | null) {
  const and: Prisma.SectorWhereInput[] = [];
  if (projectId) and.push({ projectId });
  if (scope) and.push({ projectId: { in: scope } });

  const [rows, lastDay] = await Promise.all([
    prisma.sector.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ projectId: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { equipment: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    lastDayEquipmentCounts(),
  ]);

  // عدّاد المعدات من شيت الـ day (آخر يوم) — لأن المعدات بتتنقل، ولو مفيش سجل يومي خالص نرجع للإسناد الحالي
  return rows.map((s) => ({
    ...s,
    activeEquipment: lastDay.lastLogDate ? (lastDay.bySector.get(s.id) ?? 0) : s._count.equipment,
  }));
}

export async function create(data: { projectId: number; name: string }, userId: number) {
  const project = await prisma.project.findUnique({ where: { id: data.projectId } });
  if (!project) {
    throw Object.assign(new Error("المشروع غير موجود"), { status: 404 });
  }
  const exists = await prisma.sector.findFirst({
    where: { projectId: data.projectId, name: data.name },
  });
  if (exists) {
    throw Object.assign(new Error("القطاع موجود في المشروع ده من قبل"), { status: 409 });
  }
  const sector = await prisma.sector.create({ data });
  await logAudit(userId, "Sector", sector.id, "CREATE", { name: sector.name, projectId: data.projectId });
  return sector;
}

export async function update(id: number, name: string, userId: number) {
  const existing = await prisma.sector.findUnique({ where: { id } });
  if (!existing) {
    throw Object.assign(new Error("القطاع غير موجود"), { status: 404 });
  }
  const dup = await prisma.sector.findFirst({
    where: { projectId: existing.projectId, name, id: { not: id } },
  });
  if (dup) {
    throw Object.assign(new Error("القطاع موجود في المشروع ده من قبل"), { status: 409 });
  }
  const sector = await prisma.sector.update({ where: { id }, data: { name } });
  await logAudit(userId, "Sector", id, "UPDATE", { name });
  return sector;
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.sector.findUnique({
    where: { id },
    include: { _count: { select: { equipment: true } } },
  });
  if (!existing) {
    throw Object.assign(new Error("القطاع غير موجود"), { status: 404 });
  }
  if (existing._count.equipment > 0) {
    throw Object.assign(
      new Error("لا يمكن حذف قطاع به معدات — احذف أو انقل المعدات أولًا"),
      { status: 409 }
    );
  }
  await prisma.sector.delete({ where: { id } });
  await logAudit(userId, "Sector", id, "DELETE", { name: existing.name });
  return { message: "تم حذف القطاع" };
}

// القطاعات المصرّح بها للتوكن عند المدرين للمشروع المحلي — للمراجعة البشرية قبل الربط
export async function managersRooms(projectId: number) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) fail("المشروع غير موجود", 404);

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
    select: { id: true, name: true, projectId: true, project: { select: { name: true } } },
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

  if (sector.projectId == null) {
    fail("القطاع غير مربوط بمشروع — cannot link managers room without project", 422);
  }
  const { rooms } = await managersRooms(sector.projectId);
  const room = rooms.find((item) => item.id === managersRoomId);
  if (!room) {
    fail(
      `قطاع نظام المدرين بمعرّف ${managersRoomId} ليس ضمن القطاعات المصرّح بها لمشروع «${sector.project?.name ?? ""}»`,
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

/**
 * مزامنة قطاعات مشروع مع الغرف المصرّح بها عنده عند المدرين (rooms[] من /requisitions/projects):
 * المطابقة بمعرّف الغرفة أولًا، وبعدين بالاسم الحرفي داخل نفس المشروع — التشابه التقريبي ما كانش يومًا مصدر ربط.
 * مافيش حذف ولا إعادة تسمية لقطاع موجود؛ الغرفة اللي ملهاش قطاع بتتعمل جديدة وهي مربوطة،
 * والقطاع المربوط بغرفة اتسحبت من التصريح بيفضل زي ما هو وبيتبلّغ عنه للمراجعة.
 */
export async function syncSectorsForProject(
  projectId: number,
  rooms: ManagersRoom[]
): Promise<SectorSyncResult> {
  const result: SectorSyncResult = { created: 0, linked: 0, unchanged: 0, skipped: [], stale: [] };

  const existing = await prisma.sector.findMany({
    where: { projectId },
    select: { id: true, name: true, managersRoomId: true, managersRoomTitle: true },
  });
  const byRoomId = new Map<number, (typeof existing)[number]>();
  const byName = new Map<string, (typeof existing)[number]>();
  for (const s of existing) {
    if (s.managersRoomId != null) byRoomId.set(s.managersRoomId, s);
    const key = sectorKey(s.name);
    if (key && !byName.has(key)) byName.set(key, s);
  }

  for (const room of rooms) {
    const already = byRoomId.get(room.id);
    if (already) {
      if (already.managersRoomTitle !== room.title) {
        await prisma.sector.update({ where: { id: already.id }, data: { managersRoomTitle: room.title } });
        already.managersRoomTitle = room.title;
      }
      result.unchanged++;
      continue;
    }

    const sameName = byName.get(sectorKey(room.title));
    if (sameName) {
      if (sameName.managersRoomId == null) {
        await prisma.sector.update({
          where: { id: sameName.id },
          data: { managersRoomId: room.id, managersRoomTitle: room.title },
        });
        sameName.managersRoomId = room.id;
        sameName.managersRoomTitle = room.title;
        byRoomId.set(room.id, sameName);
        result.linked++;
      } else {
        // الاسم مشغول بقطاع مربوط بغرفة تانية — القيد @@unique([projectId, name]) بيفرض مراجعة
        result.skipped.push({
          roomTitle: room.title,
          reason: `القطاع «${sameName.name}» مربوط بالفعل بغرفة أخرى (${sameName.managersRoomId})`,
        });
      }
      continue;
    }

    const made = await prisma.sector.create({
      data: { projectId, name: room.title, managersRoomId: room.id, managersRoomTitle: room.title },
    });
    byRoomId.set(room.id, made);
    byName.set(sectorKey(room.title), made);
    result.created++;
  }

  const authorized = new Set(rooms.map((r) => r.id));
  for (const s of existing) {
    if (s.managersRoomId != null && !authorized.has(s.managersRoomId)) {
      result.stale.push({ id: s.id, name: s.name, managersRoomId: s.managersRoomId });
    }
  }
  return result;
}
