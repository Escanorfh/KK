import type { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { assertReadingNotDecreasing } from "../../utils/meterReading";

const include = {
  equipment: {
    select: {
      id: true,
      code: true,
      name: true,
      trackingMode: true,
      trackingModeConfirmed: true,
      project: { select: { id: true, name: true } },
      sector: { select: { id: true, name: true } },
    },
  },
  workParts: { orderBy: { id: "asc" as const } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.MaintenanceInclude;

function toDate(date: string) {
  return new Date(date + "T00:00:00.000Z");
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

type PartInput = { name: string; code?: string | null; qty?: number | null; notes?: string | null };
type SaveInput = {
  workOrderNo?: number | null;
  date: string;
  endDate?: string | null;
  equipmentId: number;
  workType?: "MAINTENANCE" | "REPAIR";
  orderType?: string | null;
  maintenanceType?: string | null;
  workshop?: string | null;
  description?: string | null;
  action?: string | null;
  meterReading?: number | null;
  kmMeter?: number | null;
  downtime?: number | null;
  status?: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
  notes?: string | null;
  parts?: PartInput[];
};

async function ensureEquipment(equipmentId: number) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) {
    fail("المعدة غير موجودة", 404);
  }
  return equipment;
}

async function assertReadingsAllowed(input: {
  equipmentId: number;
  trackingMode: "HOURS" | "KM" | "BOTH";
  date: string;
  meterReading?: number | null;
  kmMeter?: number | null;
  excludeMaintenanceId?: number;
}) {
  if (input.trackingMode === "HOURS" && input.kmMeter != null) {
    fail("وضع تتبع هذه المعدة بالساعات فقط — لا يمكن تسجيل الكيلومترات", 400);
  }
  if (input.trackingMode === "KM" && input.meterReading != null) {
    fail("وضع تتبع هذه المعدة بالكيلومترات فقط — لا يمكن تسجيل الساعات", 400);
  }
  if (input.trackingMode !== "KM") {
    await assertReadingNotDecreasing({
      equipmentId: input.equipmentId,
      date: input.date,
      kind: "hours",
      value: input.meterReading,
      exclude: input.excludeMaintenanceId
        ? { maintenanceId: input.excludeMaintenanceId }
        : undefined,
    });
  }
  if (input.trackingMode !== "HOURS") {
    await assertReadingNotDecreasing({
      equipmentId: input.equipmentId,
      date: input.date,
      kind: "km",
      value: input.kmMeter,
      exclude: input.excludeMaintenanceId
        ? { maintenanceId: input.excludeMaintenanceId }
        : undefined,
    });
  }
}

async function nextWorkOrderNo(equipmentId: number): Promise<number | null> {
  const equipment = await prisma.equipment.findUnique({
    where: { id: equipmentId },
    select: { projectId: true, project: { select: { id: true, code: true } } },
  });
  if (!equipment?.project) return null;

  const digits = (equipment.project.code ?? "").replace(/\D/g, "");
  const base = Math.min((digits ? Number(digits) : equipment.project.id) * 1_000_000, 2_000_000_000);

  const last = await prisma.maintenance.aggregate({
    where: { equipment: { projectId: equipment.projectId } },
    _max: { workOrderNo: true },
  });

  return Math.max(base, last._max.workOrderNo ?? 0) + 1;
}

function dataFields(input: SaveInput) {
  return {
    workOrderNo: input.workOrderNo ?? null,
    date: toDate(input.date),
    endDate: input.endDate ? toDate(input.endDate) : null,
    equipmentId: input.equipmentId,
    workType: input.workType ?? "MAINTENANCE",
    orderType: input.orderType ?? null,
    maintenanceType: input.maintenanceType ?? null,
    workshop: input.workshop ?? null,
    description: input.description ?? null,
    action: input.action ?? null,
    meterReading: input.meterReading ?? null,
    kmMeter: input.kmMeter ?? null,
    downtime: input.downtime ?? null,
    status: input.status ?? "NEW",
    notes: input.notes ?? null,
  };
}

export async function create(input: SaveInput, userId: number) {
  const equipment = await ensureEquipment(input.equipmentId);
  await assertReadingsAllowed({
    equipmentId: input.equipmentId,
    trackingMode: equipment.trackingMode,
    date: input.date,
    meterReading: input.meterReading,
    kmMeter: input.kmMeter,
  });

  const workOrderNo = input.workOrderNo ?? (await nextWorkOrderNo(input.equipmentId));

  const record = await prisma.maintenance.create({
    data: {
      ...dataFields(input),
      workOrderNo,
      userId,
      workParts: {
        create: (input.parts ?? [])
          .filter((p) => p.name)
          .map((p) => ({
            name: p.name,
            code: p.code ?? null,
            qty: p.qty ?? null,
            notes: p.notes ?? null,
          })),
      },
    },
    include,
  });

  await logAudit(userId, "Maintenance", record.id, "CREATE", {
    equipmentId: input.equipmentId,
    date: input.date,
  });
  return { record, updated: false };
}

export async function update(id: number, input: SaveInput, userId: number) {
  const existing = await prisma.maintenance.findUnique({ where: { id } });
  if (!existing) {
    fail("أمر الشغل غير موجود", 404);
  }
  const equipment =
    input.equipmentId !== undefined
      ? await ensureEquipment(input.equipmentId)
      : await ensureEquipment(existing.equipmentId);

  if (input.meterReading !== undefined || input.kmMeter !== undefined) {
    await assertReadingsAllowed({
      equipmentId: equipment.id,
      trackingMode: equipment.trackingMode,
      date: input.date ?? existing.date.toISOString().slice(0, 10),
      meterReading: input.meterReading,
      kmMeter: input.kmMeter,
      excludeMaintenanceId: id,
    });
  }

  const record = await prisma.maintenance.update({
    where: { id },
    data: {
      ...(input.workOrderNo !== undefined ? { workOrderNo: input.workOrderNo } : {}),
      ...(input.date !== undefined ? { date: toDate(input.date) } : {}),
      ...(input.endDate !== undefined
        ? { endDate: input.endDate ? toDate(input.endDate) : null }
        : {}),
      ...(input.equipmentId !== undefined ? { equipmentId: input.equipmentId } : {}),
      ...(input.workType !== undefined ? { workType: input.workType } : {}),
      ...(input.orderType !== undefined ? { orderType: input.orderType } : {}),
      ...(input.maintenanceType !== undefined ? { maintenanceType: input.maintenanceType } : {}),
      ...(input.workshop !== undefined ? { workshop: input.workshop } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.meterReading !== undefined ? { meterReading: input.meterReading } : {}),
      ...(input.kmMeter !== undefined ? { kmMeter: input.kmMeter } : {}),
      ...(input.downtime !== undefined ? { downtime: input.downtime } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.parts !== undefined
        ? {
            workParts: {
              deleteMany: {},
              create: input.parts
                .filter((p) => p.name)
                .map((p) => ({
                  name: p.name,
                  code: p.code ?? null,
                  qty: p.qty ?? null,
                  notes: p.notes ?? null,
                })),
            },
          }
        : {}),
    },
    include,
  });

  await logAudit(userId, "Maintenance", id, "UPDATE", { date: input.date });
  return { record, updated: true };
}

interface ListParams {
  q?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  endDateFrom?: string;
  endDateTo?: string;
  equipmentId?: number;
  projectId?: number;
  code?: string;
  name?: string;
  orderType?: string;
  maintenanceType?: string;
  workshop?: string;
  description?: string;
  notes?: string;
  user?: string;
  part?: string;
  workOrderNo?: number;
  meterFrom?: number;
  meterTo?: number;
  status?: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
  workType?: "MAINTENANCE" | "REPAIR";
  scope?: number[] | null;
  page: number;
  pageSize: number;
}

type FilterParams = Omit<ListParams, "page" | "pageSize">;

function buildWhere({
  q,
  date,
  dateFrom,
  dateTo,
  endDateFrom,
  endDateTo,
  equipmentId,
  projectId,
  code,
  name,
  orderType,
  maintenanceType,
  workshop,
  description,
  notes,
  user,
  part,
  workOrderNo,
  meterFrom,
  meterTo,
  status,
  workType,
  scope,
}: FilterParams): Prisma.MaintenanceWhereInput {
  const and: Prisma.MaintenanceWhereInput[] = [];

  if (date) and.push({ date: toDate(date) });
  if (dateFrom || dateTo) {
    and.push({
      date: {
        ...(dateFrom ? { gte: toDate(dateFrom) } : {}),
        ...(dateTo ? { lte: toDate(dateTo) } : {}),
      },
    });
  }
  if (endDateFrom || endDateTo) {
    and.push({
      endDate: {
        ...(endDateFrom ? { gte: toDate(endDateFrom) } : {}),
        ...(endDateTo ? { lte: toDate(endDateTo) } : {}),
      },
    });
  }
  if (equipmentId) and.push({ equipmentId });
  if (projectId) and.push({ equipment: { projectId } });
  if (code) and.push({ equipment: { code: { contains: code, mode: "insensitive" } } });
  if (name) and.push({ equipment: { name: { contains: name, mode: "insensitive" } } });
  if (orderType) and.push({ orderType: { contains: orderType, mode: "insensitive" } });
  if (maintenanceType) and.push({ maintenanceType: { contains: maintenanceType, mode: "insensitive" } });
  if (workshop) and.push({ workshop: { contains: workshop, mode: "insensitive" } });
  if (description) and.push({ description: { contains: description, mode: "insensitive" } });
  if (notes) and.push({ notes: { contains: notes, mode: "insensitive" } });
  if (user) and.push({ user: { name: { contains: user, mode: "insensitive" } } });
  if (part) and.push({ workParts: { some: { name: { contains: part, mode: "insensitive" } } } });
  if (workOrderNo !== undefined) and.push({ workOrderNo });
  if (meterFrom !== undefined || meterTo !== undefined) {
    and.push({
      meterReading: {
        ...(meterFrom !== undefined ? { gte: meterFrom } : {}),
        ...(meterTo !== undefined ? { lte: meterTo } : {}),
      },
    });
  }
  if (status) and.push({ status });
  if (workType) and.push({ workType });
  if (q) {
    and.push({
      OR: [
        { equipment: { code: { contains: q, mode: "insensitive" } } },
        { equipment: { name: { contains: q, mode: "insensitive" } } },
        { description: { contains: q, mode: "insensitive" } },
        { maintenanceType: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (scope) and.push({ equipment: { projectId: { in: scope } } });

  return and.length ? { AND: and } : {};
}

export async function list(params: ListParams) {
  const where = buildWhere(params);
  const [data, total] = await Promise.all([
    prisma.maintenance.findMany({
      where,
      include,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.maintenance.count({ where }),
  ]);
  return { data, total, page: params.page, pageSize: params.pageSize };
}

export async function listAll(params: Omit<ListParams, "page" | "pageSize">) {
  const where = buildWhere(params);
  const [data, total] = await Promise.all([
    prisma.maintenance.findMany({ where, include, orderBy: [{ date: "desc" }, { id: "desc" }] }),
    prisma.maintenance.count({ where }),
  ]);
  return { data, total };
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.maintenance.findUnique({ where: { id } });
  if (!existing) {
    fail("أمر الشغل غير موجود", 404);
  }
  await prisma.maintenance.delete({ where: { id } });
  await logAudit(userId, "Maintenance", id, "DELETE", { date: existing.date });
  return { message: "تم حذف أمر الشغل" };
}

const CSV_HEADERS = [
  "رقم أمر الشغل",
  "التاريخ",
  "تاريخ الخروج",
  "كود المعدة",
  "اسم المعدة",
  "المشروع",
  "القطاع",
  "نوع أمر الشغل",
  "نوع الصيانة",
  "الورشة",
  "العداد النهائي",
  "الحالة",
  "قطع الغيار",
  "وصف الشغل",
  "الإجراء المتخذ",
  "ملاحظات",
  "المستخدم",
];

const STATUS_AR: Record<string, string> = {
  NEW: "جديد",
  IN_PROGRESS: "جاري صيانة",
  DONE: "تم الصيانة",
  WAITING_PARTS: "متوقف الصيانة",
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportRows(params: FilterParams) {
  const rows = await prisma.maintenance.findMany({
    where: buildWhere(params),
    include,
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });

  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.workOrderNo ?? "",
        r.date.toISOString().slice(0, 10),
        r.endDate ? r.endDate.toISOString().slice(0, 10) : "",
        r.equipment.code,
        r.equipment.name,
        r.equipment.project?.name ?? "",
        r.equipment.sector?.name ?? "",
        r.orderType ?? "",
        r.maintenanceType ?? "",
        r.workshop ?? "",
        r.meterReading ?? "",
        r.status ? STATUS_AR[r.status] : "",
        (r.workParts ?? []).map((p) => (p.qty != null ? `${p.name} (${p.qty})` : p.name)).join("، "),
        r.description ?? "",
        r.action ?? "",
        r.notes ?? "",
        r.user?.name ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return "\uFEFF" + lines.join("\r\n");
}
