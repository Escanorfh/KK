import type { Prisma, TrackingMode } from "@prisma/client";
import prisma from "../../config/prisma";
import { issueAttestation } from "../../utils/attestation";
import { logAudit } from "../../utils/audit";
import { ASSIGNMENT_SOURCES, activeProjectSectorId, listAssignments as listAssignmentHistory, recordAssignment, recordAssignmentSafe } from "../../utils/assignmentHistory";
import { resolveTrackingSetup, UNCLASSIFIED_CATEGORY } from "./trackingMode";
import { scopeOr } from "../../utils/scope";
import { ensureSectorLink } from "../sectors/sector.service";
import {
  firstActiveProjectId,
  hasSectorAssociations,
  isSectorMemberOfProject,
} from "../../utils/sectorMembership";

const equipmentInclude = {
  project: { select: { id: true, code: true, name: true } },
  sector: { select: { id: true, name: true } },
  category: {
    select: { id: true, name: true, defaultTrackingMode: true },
  },
} satisfies Prisma.EquipmentInclude;

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

export const DEFAULT_CATEGORIES: {
  name: string;
  codePrefixes: string[];
  defaultTrackingMode: TrackingMode;
}[] = [
  { name: "جريدر", codePrefixes: ["GE", "GR"], defaultTrackingMode: "BOTH" },
  { name: "لودر", codePrefixes: ["LO"], defaultTrackingMode: "HOURS" },
  { name: "حفار", codePrefixes: ["EX"], defaultTrackingMode: "HOURS" },
  { name: "مدحلة", codePrefixes: ["RC"], defaultTrackingMode: "HOURS" },
  { name: "سكريبر", codePrefixes: ["SC"], defaultTrackingMode: "HOURS" },
  { name: "شاحنة", codePrefixes: ["TS", "TL"], defaultTrackingMode: "KM" },
  { name: "مركبة خفيفة", codePrefixes: ["PV"], defaultTrackingMode: "KM" },
  { name: "غير مصنف", codePrefixes: [], defaultTrackingMode: "BOTH" },
];

function codePrefix(code: string): string | null {
  const match = code.trim().match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : null;
}

function normalizePrefixes(prefixes: string[]): string[] {
  return [...new Set(prefixes.map((p) => p.trim().toUpperCase()).filter(Boolean))];
}

export async function ensureDefaultCategories() {
  const existing = await prisma.equipmentCategory.findMany({ select: { name: true } });
  const names = new Set(existing.map((c) => c.name));
  const missing = DEFAULT_CATEGORIES.filter((c) => !names.has(c.name));
  if (missing.length) {
    await prisma.equipmentCategory.createMany({
      data: missing.map((c) => ({
        name: c.name,
        codePrefixes: c.codePrefixes,
        defaultTrackingMode: c.defaultTrackingMode,
      })),
    });
  }
  return prisma.equipmentCategory.findMany({ orderBy: { id: "asc" } });
}

async function categoryByPrefixMap() {
  const categories = await ensureDefaultCategories();
  const map = new Map<string, (typeof categories)[number]>();
  for (const category of categories) {
    for (const prefix of category.codePrefixes) {
      map.set(prefix.toUpperCase(), category);
    }
  }
  return map;
}

async function resolveCategory(categoryId: number | null | undefined) {
  if (categoryId == null) return null;
  const category = await prisma.equipmentCategory.findUnique({ where: { id: categoryId } });
  if (!category) fail("فئة المعدة غير موجودة", 404);
  return category;
}

async function assertCategoryNameAvailable(name: string, excludeId?: number) {
  const duplicate = await prisma.equipmentCategory.findFirst({
    where: { name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (duplicate) fail("اسم الفئة مستخدم من قبل", 409);
}

async function assertPrefixesAvailable(prefixes: string[], excludeId?: number) {
  if (!prefixes.length) return;
  const duplicate = await prisma.equipmentCategory.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      codePrefixes: { hasSome: prefixes },
    },
    select: { name: true, codePrefixes: true },
  });
  if (duplicate) {
    const clash = prefixes.find((p) => duplicate.codePrefixes.includes(p));
    fail(`بادئة الكود ${clash ?? ""} مستخدمة في فئة «${duplicate.name}»`, 409);
  }
}

export async function listCategories() {
  await ensureDefaultCategories();
  return prisma.equipmentCategory.findMany({
    include: { _count: { select: { equipment: true } } },
    orderBy: { id: "asc" },
  });
}

