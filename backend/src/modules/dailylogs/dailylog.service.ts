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
      project: { select: { id: true, name: true } },
      sector: { select: { id: true, name: true } },
    },
  },
  user: { select: { id: true, name: true } },
} satisfies Prisma.DailyLogInclude;

function toDate(date: string) {
  return new Date(date + "T00:00:00.000Z");
}

interface SaveInput {
  id?: number;
  date: string;
  equipmentId: number;
  endMeter?: number | null;
  operatingHours?: number | null;
  diesel?: number | null;
  productivityType?: string | null;
  productivityCount?: number | null;
  condition?: "GOOD" | "BROKEN" | "STOPPED" | null;
  conditionNote?: string | null;
  notes?: string | null;
}

const dataFields = (input: SaveInput) => ({
  date: toDate(input.date),
  equipmentId: input.equipmentId,
  endMeter: input.endMeter ?? null,
  operatingHours: input.operatingHours ?? null,
  diesel: input.diesel ?? null,
  productivityType: input.productivityType ?? null,
  productivityCount: input.productivityCount ?? null,
  condition: input.condition ?? null,
  conditionNote: input.conditionNote ?? null,
  notes: input.notes ?? null,
});

async function ensureEquipment(equipmentId: number) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) {
    throw Object.assign(new Error("المعدة غير موجودة"), { status: 404 });
  }
  return equipment;
}

function assertHoursAllowed(
  equipment: { trackingMode: "HOURS" | "KM" | "BOTH" },
  input: Pick<SaveInput, "endMeter" | "operatingHours">
) {
  if (
    equipment.trackingMode === "KM" &&
    (input.endMeter != null || input.operatingHours != null)
  ) {
    throw Object.assign(
      new Error("وضع تتبع هذه المعدة بالكيلومترات فقط — لا يمكن تسجيل عدادات الساعات"),
      { status: 400 }
    );
  }
}

async function assertMeterNotBelowBaseline(
  equipmentId: number,
  date: Date,
  endMeter: number | null,
  excludeId?: number
) {
  await assertReadingNotDecreasing({
    equipmentId,
    date: date.toISOString().slice(0, 10),
    kind: "hours",
    value: endMeter,
    exclude: excludeId ? { dailyLogId: excludeId } : undefined,
  });
}

export async function save(input: SaveInput, userId: number) {
  const equipment = await ensureEquipment(input.equipmentId);
  assertHoursAllowed(equipment, input);
  const date = toDate(input.date);

  if (!input.id && equipment.trackingMode !== "KM") {
    await assertMeterNotBelowBaseline(input.equipmentId, date, input.endMeter ?? null);
  }

  if (input.id) {
    return update(input.id, input, userId);
  }

  const sameDay = await prisma.dailyLog.findUnique({
    where: { date_equipmentId: { date, equipmentId: input.equipmentId } },
  });

  if (sameDay) {
    const record = await prisma.dailyLog.update({
      where: { id: sameDay.id },
      data: dataFields(input),
      include,
    });
    await logAudit(userId, "DailyLog", record.id, "UPDATE", { reason: "same-day upsert" });
    return { record, updated: true };
  }

  const record = await prisma.dailyLog.create({ data: dataFields(input), include });
  await logAudit(userId, "DailyLog", record.id, "CREATE", { date: input.date });
  return { record, updated: false };
}

export async function update(id: number, input: Partial<SaveInput>, userId: number) {
  const existing = await prisma.dailyLog.findUnique({ where: { id } });
  if (!existing) {
    throw Object.assign(new Error("السجل غير موجود"), { status: 404 });
  }

  const equipmentId = input.equipmentId ?? existing.equipmentId;
  const equipment = await ensureEquipment(equipmentId);
  assertHoursAllowed(equipment, input);

  const date = input.date ? toDate(input.date) : existing.date;

  const conflict = await prisma.dailyLog.findFirst({
    where: { date, equipmentId, NOT: { id } },
  });
  if (conflict) {
    throw Object.assign(new Error("يوجد سجل آخر لنفس المعدة في نفس التاريخ"), { status: 409 });
  }

  if (equipment.trackingMode !== "KM") {
    const effectiveEnd = input.endMeter !== undefined ? input.endMeter : existing.endMeter;
    await assertMeterNotBelowBaseline(equipmentId, date, effectiveEnd, id);
  }

  const merge = <T>(newValue: T | null | undefined, oldValue: T): T =>
    newValue !== undefined ? (newValue as T) : oldValue;

  const record = await prisma.dailyLog.update({
    where: { id },
    data: {
      date,
      equipmentId,
      endMeter: merge(input.endMeter, existing.endMeter),
      operatingHours: merge(input.operatingHours, existing.operatingHours),
      diesel: merge(input.diesel, existing.diesel),
      productivityType: merge(input.productivityType, existing.productivityType),
      productivityCount: merge(input.productivityCount, existing.productivityCount),
      condition: merge(input.condition, existing.condition),
      conditionNote: merge(input.conditionNote, existing.conditionNote),
      notes: merge(input.notes, existing.notes),
    },
    include,
  });
  await logAudit(userId, "DailyLog", id, "UPDATE", input);
  return { record, updated: true };
}

interface ListParams {
  q?: string;
  code?: string;
  name?: string;
  sector?: string;
  productivityType?: string;
  productivityCountFrom?: number;
  productivityCountTo?: number;
  notes?: string;
  user?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  equipmentId?: number;
  projectId?: number;
  condition?: "GOOD" | "BROKEN" | "STOPPED";
  meterEndFrom?: number;
  meterEndTo?: number;
  hoursFrom?: number;
  hoursTo?: number;
  dieselFrom?: number;
  dieselTo?: number;
  scope?: number[] | null;
  page: number;
  pageSize: number;
}

