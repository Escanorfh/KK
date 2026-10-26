import type { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";

const include = {
  equipment: {
    select: {
      id: true,
      code: true,
      name: true,
      project: { select: { id: true, name: true } },
      sector: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.FaultInclude;

function toDate(date: string) {
  return new Date(date + "T00:00:00.000Z");
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

type SaveInput = {
  date?: string;
  equipmentId?: number;
  description?: string;
  cause?: string | null;
  faultType?: string | null;
  downtimeHours?: number | null;
  actionTaken?: string | null;
  status?: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
};

async function ensureEquipment(equipmentId: number) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) {
    fail("المعدة غير موجودة", 404);
  }
  return equipment;
}

export async function create(input: SaveInput & { date: string; equipmentId: number; description: string }, userId: number) {
  const equipment = await ensureEquipment(input.equipmentId);

  const record = await prisma.fault.create({
    data: {
      date: toDate(input.date),
      equipmentId: input.equipmentId,
      projectId: equipment.projectId,
      sectorId: equipment.sectorId,
      description: input.description,
      cause: input.cause ?? null,
      faultType: input.faultType ?? null,
      downtimeHours: input.downtimeHours ?? null,
      actionTaken: input.actionTaken ?? null,
      status: input.status ?? "NEW",
    },
    include,
  });

  await logAudit(userId, "Fault", record.id, "CREATE", {
    equipmentId: input.equipmentId,
    date: input.date,
  });
  return { record };
}

export async function update(id: number, input: SaveInput, userId: number) {
  const existing = await prisma.fault.findUnique({ where: { id } });
  if (!existing) {
    fail("العطل غير موجود", 404);
  }

  let derived: { projectId?: number | null; sectorId?: number | null } = {};
  if (input.equipmentId !== undefined && input.equipmentId !== existing.equipmentId) {
    const equipment = await ensureEquipment(input.equipmentId);
    derived = { projectId: equipment.projectId, sectorId: equipment.sectorId };
  }

  const record = await prisma.fault.update({
    where: { id },
    data: {
      ...(input.date !== undefined ? { date: toDate(input.date) } : {}),
      ...(input.equipmentId !== undefined ? { equipmentId: input.equipmentId } : {}),
      ...derived,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.cause !== undefined ? { cause: input.cause } : {}),
      ...(input.faultType !== undefined ? { faultType: input.faultType } : {}),
      ...(input.downtimeHours !== undefined ? { downtimeHours: input.downtimeHours } : {}),
      ...(input.actionTaken !== undefined ? { actionTaken: input.actionTaken } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    include,
  });

  await logAudit(userId, "Fault", id, "UPDATE", { date: record.date });
  return { record, updated: true };
}

interface ListParams {
  q?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  equipmentId?: number;
  projectId?: number;
  status?: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
  scope?: number[] | null;
  page: number;
  pageSize: number;
}

function buildWhere({
  q,
  date,
  dateFrom,
  dateTo,
  equipmentId,
  projectId,
  status,
  scope,
}: Omit<ListParams, "page" | "pageSize">): Prisma.FaultWhereInput {
  const and: Prisma.FaultWhereInput[] = [];

  if (date) and.push({ date: toDate(date) });
  if (dateFrom || dateTo) {
    and.push({
      date: {
        ...(dateFrom ? { gte: toDate(dateFrom) } : {}),
        ...(dateTo ? { lte: toDate(dateTo) } : {}),
      },
    });
  }
  if (equipmentId) and.push({ equipmentId });
  if (projectId) and.push({ projectId });
  if (status) and.push({ status });
  if (q) {
    and.push({
      OR: [
        { equipment: { code: { contains: q, mode: "insensitive" } } },
        { equipment: { name: { contains: q, mode: "insensitive" } } },
        { description: { contains: q, mode: "insensitive" } },
        { cause: { contains: q, mode: "insensitive" } },
        { faultType: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (scope) {
    and.push({ OR: [{ projectId: { in: scope } }, { equipment: { projectId: { in: scope } } }] });
  }

  return and.length ? { AND: and } : {};
}

export async function list(params: ListParams) {
  const where = buildWhere(params);
  const [data, total] = await Promise.all([
    prisma.fault.findMany({
      where,
      include,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.fault.count({ where }),
  ]);
  return { data, total, page: params.page, pageSize: params.pageSize };
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.fault.findUnique({ where: { id } });
  if (!existing) {
    fail("العطل غير موجود", 404);
  }
  await prisma.fault.delete({ where: { id } });
  await logAudit(userId, "Fault", id, "DELETE", { date: existing.date });
  return { message: "تم حذف العطل" };
}

export interface FaultReportRow {
  equipmentId: number;
  code: string;
  name: string;
  note: string;
}

export async function report(params: {
  projectId?: number;
  date?: string;
  scope?: number[] | null;
}) {
  const and: Prisma.DailyLogWhereInput[] = [];
  if (params.projectId) and.push({ equipment: { projectId: params.projectId } });
  if (params.scope) and.push({ equipment: { projectId: { in: params.scope } } });
  const scopeWhere = and.length ? { AND: and } : {};

  let dateStr = params.date;
  if (!dateStr) {
    const agg = await prisma.dailyLog.aggregate({
      _max: { date: true },
      where: scopeWhere,
    });
    dateStr = (agg._max.date ?? new Date()).toISOString().slice(0, 10);
  }
  const date = toDate(dateStr);

  const logs = await prisma.dailyLog.findMany({
    where: { date, ...scopeWhere },
    include: { equipment: { select: { id: true, code: true, name: true } } },
    orderBy: { id: "asc" },
  });

  const summary = { broken: 0, stopped: 0, good: 0, total: 0 };
  const rows: FaultReportRow[] = [];
  for (const log of logs) {
    if (log.condition === "BROKEN") {
      summary.broken++;
      rows.push({
        equipmentId: log.equipmentId,
        code: log.equipment.code,
        name: log.equipment.name,
        note: (log.notes || log.conditionNote || "").trim(),
      });
    } else if (log.condition === "STOPPED") {
      summary.stopped++;
    } else if (log.condition === "GOOD") {
      summary.good++;
    }
  }
  summary.total = summary.broken + summary.stopped + summary.good;

  let project: { id: number; name: string } | null = null;
  if (params.projectId && (!params.scope || params.scope.includes(params.projectId))) {
    project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { id: true, name: true },
    });
  }

  return { date: dateStr, project, summary, rows };
}