export async function createCategory(
  data: { name: string; codePrefixes?: string[]; defaultTrackingMode?: TrackingMode },
  userId: number
) {
  const name = data.name.trim();
  const prefixes = normalizePrefixes(data.codePrefixes ?? []);
  await assertCategoryNameAvailable(name);
  await assertPrefixesAvailable(prefixes);
  const category = await prisma.equipmentCategory.create({
    data: {
      name,
      codePrefixes: prefixes,
      defaultTrackingMode: data.defaultTrackingMode ?? "BOTH",
    },
  });
  await logAudit(userId, "EquipmentCategory", category.id, "CREATE", { name });
  return category;
}

export async function updateCategory(
  id: number,
  data: { name?: string; codePrefixes?: string[]; defaultTrackingMode?: TrackingMode },
  userId: number
) {
  const existing = await prisma.equipmentCategory.findUnique({ where: { id } });
  if (!existing) fail("فئة المعدة غير موجودة", 404);

  const name = data.name !== undefined ? data.name.trim() : existing.name;
  const prefixes =
    data.codePrefixes !== undefined
      ? normalizePrefixes(data.codePrefixes)
      : existing.codePrefixes;
  if (data.name !== undefined) await assertCategoryNameAvailable(name, id);
  if (data.codePrefixes !== undefined) await assertPrefixesAvailable(prefixes, id);

  const category = await prisma.equipmentCategory.update({
    where: { id },
    data: {
      name,
      codePrefixes: prefixes,
      ...(data.defaultTrackingMode !== undefined
        ? { defaultTrackingMode: data.defaultTrackingMode }
        : {}),
    },
  });

  // تغيير الافتراضي يسري على المعدات التي لم تتجاوز وضع فئتها
  if (data.defaultTrackingMode !== undefined) {
    await prisma.equipment.updateMany({
      where: { categoryId: id, trackingModeOverridden: false },
      data: {
        trackingMode: data.defaultTrackingMode,
        trackingModeConfirmed: false,
      },
    });
  }

  await logAudit(userId, "EquipmentCategory", id, "UPDATE", data);
  return category;
}

export async function removeCategory(id: number, userId: number) {
  const existing = await prisma.equipmentCategory.findUnique({
    where: { id },
    include: { _count: { select: { equipment: true } } },
  });
  if (!existing) fail("فئة المعدة غير موجودة", 404);
  if (existing._count.equipment > 0) {
    fail("لا يمكن حذف فئة مرتبطة بمعدات", 409);
  }
  await prisma.equipmentCategory.delete({ where: { id } });
  await logAudit(userId, "EquipmentCategory", id, "DELETE", { name: existing.name });
  return { message: "تم حذف فئة المعدة" };
}

export async function lookup(code: string, scope?: number[] | null) {
  const own = scopeOr(scope);
  const results = await prisma.equipment.findMany({
    where: {
      AND: [
        {
          OR: [
            { code: { contains: code, mode: "insensitive" } },
            { name: { contains: code, mode: "insensitive" } },
          ],
        },
        ...(own ? [{ OR: own }] : []),
      ],
    },
    include: equipmentInclude,
    orderBy: { code: "asc" },
    take: 10,
  });

  const lower = code.toLowerCase();
  const sorted = results.sort((a, b) => {
    const aExact = a.code.toLowerCase() === lower ? 0 : 1;
    const bExact = b.code.toLowerCase() === lower ? 0 : 1;
    return aExact - bExact;
  });
  return await Promise.all(sorted.map(async (eq) => {
    let projectSectorId: number | null = null;
    if (eq.projectId != null && eq.sectorId != null) {
      const link = await prisma.projectSector.findFirst({
        where: { projectId: eq.projectId, sectorId: eq.sectorId, active: true },
        select: { id: true },
      });
      projectSectorId = link?.id ?? null;
    }
    return {
      ...eq,
      attestation: issueAttestation({
        equipmentId: eq.id,
        equipmentCode: eq.code,
        projectId: eq.projectId ?? null,
        projectCode: eq.project?.code ?? null,
        projectName: eq.project?.name ?? null,
        sectorId: eq.sectorId ?? null,
        sectorName: eq.sector?.name ?? null,
        projectSectorId,
      }),
    };
  }));
}

interface ListParams {
  q?: string;
  projectId?: number | null;
  page: number;
  pageSize: number;
  scope?: number[] | null;
}

