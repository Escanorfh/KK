import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { scopeOr } from "../../utils/scope";
import type { OilType, Prisma } from "@prisma/client";

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

/** توحيد الكتابة العربية للبحث بالاسم (أ/إ/آ→ا، ة→ه، ى→ي) */
function normalizeArabic(value: string): string {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

/**
 * تصنيف اسم صنف (زيت/شحم) إلى نوع الزيت — يُستخدم في الاستيراد التلقائي من الصيانة.
 * الترتيب مهم: الهيدروليك والفتيس والترس تُميَّز قبل الافتراض «محرك».
 */
export function classifyOilType(partName: string): OilType | null {
  const name = normalizeArabic(partName);
  if (!name.includes("زيت") && !name.includes("شحم")) return null;

  if (["هيدروليك", "هيدروليك"].some((w) => name.includes(w))) return "HYDRAULIC";
  if (["فيتيس", "فتيس", "باور", "تعزيز", "ستيرنج", "direct"].some((w) => name.includes(w))) {
    return "STEERING";
  }
  if (["ترس", "جير", "علبة سرع", "قير", "هوبتات"].some((w) => name.includes(w))) return "GEARBOX";
  if (["محرك", "موتور", "ماتور", "انجين", "engine"].some((w) => name.includes(w))) return "ENGINE";
  // «زيت» مجرّد بدون توصيف = زيت محرك (الأشيع في المعدات)
  if (name.includes("زيت")) return "ENGINE";
  return "OTHER";
}

export const OIL_TYPE_LABELS: Record<OilType, string> = {
  ENGINE: "زيت محرك",
  HYDRAULIC: "زيت هيدروليك",
  STEERING: "زيت فيتيس",
  GEARBOX: "زيت ترس",
  OTHER: "أخرى",
};

export type ListParams = {
  page?: number;
  pageSize?: number;
  projectId?: number;
  equipmentId?: number;
  oilType?: OilType;
  source?: "MANUAL" | "MAINTENANCE";
  from?: string;
  to?: string;
  q?: string;
};

function buildWhere(params: ListParams, scope: number[] | null): Prisma.OilConsumptionWhereInput {
  const and: Prisma.OilConsumptionWhereInput[] = [];
  if (params.projectId) {
    and.push({ equipment: { projectId: params.projectId } });
  }
  const own = scopeOr(scope);
  if (own) {
    and.push({ equipment: { OR: own } });
  }
  if (params.equipmentId) and.push({ equipmentId: params.equipmentId });
  if (params.oilType) and.push({ oilType: params.oilType });
  if (params.source) and.push({ source: params.source });
  if (params.from || params.to) {
    and.push({
      date: {
        ...(params.from ? { gte: new Date(params.from) } : {}),
        ...(params.to ? { lte: new Date(params.to) } : {}),
      },
    });
  }
  if (params.q) {
    and.push({
      OR: [
        { oilName: { contains: params.q, mode: "insensitive" } },
        { equipment: { code: { contains: params.q, mode: "insensitive" } } },
        { equipment: { name: { contains: params.q, mode: "insensitive" } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

const EQUIPMENT_SELECT = {
  id: true,
  code: true,
  name: true,
  project: { select: { id: true, name: true } },
} satisfies Prisma.EquipmentSelect;

export async function list(params: ListParams, scope: number[] | null) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const where = buildWhere(params, scope);

  const [data, total] = await Promise.all([
    prisma.oilConsumption.findMany({
      where,
      include: {
        equipment: { select: EQUIPMENT_SELECT },
        user: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.oilConsumption.count({ where }),
  ]);

  return { data, total, page, pageSize };
}

export type CreateInput = {
  date: string;
  equipmentId: number;
  oilType: OilType;
  oilName?: string | null;
  liters: number;
  pricePerLiter?: number | null;
  notes?: string | null;
};

function computeAmount(liters: number, pricePerLiter?: number | null): number | null {
  if (pricePerLiter == null) return null;
  return Math.round(liters * pricePerLiter * 100) / 100;
}

export async function create(input: CreateInput, userId: number, source: "MANUAL" | "MAINTENANCE" = "MANUAL", maintenanceId?: number | null) {
  const equipment = await prisma.equipment.findUnique({ where: { id: input.equipmentId } });
  if (!equipment) fail("المعدة غير موجودة", 404);

  const record = await prisma.oilConsumption.create({
    data: {
      date: new Date(input.date),
      equipmentId: input.equipmentId,
      oilType: input.oilType,
      oilName: input.oilName ?? null,
      liters: input.liters,
      pricePerLiter: input.pricePerLiter ?? null,
      totalAmount: computeAmount(input.liters, input.pricePerLiter),
      source,
      maintenanceId: maintenanceId ?? null,
      notes: input.notes ?? null,
      userId,
    },
    include: { equipment: { select: EQUIPMENT_SELECT } },
  });

  if (source === "MANUAL") {
    await logAudit(userId, "OilConsumption", record.id, "CREATE", {
      equipmentId: input.equipmentId,
      oilType: input.oilType,
      liters: input.liters,
    });
  }
  return { record };
}

export async function update(id: number, input: Partial<CreateInput>, userId: number) {
  const existing = await prisma.oilConsumption.findUnique({ where: { id } });
  if (!existing) fail("قيد الاستهلاك غير موجود", 404);
  if (existing.source === "MAINTENANCE") {
    fail("هذا القيد مستورد من أمر صيانة — عدّله من أمر الصيانة نفسه", 409);
  }
  if (input.equipmentId) {
    const equipment = await prisma.equipment.findUnique({ where: { id: input.equipmentId } });
    if (!equipment) fail("المعدة غير موجودة", 404);
  }

  const liters = input.liters ?? existing.liters;
  const pricePerLiter = input.pricePerLiter !== undefined ? input.pricePerLiter : existing.pricePerLiter;

  const record = await prisma.oilConsumption.update({
    where: { id },
    data: {
      ...(input.date ? { date: new Date(input.date) } : {}),
      ...(input.equipmentId ? { equipmentId: input.equipmentId } : {}),
      ...(input.oilType ? { oilType: input.oilType } : {}),
      ...(input.oilName !== undefined ? { oilName: input.oilName } : {}),
      ...(input.liters !== undefined ? { liters: input.liters } : {}),
      ...(input.pricePerLiter !== undefined ? { pricePerLiter: input.pricePerLiter } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      totalAmount: computeAmount(liters, pricePerLiter),
    },
    include: { equipment: { select: EQUIPMENT_SELECT } },
  });

  await logAudit(userId, "OilConsumption", id, "UPDATE", {
    oilType: record.oilType,
    liters: record.liters,
  });
  return { record };
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.oilConsumption.findUnique({ where: { id } });
  if (!existing) fail("قيد الاستهلاك غير موجود", 404);

  await prisma.oilConsumption.delete({ where: { id } });
  await logAudit(userId, "OilConsumption", id, "DELETE", {
    equipmentId: existing.equipmentId,
    oilType: existing.oilType,
    liters: existing.liters,
  });
  return { message: "تم حذف قيد الاستهلاك" };
}

export type SummaryRow = {
  projectId: number | null;
  projectName: string;
  totalLiters: number;
  totalAmount: number | null;
  entries: number;
  byType: Record<OilType, { liters: number; amount: number | null; entries: number }>;
};

function emptyTypeBucket() {
  return {
    ENGINE: { liters: 0, amount: 0, entries: 0 },
    HYDRAULIC: { liters: 0, amount: 0, entries: 0 },
    STEERING: { liters: 0, amount: 0, entries: 0 },
    GEARBOX: { liters: 0, amount: 0, entries: 0 },
    OTHER: { liters: 0, amount: 0, entries: 0 },
  } as Record<OilType, { liters: number; amount: number | null; entries: number }>;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** ملخص الاستهلكات: لكل مشروع × نوع الزيت (محرك/هيدروليك/فيتيس/ترس/أخرى) */
export async function summary(params: ListParams, scope: number[] | null) {
  const where = buildWhere(params, scope);
  const rows = await prisma.oilConsumption.findMany({
    where,
    select: {
      oilType: true,
      liters: true,
      totalAmount: true,
      equipment: { select: { projectId: true, project: { select: { name: true } } } },
    },
  });

  const byProject = new Map<number | null, SummaryRow>();
  const grand = emptyTypeBucket();
  let grandLiters = 0;
  let grandAmount = 0;
  let grandEntries = 0;
  let grandHasAmount = false;

  for (const row of rows) {
    const projectId = row.equipment.projectId;
    let bucket = byProject.get(projectId);
    if (!bucket) {
      bucket = {
        projectId,
        projectName: row.equipment.project?.name ?? "بدون مشروع",
        totalLiters: 0,
        totalAmount: 0,
        entries: 0,
        byType: emptyTypeBucket(),
      };
      byProject.set(projectId, bucket);
    }

    const t = bucket.byType[row.oilType];
    t.liters = round(t.liters + row.liters);
    t.entries += 1;
    if (row.totalAmount != null && t.amount != null) t.amount = round(t.amount + row.totalAmount);

    bucket.totalLiters = round(bucket.totalLiters + row.liters);
    if (row.totalAmount != null && bucket.totalAmount != null) {
      bucket.totalAmount = round(bucket.totalAmount + row.totalAmount);
    }
    bucket.entries += 1;

    const g = grand[row.oilType];
    g.liters = round(g.liters + row.liters);
    g.entries += 1;
    if (row.totalAmount != null && g.amount != null) g.amount = round(g.amount + row.totalAmount);

    grandLiters = round(grandLiters + row.liters);
    grandEntries += 1;
    if (row.totalAmount != null) {
      grandAmount = round(grandAmount + row.totalAmount);
      grandHasAmount = true;
    }
  }

  const projects = [...byProject.values()].sort((a, b) => b.totalLiters - a.totalLiters);

  return {
    projects,
    grand: {
      liters: grandLiters,
      amount: grandHasAmount ? grandAmount : null,
      entries: grandEntries,
      byType: grand,
    },
    totalEntries: rows.length,
  };
}

export type SyncResult = { created: number; skipped: number; scanned: number };

/**
 * استيراد استهلكات الزيوت من أوامر الصيانة (WorkPart اللي فيها اسم زيت).
 * idempotent: ما يعيدش استيراد نفس الصنف لنفس أمر الصيانة.
 */
export async function syncFromMaintenance(userId: number, scope: number[] | null): Promise<SyncResult> {
  const own = scopeOr(scope);
  const maintainences = await prisma.maintenance.findMany({
    where: {
      ...(own ? { equipment: { OR: own } } : {}),
      workParts: { some: {} },
    },
    select: {
      id: true,
      date: true,
      equipmentId: true,
      workParts: { select: { id: true, name: true, qty: true } },
    },
  });

  // الأصناف المستوردة سابقًا لنفس أمر الصيانة (بالاسم بعد التوحيد)
  const existing = await prisma.oilConsumption.findMany({
    where: { source: "MAINTENANCE", maintenanceId: { not: null } },
    select: { maintenanceId: true, oilName: true, oilType: true },
  });
  const seen = new Set(
    existing.map((e) => `${e.maintenanceId}|${e.oilType}|${normalizeArabic(e.oilName ?? "")}`)
  );

  let created = 0;
  let skipped = 0;

  for (const order of maintainences) {
    for (const part of order.workParts) {
      const oilType = classifyOilType(part.name);
      if (!oilType) continue;

      const key = `${order.id}|${oilType}|${normalizeArabic(part.name)}`;
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);

      // الكمية في WorkPart تُعامَل كltrs لما يكون الصنف زيتًا
      const liters = part.qty ?? 0;
      await prisma.oilConsumption.create({
        data: {
          date: order.date,
          equipmentId: order.equipmentId,
          oilType,
          oilName: part.name.trim(),
          liters,
          source: "MAINTENANCE",
          maintenanceId: order.id,
          userId,
        },
      });
      created += 1;
    }
  }

  await logAudit(userId, "OilConsumption", 0, "CREATE", { action: "SYNC", created, skipped });
  return { created, skipped, scanned: maintainences.length };
}
