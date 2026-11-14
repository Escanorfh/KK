/**
 * اختبارات تسجيل معدة جديدة (ROOT-only endpoint).
 * بديل Prisma في الذاكرة — مافيش سيرفر ولا قاعدة بيانات.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_equipment_register_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, any>;

interface State {
  projects: Row[];
  sectors: Row[];
  links: Row[];
  equipments: Row[];
  categories: Row[];
  assignments: Row[];
  meterResets: Row[];
  audits: Row[];
  seq: {
    project: number;
    sector: number;
    link: number;
    equipment: number;
    assignment: number;
    meterReset: number;
    category: number;
  };
}

let db: State;
let transferCalls = 0;
let dailyLogCalls = 0;
let failAssignment = false;

function reset(): State {
  db = {
    projects: [
      { id: 1, code: "100", name: "مشروع أ" },
      { id: 2, code: "200", name: "مشروع ب" },
    ],
    sectors: [
      { id: 10, name: "المخازن", projectId: 1 },
      { id: 11, name: "الورشة", projectId: 2 },
    ],
    links: [
      { id: 500, projectId: 1, sectorId: 10, active: true, normalizedName: "المخازن" },
      { id: 501, projectId: 2, sectorId: 11, active: true, normalizedName: "الورشة" },
    ],
    equipments: [],
    categories: [
      { id: 1, name: "غير مصنف", codePrefixes: [], defaultTrackingMode: "BOTH" },
    ],
    assignments: [],
    meterResets: [],
    audits: [],
    seq: { project: 2, sector: 100, link: 600, equipment: 900, assignment: 1000, meterReset: 2000, category: 100 },
  };
  transferCalls = 0;
  dailyLogCalls = 0;
  failAssignment = false;
  return db;
}

const prismaMock: any = {
  project: {
    findUnique: async ({ where }: any) =>
      db.projects.find((p) => p.id === where?.id) ?? null,
  },
  sector: {
    findUnique: async ({ where }: any) =>
      db.sectors.find((s) => s.id === where?.id) ?? null,
  },
  projectSector: {
    findFirst: async ({ where }: any) =>
      db.links.find(
        (l) =>
          l.projectId === where?.projectId &&
          l.sectorId === where?.sectorId &&
          (where?.active === undefined || l.active === where.active)
      ) ?? null,
  },
  equipmentCategory: {
    findMany: async () => db.categories.map((c) => ({ ...c })),
    findUnique: async ({ where }: any) => {
      if (where?.id != null) return db.categories.find((c) => c.id === where.id) ?? null;
      if (where?.name != null) return db.categories.find((c) => c.name === where.name) ?? null;
      return null;
    },
    create: async ({ data }: any) => {
      const row = { id: ++db.seq.category, ...data };
      db.categories.push(row);
      return { ...row };
    },
    createMany: async ({ data }: any) => {
      for (const item of data) db.categories.push({ id: ++db.seq.category, ...item });
      return { count: data.length };
    },
  },
  equipment: {
    findUnique: async ({ where }: any) =>
      db.equipments.find((e) => e.code === where?.code) ?? null,
    create: async ({ data }: any) => {
      const row = {
        id: ++db.seq.equipment,
        createdAt: new Date(),
        ...data,
      };
      db.equipments.push(row);
      return { ...row };
    },
  },
  equipmentAssignment: {
    findFirst: async ({ where }: any) =>
      db.assignments.find(
        (a) =>
          a.equipmentId === where?.equipmentId &&
          (where?.effectiveTo === null ? a.effectiveTo === null : true)
      ) ?? null,
    create: async ({ data }: any) => {
      if (failAssignment) throw new Error("assignment insert failed");
      const row = { id: ++db.seq.assignment, ...data };
      db.assignments.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = db.assignments.find((a) => a.id === where?.id);
      Object.assign(row!, data);
      return { ...row };
    },
  },
  meterReset: {
    create: async ({ data }: any) => {
      const row = { id: ++db.seq.meterReset, ...data };
      db.meterResets.push(row);
      return { ...row };
    },
  },
  equipmentTransfer: {
    create: async () => {
      transferCalls += 1;
      throw new Error("must not create a transfer");
    },
  },
  dailyLog: {
    create: async () => {
      dailyLogCalls += 1;
      throw new Error("must not create a daily log");
    },
  },
  auditLog: {
    create: async ({ data }: any) => {
      db.audits.push(data);
      return { id: db.audits.length, ...data };
    },
  },
  $transaction: async (fn: any) => {
    const snapshot = structuredClone(db);
    try {
      return await fn(prismaMock);
    } catch (err) {
      db = snapshot;
      throw err;
    }
  },
};

(globalThis as any).prisma = prismaMock;

const service = () => import("./equipment.service.js");

async function rejected(promise: Promise<unknown>, status: number) {
  const err = await promise.then(
    () => null,
    (e: any) => e
  );
  assert.ok(err, "المفروض العملية ترفض");
  assert.equal(err.status, status, err.message);
  return err;
}

const baseInput = () => ({
  code: "EX-105",
  name: "حفار كاتربيلر",
  categoryId: 1,
  trackingMode: "HOURS" as const,
  projectId: 1,
  sectorId: 10,
  meterHours: 1234.5 as number | null,
  meterKm: null as number | null,
});

/* ------------------------------ create ------------------------------ */