export async function lastMeter(equipmentId: number, before?: string) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) {
    throw Object.assign(new Error("المعدة غير موجودة"), { status: 404 });
  }

  const dateFilter = before ? { date: { lt: new Date(before + "T00:00:00.000Z") } } : {};
  const [record, reset] = await Promise.all([
    prisma.dailyLog.findFirst({
      where: { equipmentId, endMeter: { not: null }, ...dateFilter },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { id: true, date: true, endMeter: true },
    }),
    prisma.meterReset.findFirst({
      where: { equipmentId, hours: { not: null }, ...dateFilter },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { id: true, date: true, hours: true },
    }),
  ]);

  if (!record && !reset) return null;
  if (reset && (!record || reset.date >= record.date)) {
    return {
      recordId: reset.id,
      date: reset.date.toISOString().slice(0, 10),
      meter: reset.hours,
    };
  }
  if (!record || record.endMeter === null) return null;

  return {
    recordId: record.id,
    date: record.date.toISOString().slice(0, 10),
    meter: record.endMeter,
  };
}

export async function listMeterResets(equipmentId: number) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) {
    throw Object.assign(new Error("المعدة غير موجودة"), { status: 404 });
  }
  return prisma.meterReset.findMany({
    where: { equipmentId },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
}

export async function createMeterReset(
  equipmentId: number,
  data: { date: string; hours?: number | null; km?: number | null; notes?: string | null },
  userId: number
) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) {
    throw Object.assign(new Error("المعدة غير موجودة"), { status: 404 });
  }
  const hoursApplicable = equipment.trackingMode !== "KM";
  const kmApplicable = equipment.trackingMode !== "HOURS";
  if (!hoursApplicable && data.hours != null) {
    fail("وضع تتبع هذه المعدة بالكيلومترات فقط — لا يمكن تصفير الساعات", 400);
  }
  if (!kmApplicable && data.km != null) {
    fail("وضع تتبع هذه المعدة بالساعات فقط — لا يمكن تصفير الكيلومترات", 400);
  }

  const record = await prisma.meterReset.create({
    data: {
      equipmentId,
      date: new Date(data.date + "T00:00:00.000Z"),
      hours: hoursApplicable ? (data.hours ?? null) : null,
      km: kmApplicable ? (data.km ?? null) : null,
      notes: data.notes ?? null,
    },
  });
  await logAudit(userId, "MeterReset", record.id, "CREATE", {
    equipmentId,
    date: data.date,
    hours: record.hours,
    km: record.km,
  });
  return record;
}

