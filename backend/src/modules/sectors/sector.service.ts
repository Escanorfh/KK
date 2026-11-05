import type { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { lastDayEquipmentCounts } from "../../utils/lastDayEquipment";
import { resolveManagersProject, type ManagersRoom } from "../../utils/managers";

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

  const { rooms } = await managersRooms(sector.projectId);
  const room = rooms.find((item) => item.id === managersRoomId);
  if (!room) {
    fail(
      `قطاع نظام المدرين بمعرّف ${managersRoomId} ليس ضمن القطاعات المصرّح بها لمشروع «${sector.project.name}»`,
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