test("تسجيل معدة بمشروع وقطاع صحيحين يحفظ التخصيص وقراءة العداد", async () => {
  reset();
  const { registerEquipment } = await service();
  const result = await registerEquipment(baseInput(), 7);

  assert.equal(db.equipments.length, 1);
  const eq = db.equipments[0];
  assert.equal(eq.code, "EX-105");
  assert.equal(eq.name, "حفار كاتربيلر");
  assert.equal(eq.projectId, 1);
  assert.equal(eq.sectorId, 10);
  assert.equal(eq.trackingMode, "HOURS");

  assert.equal(db.assignments.length, 1);
  const assignment = db.assignments[0];
  assert.equal(assignment.equipmentId, eq.id);
  assert.equal(assignment.projectId, 1);
  assert.equal(assignment.sectorId, 10);
  assert.equal(assignment.projectSectorId, 500);
  assert.equal(assignment.sourceSystem, "EFMS_MANUAL");
  assert.equal(assignment.effectiveTo, null);
  assert.equal(
    new Date(assignment.effectiveFrom).getTime(),
    new Date(eq.createdAt).getTime(),
    "بداية التخصيص = وقت إنشاء المعدة"
  );

  assert.equal(db.meterResets.length, 1);
  assert.equal(db.meterResets[0].hours, 1234.5);
  assert.equal(db.meterResets[0].km, null);
  assert.equal(result.meterReset?.hours, 1234.5);
  assert.ok(result.baselineDate);
});

test("تسجيل معدة لا يُنشئ DailyLog ولا Transfer", async () => {
  reset();
  const { registerEquipment } = await service();
  await registerEquipment(baseInput(), 7);

  assert.equal(dailyLogCalls, 0, "مافيش سجل يومي");
  assert.equal(transferCalls, 0, "مافيش Transfer عند الإضافة");
  assert.equal(db.assignments.length, 1);
});

test("القطاع اختياري ويُقبل بدون قطاع", async () => {
  reset();
  const { registerEquipment } = await service();
  await registerEquipment({ ...baseInput(), sectorId: null }, 7);

  assert.equal(db.equipments[0].sectorId, null);
  assert.equal(db.assignments[0].sectorId, null);
  assert.equal(db.assignments[0].projectSectorId, null);
});

/* --------------------------- فئة جديدة «أخرى» --------------------------- */

test("خيار أخرى ينشئ فئة جديدة ويحفظ المعدة بها", async () => {
  reset();
  const { registerEquipment } = await service();
  const before = db.categories.length;

  const result = await registerEquipment(
    { ...baseInput(), categoryId: null, newCategoryName: "مولدات" },
    7
  );

  assert.equal(db.categories.length, before + 1, "فئة واحدة جديدة فقط");
  const category = db.categories.find((c) => c.name === "مولدات");
  assert.ok(category, "الفئة الجديدة اتحفظت في الاختيارات");
  assert.equal(category.defaultTrackingMode, "HOURS", "تأخذ وضع التتبع المختار");
  assert.equal(db.equipments[0].categoryId, category.id, "المعدة مربوطة بالفئة الجديدة");
  assert.equal(result.categoryCreated, true);
});

test("اسم فئة جديد مطابق لفئة موجودة يُعاد استخدامه بدون تكرار", async () => {
  reset();
  db.categories.push({ id: 50, name: "مولدات", codePrefixes: [], defaultTrackingMode: "KM" });
  const { registerEquipment } = await service();

  const result = await registerEquipment(
    { ...baseInput(), categoryId: null, newCategoryName: "مولدات" },
    7
  );

  assert.equal(
    db.categories.filter((c) => c.name === "مولدات").length,
    1,
    "مافيش فئة مكررة"
  );
  assert.equal(db.equipments[0].categoryId, 50);
  assert.equal(result.categoryCreated, false);
});

test("فشل التخصيص يرجّع الفئة الجديدة أيضًا (transaction)", async () => {
  reset();
  failAssignment = true;
  const { registerEquipment } = await service();

  await assert.rejects(() =>
    registerEquipment({ ...baseInput(), categoryId: null, newCategoryName: "مولدات" }, 7)
  );
  assert.equal(
    db.categories.find((c) => c.name === "مولدات"),
    undefined,
    "الفئة الجديدة ما اتحفظتش"
  );
  assert.equal(db.equipments.length, 0);
});