export async function list({ q, projectId, page, pageSize, scope }: ListParams) {
  const and: Prisma.EquipmentWhereInput[] = [];
  if (q) {
    and.push({
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (projectId) and.push({ projectId });
  const own = scopeOr(scope);
  if (own) and.push({ OR: own });
  const where: Prisma.EquipmentWhereInput = and.length ? { AND: and } : {};

  const [data, total] = await Promise.all([
    prisma.equipment.findMany({
      where,
      include: {
        ...equipmentInclude,
        _count: { select: { dailyLogs: true, maintenance: true, faults: true } },
      },
      orderBy: { code: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.equipment.count({ where }),
  ]);

  const dataWithAttestation = await Promise.all(data.map(async (eq) => {
    let projectSectorId: number | null = null;
    if (eq.projectId != null && eq.sectorId != null) {
      const link = await prisma.projectSector.findFirst({
        where: { projectId: eq.projectId, sectorId: eq.sectorId, active: true },
        select: { id: true },
      });
      projectSectorId = link?.id ?? null;
    }
    return {
      ...eq,
      attestation: issueAttestation({
        equipmentId: eq.id,
        equipmentCode: eq.code,
        projectId: eq.projectId ?? null,
        projectCode: eq.project?.code ?? null,
        projectName: eq.project?.name ?? null,
        sectorId: eq.sectorId ?? null,
        sectorName: eq.sector?.name ?? null,
        projectSectorId,
      }),
    };
  }));

  return { data: dataWithAttestation, total, page, pageSize };
}

export async function resolveProjectSector(projectId?: number | null, sectorId?: number | null) {
  let resolvedProjectId = projectId ?? null;

  if (sectorId) {
    const sector = await prisma.sector.findUnique({
      where: { id: sectorId },
      select: {
        projectId: true,
        projectSectors: { select: { projectId: true, active: true } },
      },
    });
    if (!sector) {
      throw Object.assign(new Error("القطاع غير موجود"), { status: 404 });
    }
    if (resolvedProjectId) {
      // القاعدة الانتقالية: أي صف ربط (نشط أو ملغي) بيلغي الرجوع للعمود القديم
      if (!isSectorMemberOfProject(sector, resolvedProjectId)) {
        throw Object.assign(new Error("القطاع لا ينتمي لهذا المشروع"), { status: 400 });
      }
    } else if (hasSectorAssociations(sector)) {
      resolvedProjectId = firstActiveProjectId(sector);
    } else {
      resolvedProjectId = sector.projectId;
    }
  }

  return { projectId: resolvedProjectId, sectorId: sectorId ?? null };
}

export async function create(
  data: {
    code: string;
    name: string;
    projectId?: number | null;
    sectorId?: number | null;
    categoryId?: number | null;
    trackingMode?: TrackingMode;
    trackingModeConfirmed?: boolean;
  },
  userId: number
) {
  const exists = await prisma.equipment.findUnique({ where: { code: data.code } });
  if (exists) {
    throw Object.assign(new Error("كود المعدة مستخدم من قبل"), { status: 409 });
  }

  const resolved = await resolveProjectSector(data.projectId, data.sectorId);

  let category =
    data.categoryId !== undefined ? await resolveCategory(data.categoryId) : undefined;
  if (category === undefined) {
    const byPrefix = await categoryByPrefixMap();
    const prefix = codePrefix(data.code);
    category = (prefix ? byPrefix.get(prefix) : undefined) ?? null;
  }

  const tracking = resolveTrackingSetup({
    category,
    explicitMode: data.trackingMode,
    explicitConfirmed: data.trackingModeConfirmed,
  });
  const trackingMode = tracking.trackingMode;

  const equipment = await prisma.equipment.create({
    data: {
      code: data.code,
      name: data.name,
      hasOdometer: trackingMode !== "HOURS",
      categoryId: category?.id ?? null,
      trackingMode,
      trackingModeOverridden: tracking.trackingModeOverridden,
      trackingModeConfirmed: tracking.trackingModeConfirmed,
      ...resolved,
    },
    include: equipmentInclude,
  });
  await logAudit(userId, "Equipment", equipment.id, "CREATE", {
    code: equipment.code,
    trackingMode,
    categoryId: category?.id ?? null,
  });
  return equipment;
}

export interface RegisterEquipmentInput {
  code: string;
  name: string;
  categoryId?: number | null;
  /** خيار «أخرى»: يُنشئ فئة بهذا الاسم (أو يعيد استخدام الموجودة) داخل نفس العملية. */
  newCategoryName?: string;
  trackingMode?: TrackingMode;
  trackingModeConfirmed?: boolean;
  projectId: number;
  sectorId?: number | null;
  meterHours?: number | null;
  meterKm?: number | null;
}

function assertMeterReading(value: number | null | undefined, label: string) {
  if (value == null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`قراءة ${label} غير صحيحة`, 400);
  }
  if (value < 0) {
    fail(`قراءة ${label} لا يمكن أن تكون سالبة`, 400);
  }
}

/**
 * تسجيل معدة جديدة مع تخصيصها الأولي وآخر قراءة للعداد (ROOT فقط في طبقة الراوت).
 *
 * - كل الكتابات (المعدة + التخصيص + نقطة بداية العداد) داخل Transaction واحدة.
 * - التخصيص يُسجَّل في EquipmentAssignment بمصدر EFMS_MANUAL وبداية = وقت الإنشاء
 *   الفعلي (بدون تاريخ وهمي وبدون Transfer).
 * - آخر قراءة تُحفظ في MeterReset فقط، ولا تُنشئ DailyLog.
 * - القطاع يجب أن يكون مرتبطًا بالمشروع عبر ProjectSector نشط — لا رجوع
 *   لـ Sector.projectId ولا إنشاء/تفعيل ربط تلقائي.
 */
export async function registerEquipment(data: RegisterEquipmentInput, userId: number) {
  const code = data.code.trim();
  const name = data.name.trim();

  const duplicate = await prisma.equipment.findUnique({
    where: { code },
    select: { id: true },
  });
  if (duplicate) {
    fail("كود المعدة مستخدم من قبل", 409);
  }

  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true },
  });
  if (!project) {
    fail("المشروع غير موجود", 404);
  }

  const sectorId = data.sectorId ?? null;
  let projectSectorId: number | null = null;
  if (sectorId != null) {
    const sector = await prisma.sector.findUnique({
      where: { id: sectorId },
      select: { id: true },
    });
    if (!sector) {
      fail("القطاع غير موجود", 404);
    }
    const link = await prisma.projectSector.findFirst({
      where: { projectId: data.projectId, sectorId, active: true },
      select: { id: true },
    });
    if (!link) {
      fail("القطاع لا ينتمي لهذا المشروع", 400);
    }
    projectSectorId = link.id;
  }

  if (data.categoryId != null && data.newCategoryName) {
    fail("اختر فئة موجودة أو أدخل اسم فئة جديدة — وليس الاثنين معًا", 400);
  }

  const newCategoryName = data.newCategoryName?.trim() ?? null;
  const existingCategory =
    data.categoryId !== undefined && data.categoryId !== null
      ? await resolveCategory(data.categoryId)
      : null;

  // فئة مشتقة من بادئة الكود (إن لم يختر المستخدم فئة ولم يكتب فئة جديدة).
  let prefixCategory: Awaited<ReturnType<typeof resolveCategory>> = null;
  if (!existingCategory && !newCategoryName) {
    const byPrefix = await categoryByPrefixMap();
    const prefix = codePrefix(code);
    prefixCategory = (prefix ? byPrefix.get(prefix) : undefined) ?? null;
  }

  const { equipment, meterReset, category, categoryCreated, trackingMode, hasBaseline, baselineDate } =
    await prisma.$transaction(async (tx) => {
      let resolvedCategory = existingCategory ?? prefixCategory;
      let createdCategory = false;

      // خيار «أخرى»: تُنشأ الفئة داخل نفس الـ transaction، أو يُعاد استخدام
      // فئة موجودة بنفس الاسم (الاسم فريد في قاعدة البيانات) بدون تكرار.
      if (!resolvedCategory && newCategoryName) {
        resolvedCategory =
          (await tx.equipmentCategory.findUnique({ where: { name: newCategoryName } })) ?? null;
        if (!resolvedCategory) {
          resolvedCategory = await tx.equipmentCategory.create({
            data: {
              name: newCategoryName,
              codePrefixes: [],
              defaultTrackingMode: data.trackingMode ?? "BOTH",
            },
          });
          createdCategory = true;
        }
      }

      const tracking = resolveTrackingSetup({
        category: resolvedCategory,
        explicitMode: data.trackingMode,
        explicitConfirmed: data.trackingModeConfirmed,
      });
      const mode = tracking.trackingMode;
      const hoursApplicable = mode !== "KM";
      const kmApplicable = mode !== "HOURS";

      assertMeterReading(data.meterHours, "العداد بالساعات");
      assertMeterReading(data.meterKm, "العداد بالكيلومترات");

      if (!hoursApplicable && data.meterHours != null) {
        fail("وضع تتبع هذه المعدة بالكيلومترات فقط — لا يمكن إدخال قراءة الساعات", 400);
      }
      if (!kmApplicable && data.meterKm != null) {
        fail("وضع تتبع هذه المعدة بالساعات فقط — لا يمكن إدخال قراءة الكيلومترات", 400);
      }

      const meterHours = hoursApplicable ? (data.meterHours ?? null) : null;
      const meterKm = kmApplicable ? (data.meterKm ?? null) : null;
      const baseline = meterHours != null || meterKm != null;
      const resetDate = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

      const created = await tx.equipment.create({
        data: {
          code,
          name,
          projectId: data.projectId,
          sectorId,
          categoryId: resolvedCategory?.id ?? null,
          trackingMode: mode,
          trackingModeOverridden: tracking.trackingModeOverridden,
          trackingModeConfirmed: tracking.trackingModeConfirmed,
          hasOdometer: mode !== "HOURS",
        },
        include: equipmentInclude,
      });

      await recordAssignment(
        {
          equipmentId: created.id,
          projectId: data.projectId,
          sectorId,
          projectSectorId,
          sourceSystem: ASSIGNMENT_SOURCES.EFMS_MANUAL,
          sourceReference: `registration:user:${userId}`,
          at: created.createdAt,
        },
        tx
      );

      let reset = null;
      if (baseline) {
        reset = await tx.meterReset.create({
          data: {
            equipmentId: created.id,
            date: resetDate,
            hours: meterHours,
            km: meterKm,
            notes: "آخر قراءة للعداد عند إضافة المعدة",
          },
        });
      }

      return {
        equipment: created,
        meterReset: reset,
        category: resolvedCategory,
        categoryCreated: createdCategory,
        trackingMode: mode,
        hasBaseline: baseline,
        baselineDate: resetDate,
      };
    });

  if (categoryCreated && category) {
    await logAudit(userId, "EquipmentCategory", category.id, "CREATE", {
      name: category.name,
      defaultTrackingMode: category.defaultTrackingMode,
      source: "equipment-register",
    });
  }

  await logAudit(userId, "Equipment", equipment.id, "CREATE", {
    code: equipment.code,
    name: equipment.name,
    trackingMode,
    categoryId: category?.id ?? null,
    projectId: data.projectId,
    sectorId,
    projectSectorId,
    source: "register",
  });
  if (meterReset) {
    await logAudit(userId, "MeterReset", meterReset.id, "CREATE", {
      equipmentId: equipment.id,
      date: baselineDate.toISOString().slice(0, 10),
      hours: meterReset.hours,
      km: meterReset.km,
      kind: "BASELINE_ON_REGISTER",
    });
  }

  return {
    equipment,
    meterReset,
    baselineDate: hasBaseline ? baselineDate.toISOString().slice(0, 10) : null,
    categoryCreated,
    assignment: {
      projectId: data.projectId,
      sectorId,
      projectSectorId,
      effectiveFrom: equipment.createdAt,
      sourceSystem: ASSIGNMENT_SOURCES.EFMS_MANUAL,
    },
  };
}

export async function update(
  id: number,
  data: Partial<{
    code: string;
    name: string;
    projectId: number | null;
    sectorId: number | null;
    categoryId: number | null;
    trackingMode: TrackingMode;
    trackingModeConfirmed: boolean;
  }>,
  userId: number
) {
  const existing = await prisma.equipment.findUnique({ where: { id } });
  if (!existing) {
    throw Object.assign(new Error("المعدة غير موجودة"), { status: 404 });
  }
  if (data.code && data.code !== existing.code) {
    const duplicate = await prisma.equipment.findUnique({ where: { code: data.code } });
    if (duplicate) {
      throw Object.assign(new Error("كود المعدة مستخدم من قبل"), { status: 409 });
    }
  }

  const resolved = await resolveProjectSector(
    data.projectId !== undefined ? data.projectId : existing.projectId,
    data.sectorId !== undefined ? data.sectorId : existing.sectorId
  );

  let categoryId = existing.categoryId;
  let categoryChanged = false;
  let category = existing.categoryId ? await resolveCategory(existing.categoryId) : null;
  if (data.categoryId !== undefined) {
    categoryChanged = data.categoryId !== existing.categoryId;
    categoryId = data.categoryId;
    category = await resolveCategory(data.categoryId);
  }

  let trackingMode = existing.trackingMode;
  let trackingModeOverridden = existing.trackingModeOverridden;
  let trackingModeConfirmed = existing.trackingModeConfirmed;

  if (data.trackingMode !== undefined) {
    trackingMode = data.trackingMode;
    trackingModeOverridden = true;
    trackingModeConfirmed = data.trackingModeConfirmed ?? true;
  } else if (categoryChanged) {
    if (category && !existing.trackingModeOverridden) {
      trackingMode = category.defaultTrackingMode;
    }
    trackingModeConfirmed = data.trackingModeConfirmed ?? false;
  } else if (data.trackingModeConfirmed !== undefined) {
    trackingModeConfirmed = data.trackingModeConfirmed;
  }

  const equipment = await prisma.equipment.update({
    where: { id },
    data: {
      code: data.code,
      name: data.name,
      ...resolved,
      categoryId,
      trackingMode,
      trackingModeOverridden,
      trackingModeConfirmed,
      hasOdometer: trackingMode !== "HOURS",
    },
    include: equipmentInclude,
  });
  if (existing.projectId !== resolved.projectId || existing.sectorId !== resolved.sectorId) {
    await recordAssignmentSafe({
      equipmentId: id,
      projectId: resolved.projectId ?? null,
      sectorId: resolved.sectorId ?? null,
      projectSectorId: await activeProjectSectorId(resolved.projectId ?? null, resolved.sectorId ?? null),
      sourceSystem: ASSIGNMENT_SOURCES.EFMS_MANUAL,
      sourceReference: `user:${userId}`,
    });
  }
  await logAudit(userId, "Equipment", id, "UPDATE", data);
  return equipment;
}

export async function trackingReview() {
  const rows = await prisma.equipment.findMany({
    include: {
      category: { select: { name: true, defaultTrackingMode: true } },
      project: { select: { name: true } },
      meterResets: { select: { hours: true, km: true } },
      _count: {
        select: {
          dailyLogs: { where: { endMeter: { not: null } } },
          maintenance: { where: { kmMeter: { not: null } } },
        },
      },
    },
    orderBy: { code: "asc" },
  });

  const review = rows
    .map((eq) => {
      const hasHoursData =
        eq._count.dailyLogs > 0 || eq.meterResets.some((r) => r.hours != null);
      const hasKmData =
        eq._count.maintenance > 0 || eq.meterResets.some((r) => r.km != null);
      const issues: string[] = [];

      if (eq.trackingMode === "HOURS" || eq.trackingMode === "BOTH") {
        if (!hasHoursData) issues.push("لا توجد قراءات ساعات مسجلة");
      }
      if (eq.trackingMode === "KM" || eq.trackingMode === "BOTH") {
        if (!hasKmData) issues.push("لا توجد قراءات كيلومترات مسجلة");
      }
      if (!eq.category) issues.push("لا توجد فئة محددة");
      else if (eq.category.name === UNCLASSIFIED_CATEGORY) issues.push("الفئة غير محددة");
      if (!eq.hasOdometer && eq.trackingMode !== "HOURS") {
        issues.push("عداد الكيلومترات كان معطلًا قبل الترحيل");
      }
      if (!eq.trackingModeConfirmed) issues.push("وضع التتبع غير مؤكد");

      return {
        equipmentId: eq.id,
        code: eq.code,
        name: eq.name,
        projectName: eq.project?.name ?? null,
        categoryId: eq.categoryId,
        categoryName: eq.category?.name ?? null,
        trackingMode: eq.trackingMode,
        trackingModeOverridden: eq.trackingModeOverridden,
        trackingModeConfirmed: eq.trackingModeConfirmed,
        hasHoursData,
        hasKmData,
        issues,
      };
    })
    .filter((row) => row.issues.length > 0);

  return {
    rows: review,
    summary: {
      total: rows.length,
      review: review.length,
      unconfirmed: rows.filter((r) => !r.trackingModeConfirmed).length,
    },
  };
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function extractList(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["data", "equipments", "equipment", "items", "results", "rows", "list"]) {
      const v = o[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const k2 of ["data", "items", "rows", "equipments", "list"]) {
          const v2 = (v as Record<string, unknown>)[k2];
          if (Array.isArray(v2)) return v2 as Record<string, unknown>[];
        }
      }
    }
  }
  return [];
}

