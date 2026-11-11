/**
 * اختبارات اتساق حلّ القطاع/المشروع في المعدات مع قاعدة M:N الانتقالية.
 * بديل Prisma في الذاكرة + fetch مزيّف — مافيش سيرفر ولا قاعدة بيانات.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_equipment_sector_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArabic } from "../../utils/managers.js";

type Row = Record<string, any>;

interface State {
  projects: Row[];
  sectors: Row[];
  links: Row[];
  equipments: Row[];
  categories: Row[];
  audits: Row[];
  seq: { project: number; sector: number; link: number; equipment: number };
}

let db: State;

function reset(): State {
  db = {
    projects: [{ id: 1, name: "مشروع أ" }],
    sectors: [],
    links: [],
    equipments: [],
    categories: [
      { id: 1, name: "غير مصنف", codePrefixes: [], defaultTrackingMode: "BOTH" },
    ],
    audits: [],
    seq: { project: 1, sector: 100, link: 500, equipment: 900 },
  };
  return db;
}

const prismaMock: any = {
  project: {
    findFirst: async ({ where }: any) => {
      const target = String(where?.name?.equals ?? "").toLowerCase();
      return db.projects.find((p) => p.name.toLowerCase() === target) ?? null;
    },
    create: async ({ data }: any) => {
      const row = { id: ++db.seq.project, ...data };
      db.projects.push(row);
      return { ...row };
    },
    findMany: async ({ where }: any = {}) =>
      db.projects.filter((p) => !where?.id?.in || where.id.in.includes(p.id)).map((p) => ({ ...p })),
  },
  sector: {
    findUnique: async ({ where }: any) => {
      const row = db.sectors.find((s) => s.id === where.id);
      if (!row) return null;
      return {
        ...row,
        projectSectors: db.links
          .filter((l) => l.sectorId === row.id)
          .map((l) => ({ projectId: l.projectId, active: l.active })),
      };
    },
    findMany: async () => db.sectors.map((s) => ({ ...s })),
    create: async ({ data }: any) => {
      const row = { id: ++db.seq.sector, ...data };
      db.sectors.push(row);
      return { ...row };
    },
  },
  projectSector: {
    findMany: async ({ where }: any = {}) => {
      let rows = db.links;
      if (where?.projectId != null) rows = rows.filter((l) => l.projectId === where.projectId);
      if (where?.normalizedName != null) {
        rows = rows.filter((l) => l.normalizedName === where.normalizedName);
      }
      return rows.map((l) => ({ ...l }));
    },
    findUnique: async ({ where }: any = {}) => {
      const pair = where?.projectId_sectorId;
      if (!pair) return null;
      return (
        db.links.find(
          (l) => l.projectId === pair.projectId && l.sectorId === pair.sectorId
        ) ?? null
      );
    },
    create: async ({ data }: any) => {
      const row = { id: ++db.seq.link, ...data };
      db.links.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = db.links.find((l) => l.id === where.id);
      Object.assign(row!, data);
      return { ...row };
    },
  },
  equipment: {
    findUnique: async ({ where }: any) =>
      db.equipments.find((e) => e.code === where.code) ?? null,
    create: async ({ data }: any) => {
      const row = { id: ++db.seq.equipment, ...data };
      db.equipments.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = db.equipments.find((e) => e.id === where.id);
      Object.assign(row!, data);
      return { ...row };
    },
  },
  equipmentCategory: {
    findMany: async () => db.categories.map((c) => ({ ...c })),
    findUnique: async ({ where }: any) => {
      if (where?.id != null) return db.categories.find((c) => c.id === where.id) ?? null;
      if (where?.name != null) return db.categories.find((c) => c.name === where.name) ?? null;
      return null;
    },
    createMany: async ({ data }: any) => {
      for (const item of data) db.categories.push({ id: db.categories.length + 1, ...item });
      return { count: data.length };
    },
  },
  auditLog: {
    create: async ({ data }: any) => {
      db.audits.push(data);
      return { id: db.audits.length, ...data };
    },
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

/* ------------------------- resolveProjectSector ------------------------- */

test("resolveProjectSector: ربط M:N نشط مقبول", async () => {
  reset();
  db.sectors.push({ id: 10, name: "المخازن", projectId: 22 });
  db.links.push({ id: 1, projectId: 1, sectorId: 10, active: true, normalizedName: normalizeArabic("المخازن") });
  const { resolveProjectSector } = await service();
  assert.deepEqual(await resolveProjectSector(1, 10), { projectId: 1, sectorId: 10 });
});

test("resolveProjectSector: ربط ملغي مرفوض حتى لو العمود القديم مطابق", async () => {
  reset();
  db.sectors.push({ id: 10, name: "المخازن", projectId: 1 });
  db.links.push({ id: 1, projectId: 1, sectorId: 10, active: false, normalizedName: normalizeArabic("المخازن") });
  const { resolveProjectSector } = await service();
  await rejected(resolveProjectSector(1, 10), 400);
});

test("resolveProjectSector: قطاع قديم بلا روابط مقبول", async () => {
  reset();
  db.sectors.push({ id: 10, name: "المخازن", projectId: 1 });
  const { resolveProjectSector } = await service();
  assert.deepEqual(await resolveProjectSector(1, 10), { projectId: 1, sectorId: 10 });
});