function buildWhere({
  q,
  code,
  name,
  sector,
  productivityType,
  productivityCountFrom,
  productivityCountTo,
  notes,
  user,
  date,
  dateFrom,
  dateTo,
  equipmentId,
  projectId,
  condition,
  meterEndFrom,
  meterEndTo,
  hoursFrom,
  hoursTo,
  dieselFrom,
  dieselTo,
  scope,
}: Omit<ListParams, "page" | "pageSize">): Prisma.DailyLogWhereInput {
  const and: Prisma.DailyLogWhereInput[] = [];

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
  if (projectId) and.push({ equipment: { projectId } });
  if (condition) and.push({ condition });
  if (code) and.push({ equipment: { code: { contains: code, mode: "insensitive" } } });
  if (name) and.push({ equipment: { name: { contains: name, mode: "insensitive" } } });
  if (sector) and.push({ equipment: { sector: { name: { contains: sector, mode: "insensitive" } } } });
  if (user) and.push({ user: { name: { contains: user, mode: "insensitive" } } });
  if (productivityType)
    and.push({ productivityType: { contains: productivityType, mode: "insensitive" } });
  if (productivityCountFrom != null || productivityCountTo != null) {
    and.push({
      productivityCount: {
        ...(productivityCountFrom != null ? { gte: productivityCountFrom } : {}),
        ...(productivityCountTo != null ? { lte: productivityCountTo } : {}),
      },
    });
  }
  if (notes) and.push({ notes: { contains: notes, mode: "insensitive" } });
  if (meterEndFrom != null || meterEndTo != null) {
    and.push({
      endMeter: {
        ...(meterEndFrom != null ? { gte: meterEndFrom } : {}),
        ...(meterEndTo != null ? { lte: meterEndTo } : {}),
      },
    });
  }
  if (hoursFrom != null || hoursTo != null) {
    and.push({
      operatingHours: {
        ...(hoursFrom != null ? { gte: hoursFrom } : {}),
        ...(hoursTo != null ? { lte: hoursTo } : {}),
      },
    });
  }
  if (dieselFrom != null || dieselTo != null) {
    and.push({
      diesel: {
        ...(dieselFrom != null ? { gte: dieselFrom } : {}),
        ...(dieselTo != null ? { lte: dieselTo } : {}),
      },
    });
  }
  if (q) {
    and.push({
      OR: [
        { equipment: { code: { contains: q, mode: "insensitive" } } },
        { equipment: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (scope) and.push({ equipment: { projectId: { in: scope } } });

  return and.length ? { AND: and } : {};
}

export async function list({
  q,
  date,
  dateFrom,
  dateTo,
  equipmentId,
  projectId,
  condition,
  scope,
  page,
  pageSize,
}: ListParams) {
  const where = buildWhere({ q, date, dateFrom, dateTo, equipmentId, projectId, condition, scope });

  const [data, total] = await Promise.all([
    prisma.dailyLog.findMany({
      where,
      include,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.dailyLog.count({ where }),
  ]);

  return { data, total, page, pageSize };
}

export async function listAll(params: Omit<ListParams, "page" | "pageSize">) {
  const where = buildWhere(params);
  const [data, total] = await Promise.all([
    prisma.dailyLog.findMany({ where, include, orderBy: [{ date: "desc" }, { id: "desc" }] }),
    prisma.dailyLog.count({ where }),
  ]);
  return { data, total };
}

/** أنواع الإنتاجية الأكثر استخدامًا — تُعرض كاقتراحات في خانة النوع */
export async function productivityTypes(scope?: number[] | null) {
  const grouped = await prisma.dailyLog.groupBy({
    by: ["productivityType"],
    where: { ...buildWhere({ scope }), NOT: [{ productivityType: null }, { productivityType: "" }] },
    _count: { productivityType: true },
    orderBy: { _count: { productivityType: "desc" } },
    take: 15,
  });
  return grouped.map((g) => g.productivityType).filter((v): v is string => v !== null);
}

const CSV_HEADERS = [
  "رقم السجل",
  "التاريخ",
  "كود المعدة",
  "اسم المعدة",
  "المشروع",
  "القطاع",
  "نهاية العداد",
  "ساعات التشغيل",
  "الديزل",
  "نوع الإنتاجية",
  "عدد الإنتاجية",
  "الصلاحية",
  "تفصيل الصلاحية",
  "ملاحظات",
  "المستخدم",
];

const CONDITION_AR: Record<string, string> = {
  GOOD: "صالح",
  BROKEN: "عاطل",
  STOPPED: "متوقف",
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportRows(params: Omit<ListParams, "page" | "pageSize">) {
  const rows = await prisma.dailyLog.findMany({
    where: buildWhere(params),
    include,
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });

  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.date.toISOString().slice(0, 10),
        r.equipment.code,
        r.equipment.name,
        r.equipment.project?.name ?? "",
        r.equipment.sector?.name ?? "",
        r.endMeter ?? "",
        r.operatingHours ?? "",
        r.diesel ?? "",
        r.productivityType ?? "",
        r.productivityCount ?? "",
        r.condition ? CONDITION_AR[r.condition] : "",
        r.conditionNote ?? "",
        r.notes ?? "",
        r.user?.name ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return "\uFEFF" + lines.join("\r\n");
}

export async function get(id: number) {
  const record = await prisma.dailyLog.findUnique({ where: { id }, include });
  if (!record) {
    throw Object.assign(new Error("السجل غير موجود"), { status: 404 });
  }
  return record;
}