function projectNameOf(raw: Record<string, unknown>): string | null {
  for (const key of ["project_name", "project", "projectName", "المشروع"]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const name = pickStr(v as Record<string, unknown>, ["name", "اسم", "title"]);
      if (name) return name;
    }
  }
  return null;
}

export interface ManagersSyncResult {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  projects: { id: number; name: string }[];
  sectors: number;
  errors: { code: string | null; message: string }[];
}

async function fetchAllManagersEquipments(baseUrl: string, token: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetch(`${baseUrl}/equipments?page=${page}&limit=100`, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw Object.assign(
        new Error(`نظام المدرين رجّع HTTP ${res.status}${text ? ` — ${text}` : ""}`),
        { status: 502 }
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    const batch = extractList(json);
    all.push(...batch);
    if (typeof json.total_pages === "number") totalPages = json.total_pages;
    else if (typeof json.total === "number" && typeof json.limit === "number") {
      totalPages = Math.ceil(json.total / json.limit);
    } else totalPages = page;
    page++;
  } while (page <= totalPages && page <= 50);

  return all;
}

export async function syncFromManagers(userId: number): Promise<ManagersSyncResult> {
  const baseUrl = (process.env.MANAGERS_API_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw Object.assign(new Error("لم يتم إعداد رابط نظام المدرين بعد (MANAGERS_API_URL)"), {
      status: 501,
    });
  }
  const token = (process.env.MANAGERS_API_TOKEN || "").trim();

  let list: Record<string, unknown>[];
  try {
    list = await fetchAllManagersEquipments(baseUrl, token);
  } catch (err) {
    if ((err as { status?: number }).status) throw err;
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    throw Object.assign(
      new Error(`تعذّر الاتصال بنظام المدرين${cause ? ` (${cause})` : ""}`),
      { status: 502 }
    );
  }

  const result: ManagersSyncResult = {
    fetched: list.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    projects: [],
    sectors: 0,
    errors: [],
  };

  const projectCache = new Map<string, number>();
  const sectorCache = new Map<string, number>();
  const touchedProjects = new Set<number>();
  const categoriesByPrefix = await categoryByPrefixMap();
  const unclassified = await prisma.equipmentCategory.findUnique({
    where: { name: UNCLASSIFIED_CATEGORY },
  });

  const resolveProject = async (name: string): Promise<number> => {
    const cached = projectCache.get(name);
    if (cached) return cached;
    const existing = await prisma.project.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    const id = existing
      ? existing.id
      : (await prisma.project.create({ data: { name } })).id;
    projectCache.set(name, id);
    touchedProjects.add(id);
    return id;
  };

  const resolveSector = async (name: string, projectId: number): Promise<number> => {
    const cacheKey = `${projectId}:${name}`;
    const cached = sectorCache.get(cacheKey);
    if (cached) return cached;
    const id = await ensureSectorLink(projectId, name);
    sectorCache.set(cacheKey, id);
    result.sectors++;
    return id;
  };

  for (const raw of list) {
    const code = pickStr(raw, ["equipment_code", "code", "equipmentCode", "كود", "كود_المعدة"]);
    if (!code) {
      if (result.errors.length < 30) result.errors.push({ code: null, message: "سجل بدون كود" });
      continue;
    }
    const name =
      pickStr(raw, ["equipment_type", "name", "equipmentName", "equipment_name", "اسم", "اسم_المعدة"]) || code;
    const projName = projectNameOf(raw);
    const sectorName = pickStr(raw, ["sector", "القطاع", "sector_name"]);

    try {
      const projectId = projName ? await resolveProject(projName) : null;
      let sectorId: number | null = null;
      if (projectId && sectorName) {
        sectorId = await resolveSector(sectorName, projectId);
      }

      const prefix = codePrefix(code);
      const category = (prefix ? categoriesByPrefix.get(prefix) : undefined) ?? unclassified;

      const existing = await prisma.equipment.findUnique({ where: { code } });
      if (existing) {
        // حماية: إذا كانت هناك عملية نقل معتمدة/مكتملة لهذه المعدة، لا نكتب فوق تخصيصها.
        const hasProtectedTransfer = await prisma.equipmentTransfer.findFirst({
          where: { equipmentId: existing.id, status: { in: ["APPROVED", "COMPLETED"] } },
          select: { id: true },
        });
        const needsName = name !== existing.name && name !== existing.code;
        const needsProject = !hasProtectedTransfer && projectId != null && existing.projectId !== projectId;
        const needsSector = !hasProtectedTransfer && sectorId != null && existing.sectorId !== sectorId;
        const needsCategory = !existing.categoryId && category != null;
        if (needsName || needsProject || needsSector || needsCategory) {
          await prisma.equipment.update({
            where: { id: existing.id },
            data: {
              ...(needsName ? { name } : {}),
              ...(needsProject ? { projectId } : {}),
              ...(needsSector ? { sectorId } : {}),
              ...(needsCategory
                ? {
                    categoryId: category.id,
                    trackingMode: category.defaultTrackingMode,
                    trackingModeOverridden: false,
                    trackingModeConfirmed: false,
                    hasOdometer: category.defaultTrackingMode !== "HOURS",
                  }
                : {}),
            },
          });
          if (needsProject || needsSector) {
            await recordAssignmentSafe({
              equipmentId: existing.id,
              projectId: needsProject ? projectId : existing.projectId,
              sectorId: needsSector ? sectorId : existing.sectorId,
              projectSectorId: await activeProjectSectorId(
                needsProject ? projectId : existing.projectId,
                needsSector ? sectorId : existing.sectorId
              ),
              sourceSystem: ASSIGNMENT_SOURCES.MANAGERS_SYNC,
              sourceReference: `equipment:${code}`,
            });
          }
          result.updated++;
        } else {
          result.unchanged++;
        }
      } else {
        const trackingMode = category?.defaultTrackingMode ?? "BOTH";
        await prisma.equipment.create({
          data: {
            code,
            name,
            projectId,
            sectorId,
            categoryId: category?.id ?? null,
            trackingMode,
            trackingModeOverridden: false,
            trackingModeConfirmed:
              category != null && category.name !== UNCLASSIFIED_CATEGORY,
            hasOdometer: trackingMode !== "HOURS",
          },
        });
        result.created++;
      }
    } catch (err) {
      if (result.errors.length < 30) {
        result.errors.push({
          code,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (touchedProjects.size) {
    result.projects = await prisma.project.findMany({
      where: { id: { in: [...touchedProjects] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  await logAudit(userId, "Equipment", 0, "UPDATE", {
    syncFromManagers: true,
    fetched: result.fetched,
    created: result.created,
    updated: result.updated,
  });

  return result;
}

export async function listAssignments(equipmentId: number) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { id: true } });
  if (!equipment) {
    throw Object.assign(new Error("المعدة غير موجودة"), { status: 404 });
  }
  try {
    return await listAssignmentHistory(equipmentId);
  } catch (err) {
    // The manual migration may not be applied yet. Report an empty history
    // instead of failing the whole equipment page.
    if ((err as { code?: string }).code === "P2021") {
      return [];
    }
    throw err;
  }
}