test("تمرير فئة موجودة واسم فئة جديدة معًا مرفوض", async () => {
  reset();
  const { registerEquipment } = await service();
  await rejected(registerEquipment({ ...baseInput(), newCategoryName: "مولدات" }, 7), 400);
  assert.equal(db.equipments.length, 0);
});

/* ----------------------------- validation ----------------------------- */

test("قطاع تابع لمشروع آخر مرفوض ولا يُنشئ معدة", async () => {
  reset();
  const { registerEquipment } = await service();
  // القطاع 11 مربوط بالمشروع 2 فقط
  await rejected(
    registerEquipment({ ...baseInput(), sectorId: 11 }, 7),
    400
  );
  assert.equal(db.equipments.length, 0);
  assert.equal(db.assignments.length, 0);
});

test("قطاع غير موجود → 404", async () => {
  reset();
  const { registerEquipment } = await service();
  await rejected(registerEquipment({ ...baseInput(), sectorId: 999 }, 7), 404);
  assert.equal(db.equipments.length, 0);
});

test("مشروع غير موجود → 404", async () => {
  reset();
  const { registerEquipment } = await service();
  await rejected(registerEquipment({ ...baseInput(), projectId: 999 }, 7), 404);
  assert.equal(db.equipments.length, 0);
});

test("كود معدة مكرر → 409", async () => {
  reset();
  db.equipments.push({ id: 77, code: "EX-105", name: "قديمة" });
  const { registerEquipment } = await service();
  await rejected(registerEquipment(baseInput(), 7), 409);
  assert.equal(db.equipments.length, 1);
});

test("قراءة عداد سالبة مرفوضة", async () => {
  reset();
  const { registerEquipment } = await service();
  await rejected(registerEquipment({ ...baseInput(), meterHours: -1 }, 7), 400);
  assert.equal(db.equipments.length, 0);
  assert.equal(db.meterResets.length, 0);
});

test("قراءة عداد غير رقمية مرفوضة", async () => {
  reset();
  const { registerEquipment } = await service();
  await rejected(
    registerEquipment({ ...baseInput(), meterHours: Number.POSITIVE_INFINITY }, 7),
    400
  );
  assert.equal(db.equipments.length, 0);
});

test("قراءة فارغة لا تُنشئ MeterReset", async () => {
  reset();
  const { registerEquipment } = await service();
  const result = await registerEquipment(
    { ...baseInput(), meterHours: null, meterKm: null },
    7
  );

  assert.equal(db.equipments.length, 1);
  assert.equal(db.meterResets.length, 0, "مافيش قراءة صفر تلقائية");
  assert.equal(result.meterReset, null);
  assert.equal(result.baselineDate, null);
});

test("فشل تسجيل EquipmentAssignment يرجّع كل العملية (transaction)", async () => {
  reset();
  failAssignment = true;
  const { registerEquipment } = await service();

  await assert.rejects(() => registerEquipment(baseInput(), 7), /assignment insert failed/);
  assert.equal(db.equipments.length, 0, "المعدة ما اتحفظتش");
  assert.equal(db.assignments.length, 0);
  assert.equal(db.meterResets.length, 0);
});

/* ------------------------------ units ------------------------------ */

test("وضع HOURS يحفظ القراءة في hours فقط", async () => {
  reset();
  const { registerEquipment } = await service();
  await registerEquipment(
    { ...baseInput(), trackingMode: "HOURS", meterHours: 12.25, meterKm: null },
    7
  );
  assert.equal(db.meterResets[0].hours, 12.25);
  assert.equal(db.meterResets[0].km, null);
});

test("وضع KM يحفظ القراءة في km فقط", async () => {
  reset();
  const { registerEquipment } = await service();
  await registerEquipment(
    { ...baseInput(), trackingMode: "KM", meterHours: null, meterKm: 789.75 },
    7
  );
  assert.equal(db.meterResets[0].km, 789.75);
  assert.equal(db.meterResets[0].hours, null);
});

test("وضع BOTH يحفظ الوحدتين", async () => {
  reset();
  const { registerEquipment } = await service();
  await registerEquipment(
    { ...baseInput(), trackingMode: "BOTH", meterHours: 10, meterKm: 20 },
    7
  );
  assert.equal(db.meterResets[0].hours, 10);
  assert.equal(db.meterResets[0].km, 20);
});

test("وضع KM يرفض قراءة الساعات", async () => {
  reset();
  const { registerEquipment } = await service();
  await rejected(
    registerEquipment(
      { ...baseInput(), trackingMode: "KM", meterHours: 10, meterKm: null },
      7
    ),
    400
  );
  assert.equal(db.equipments.length, 0);
});

test("وضع HOURS يرفض قراءة الكيلومترات", async () => {
  reset();
  const { registerEquipment } = await service();
  await rejected(
    registerEquipment(
      { ...baseInput(), trackingMode: "HOURS", meterHours: null, meterKm: 10 },
      7
    ),
    400
  );
  assert.equal(db.equipments.length, 0);
});