test("resolveProjectSector: ربط مشروع آخر مرفوض", async () => {
  reset();
  db.sectors.push({ id: 10, name: "المخازن", projectId: 1 });
  db.links.push({ id: 1, projectId: 2, sectorId: 10, active: true, normalizedName: normalizeArabic("المخازن") });
  const { resolveProjectSector } = await service();
  await rejected(resolveProjectSector(1, 10), 400);
});

test("resolveProjectSector: من غير مشروع صريح بيستنتج أول ربط نشط فقط", async () => {
  reset();
  db.sectors.push({ id: 10, name: "المخازن", projectId: 22 });
  db.links.push({ id: 1, projectId: 2, sectorId: 10, active: true, normalizedName: normalizeArabic("المخازن") });
  db.links.push({ id: 2, projectId: 1, sectorId: 10, active: true, normalizedName: normalizeArabic("المخازن") });
  const { resolveProjectSector } = await service();
  assert.deepEqual(await resolveProjectSector(null, 10), { projectId: 1, sectorId: 10 });
});

test("resolveProjectSector: وجود ربط ملغي فقط يمنع الرجوع للعمود القديم", async () => {
  reset();
  db.sectors.push({ id: 10, name: "المخازن", projectId: 22 });
  db.links.push({ id: 1, projectId: 2, sectorId: 10, active: false, normalizedName: normalizeArabic("المخازن") });
  const { resolveProjectSector } = await service();
  assert.deepEqual(await resolveProjectSector(null, 10), { projectId: null, sectorId: 10 });
});

test("resolveProjectSector: قطاع غير موجود → 404", async () => {
  reset();
  const { resolveProjectSector } = await service();
  await rejected(resolveProjectSector(1, 999), 404);
});

/* --------------------- syncFromManagers + resolveSector --------------------- */

function fakeManagersFetch(records: Row[]) {
  return async () =>
    new Response(
      JSON.stringify({ data: records, total_pages: 1 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
}

test("مزامنة معدات: قطاع جديد بياخد ربط ProjectSector صحيح", async () => {
  reset();
  process.env.MANAGERS_API_URL = "http://127.0.0.1:1/managers";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeManagersFetch([
    {
      equipment_code: "EX-1",
      equipment_type: "حفار",
      project_name: "مشروع أ",
      sector: "المخازن",
    },
  ]) as never;

  try {
    const { syncFromManagers } = await service();
    const result = await syncFromManagers(1);

    assert.equal(result.fetched, 1);
    assert.equal(result.created, 1);
    assert.equal(result.sectors, 1);
    assert.equal(db.sectors.length, 1);
    assert.equal(db.links.length, 1);
    assert.equal(db.links[0].projectId, 1);
    assert.equal(db.links[0].sectorId, db.sectors[0].id);
    assert.equal(db.links[0].normalizedName, normalizeArabic("المخازن"));
    assert.equal(db.equipments[0].sectorId, db.sectors[0].id);
    assert.equal(db.equipments[0].projectId, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("مزامنة معدات: قطاع مشترك موجود لمشروع آخر بيتعاد استخدامه بلا تكرار", async () => {
  reset();
  db.projects.push({ id: 2, name: "مشروع ب" });
  db.sectors.push({ id: 10, name: "المخازن", projectId: 2 });
  db.links.push({
    id: 1,
    projectId: 2,
    sectorId: 10,
    active: true,
    normalizedName: normalizeArabic("المخازن"),
  });
  process.env.MANAGERS_API_URL = "http://127.0.0.1:1/managers";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeManagersFetch([
    {
      equipment_code: "LO-2",
      equipment_type: "لودر",
      project_name: "مشروع أ",
      sector: "المخازن",
    },
  ]) as never;

  try {
    const { syncFromManagers } = await service();
    await syncFromManagers(1);
    assert.equal(db.sectors.length, 1, "مافيش Sector جديد");
    assert.equal(db.sectors[0].id, 10);
    assert.equal(db.sectors[0].projectId, 2, "أصل القطاع القديم ما اتغيّرش");
    assert.equal(db.links.length, 2);
    assert.ok(
      db.links.some((l) => l.projectId === 1 && l.sectorId === 10),
      "الربط الجديد للمشروع 1"
    );
    assert.equal(db.equipments[0].sectorId, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("مزامنة معدات: نفس القطاع في سطرين بيتحل مرة واحدة (cache)", async () => {
  reset();
  process.env.MANAGERS_API_URL = "http://127.0.0.1:1/managers";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeManagersFetch([
    { equipment_code: "EX-1", project_name: "مشروع أ", sector: "المخازن" },
    { equipment_code: "EX-2", project_name: "مشروع أ", sector: "المخازن" },
  ]) as never;

  try {
    const { syncFromManagers } = await service();
    const result = await syncFromManagers(1);
    assert.equal(result.created, 2);
    assert.equal(result.sectors, 1, "resolveSector اتنادى مرة واحدة للاسم المكرر");
    assert.equal(db.sectors.length, 1);
    assert.equal(db.links.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
