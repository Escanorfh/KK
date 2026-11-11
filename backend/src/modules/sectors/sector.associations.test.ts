/**
 * اختبارات إدارة ربط القطاع بالمشاريع (Sector ↔ Project many-to-many).
 * قاعدة البيانات بديل كامل في الذاكرة — مافيش أي اتصال أو كتابة على قاعدة حقيقية.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_sector_assoc_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArabic } from "../../utils/managers.js";

type Row = Record<string, any>;

interface State {
  projects: Row[];
  sectors: Row[];
  projectSectors: Row[];
  audits: Row[];
  seq: { sector: number; projectSector: number };
  failProjectSectorCreate: boolean;
  sectorDeletes: number;
}

let db: State;

function reset(data: Partial<Pick<State, "projects" | "sectors" | "projectSectors">> = {}): State {
  db = {
    projects: data.projects ?? [
      { id: 1, code: "A", name: "مشروع أ" },
      { id: 2, code: "B", name: "مشروع ب" },
      { id: 3, code: "C", name: "مشروع ج" },
    ],
    sectors: data.sectors ?? [],
    projectSectors: data.projectSectors ?? [],
    audits: [],
    seq: { sector: 1000, projectSector: 5000 },
    failProjectSectorCreate: false,
    sectorDeletes: 0,
  };
  return db;
}

/* ----------------------------- محرّك مطابقة Where ----------------------------- */

const relations: Record<string, (row: Row) => unknown> = {
  projectSectors: (row) => db.projectSectors.filter((ps) => ps.sectorId === row.id),
  project: (row) => db.projects.find((p) => p.id === row.projectId) ?? null,
  sector: (row) => db.sectors.find((s) => s.id === row.sectorId) ?? null,
};

function matchCond(value: any, cond: any): boolean {
  if (cond === null) return value == null;
  if (Array.isArray(cond)) return cond.includes(value);
  if (typeof cond !== "object") return value === cond;
  if ("in" in cond) return cond.in.includes(value);
  if ("not" in cond) return value !== cond.not;
  if ("equals" in cond) return value === cond.equals;
  if ("some" in cond) return Array.isArray(value) && value.some((v) => matches(v, cond.some));
  if ("none" in cond) return Array.isArray(value) && value.every((v) => !matches(v, cond.none));
  return false;
}

function matches(row: Row, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return ([] as any[]).concat(cond).every((w) => matches(row, w));
    if (key === "OR") return ([] as any[]).concat(cond).some((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond);
    const value = relations[key] ? relations[key](row) : row[key];
    return matchCond(value, cond);
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const specs = ([] as any[]).concat(orderBy);
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      for (const [key, dir] of Object.entries(spec)) {
        const av = a[key];
        const bv = b[key];
        if (av === bv) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (dir === "desc" ? -1 : 1);
      }
    }
    return 0;
  });
}

/* --------------------------------- البديل --------------------------------- */

function sectorView(row: Row, include?: any): Row {
  const out = { ...row };
  if (include?._count) out._count = { equipment: 0 };
  if (include?.project) out.project = db.projects.find((p) => p.id === row.projectId) ?? null;
  if (include?.projectSectors) {
    let list = db.projectSectors.filter((ps) => ps.sectorId === row.id);
    if (include.projectSectors.where) list = list.filter((ps) => matches(ps, include.projectSectors.where));
    list = sortRows(list, include.projectSectors.orderBy);
    out.projectSectors = list.map((ps) => ({
      ...ps,
      project: db.projects.find((p) => p.id === ps.projectId) ?? null,
    }));
  }
  return out;
}

function projectSectorView(row: Row): Row {
  return { ...row, project: db.projects.find((p) => p.id === row.projectId) ?? null };
}

function uniqueProjectSector(where: any): Row | null {
  if (where?.projectId_sectorId) {
    const { projectId, sectorId } = where.projectId_sectorId;
    return db.projectSectors.find((ps) => ps.projectId === projectId && ps.sectorId === sectorId) ?? null;
  }
  if (where?.projectId_normalizedName) {
    const { projectId, normalizedName } = where.projectId_normalizedName;
    return (
      db.projectSectors.find(
        (ps) => ps.projectId === projectId && ps.normalizedName === normalizedName
      ) ?? null
    );
  }
  if (where?.id != null) return db.projectSectors.find((ps) => ps.id === where.id) ?? null;
  return null;
}

function snapshot(): Pick<State, "projects" | "sectors" | "projectSectors" | "audits" | "seq"> {
  return {
    projects: db.projects.map((r) => ({ ...r })),
    sectors: db.sectors.map((r) => ({ ...r })),
    projectSectors: db.projectSectors.map((r) => ({ ...r })),
    audits: db.audits.map((r) => ({ ...r })),
    seq: { ...db.seq },
  };
}

const prismaMock: any = {
  project: {
    findMany: async ({ where }: any = {}) => db.projects.filter((p) => matches(p, where)).map((p) => ({ ...p })),
    findUnique: async ({ where }: any) => {
      const row = db.projects.find((p) => p.id === where.id);
      return row ? { ...row } : null;
    },
  },
  sector: {
    findMany: async (args: any = {}) =>
      sortRows(
        db.sectors.filter((s) => matches(s, args.where)),
        args.orderBy
      ).map((s) => sectorView(s, args.include)),
    findFirst: async (args: any = {}) => {
      const row = db.sectors.filter((s) => matches(s, args.where))[0];
      return row ? sectorView(row, args.include) : null;
    },
    findUnique: async (args: any = {}) => {
      const row = db.sectors.find((s) => s.id === args.where.id);
      return row ? sectorView(row, args.include) : null;
    },
    create: async ({ data }: any) => {
      const row = { id: ++db.seq.sector, ...data };
      db.sectors.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = db.sectors.find((s) => s.id === where.id);
      if (!row) throw new Error("sector not found");
      Object.assign(row, data);
      return { ...row };
    },
    delete: async ({ where }: any) => {
      db.sectorDeletes++;
      const index = db.sectors.findIndex((s) => s.id === where.id);
      if (index >= 0) db.sectors.splice(index, 1);
      return { id: where.id };
    },
  },
  projectSector: {
    findMany: async (args: any = {}) =>
      sortRows(
        db.projectSectors.filter((ps) => matches(ps, args.where)),
        args.orderBy
      ).map(projectSectorView),
    findFirst: async (args: any = {}) => {
      const row = db.projectSectors.filter((ps) => matches(ps, args.where))[0];
      return row ? projectSectorView(row) : null;
    },
    findUnique: async ({ where }: any) => {
      const row = uniqueProjectSector(where);
      return row ? projectSectorView(row) : null;
    },
    create: async ({ data }: any) => {
      if (db.failProjectSectorCreate) {
        db.failProjectSectorCreate = false;
        throw new Error("simulated association failure");
      }
      const pairTaken = db.projectSectors.some(
        (ps) => ps.projectId === data.projectId && ps.sectorId === data.sectorId
      );
      const nameTaken = db.projectSectors.some(
        (ps) => ps.projectId === data.projectId && ps.normalizedName === data.normalizedName
      );
      if (pairTaken || nameTaken) throw new Error("unique constraint violation");
      const row = { id: ++db.seq.projectSector, active: true, ...data };
      db.projectSectors.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = db.projectSectors.find((ps) => ps.id === where.id);
      if (!row) throw new Error("projectSector not found");
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      const list = db.projectSectors.filter((ps) => matches(ps, where));
      for (const row of list) Object.assign(row, data);
      return { count: list.length };
    },
  },
  auditLog: {
    create: async ({ data }: any) => {
      db.audits.push({ ...data });
      return { id: db.audits.length, ...data };
    },
  },
  dailyLog: {
    aggregate: async () => ({ _max: { date: null } }),
    findMany: async () => [],
  },
  $transaction: async (fn: any) => {
    const before = snapshot();
    try {
      return await fn(prismaMock);
    } catch (err) {
      db.projects = before.projects;
      db.sectors = before.sectors;
      db.projectSectors = before.projectSectors;
      db.audits = before.audits;
      db.seq = before.seq;
      throw err;
    }
  },
};

(globalThis as any).prisma = prismaMock;

const service = () => import("./sector.service.js");

async function rejected(promise: Promise<unknown>, status: number) {
  const err = await promise.then(
    () => null,
    (e: any) => e
  );
  assert.ok(err, "المفروض العملية ترفض");
  assert.equal(err.status, status, err.message);
  return err;
}

/* --------------------------------- الاختبارات --------------------------------- */

test("١) إنشاء قطاع مربوط بمشروع واحد", async () => {
  reset();
  const mod = await service();
  const result = await mod.create({ name: "المخازن", projectId: 1 }, 5, null);

  assert.equal(db.sectors.length, 1);
  assert.equal(db.projectSectors.length, 1);
  assert.equal(db.projectSectors[0].projectId, 1);
  assert.equal(db.projectSectors[0].sectorId, result.id);
  assert.equal(db.projectSectors[0].active, true);
  assert.equal(db.projectSectors[0].normalizedName, normalizeArabic("المخازن"));
  assert.equal((result as any).projectId, 1, "العمود القديم بيتسجل كأصل أول مشروع");
  assert.equal((result as any).projects.length, 1);
});

test("٢) إنشاء قطاع مربوط بأكثر من مشروع في معاملة واحدة", async () => {
  reset();
  const mod = await service();
  const result = await mod.create({ name: "الورشة", projectIds: [1, 2] }, 5, null);

  assert.equal(db.sectors.length, 1);
  assert.equal(db.projectSectors.length, 2);
  assert.deepEqual(
    db.projectSectors.map((ps) => ps.projectId).sort(),
    [1, 2]
  );
  assert.ok(db.projectSectors.every((ps) => ps.sectorId === result.id && ps.active));
  assert.equal((result as any).projects.length, 2);
});

test("٣) ربط قطاع موجود بمشروع ثانٍ مع الحفاظ على نفس المعرّف", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
    projectSectors: [{ id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true }],
  });
  const mod = await service();
  const result = await mod.associateToProject(1, 2, 5, null);

  assert.equal(result.sectorId, 1);
  assert.equal(result.projectId, 2);
  assert.equal(db.sectors.length, 1, "مافيش قطاع جديد");
  assert.equal(db.sectors[0].id, 1, "المعرّف محفوظ");
  assert.equal(db.projectSectors.length, 2);
});

test("٤) طلب ربط مكرر لنفس المشروع → رفض 409 من غير تكرار", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
    projectSectors: [{ id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true }],
  });
  const mod = await service();
  const err = await rejected(mod.associateToProject(1, 1, 5, null), 409);
  assert.match(err.message, /مرتبط بالمشروع ده من قبل/);
  assert.equal(db.projectSectors.length, 1);
});

test("٥) منع تكرار الاسم المطبّع داخل نفس المشروع (قطاع مختلف)", async () => {
  const normalized = normalizeArabic("المخازن");
  reset({
    sectors: [
      { id: 1, name: "المخازن", projectId: 1 },
      { id: 2, name: "المخازن", projectId: 2 },
    ],
    projectSectors: [{ id: 10, projectId: 1, sectorId: 1, normalizedName: normalized, active: true }],
  });
  const mod = await service();
  const err = await rejected(mod.associateToProject(2, 1, 5, null), 409);
  assert.match(err.message, /بنفس الاسم/);
  assert.equal(db.projectSectors.length, 1, "مافيش ربط جديد اتعمل");
});

test("٦) نفس الاسم المطبّع مسموح في مشروع مختلف مع إعادة استخدام نفس القطاع", async () => {
  reset();
  const mod = await service();
  const first = await mod.create({ name: "المخازن", projectId: 1 }, 5, null);
  const second = await mod.create({ name: "المخازن", projectId: 2 }, 5, null);

  assert.equal(second.id, first.id, "نفس سجل القطاع بيتعاد استخدامه");
  assert.equal(db.sectors.length, 1, "مافيش سجل قطاع مكرر");
  assert.equal(db.projectSectors.length, 2);
  assert.deepEqual(
    db.projectSectors.map((ps) => ps.projectId).sort(),
    [1, 2]
  );
});

test("٧) مستخدم غير مصرّح لا يربط قطاعًا بمشروع خارج نطاقه", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
    projectSectors: [{ id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true }],
  });
  const mod = await service();

  const err = await rejected(mod.associateToProject(1, 2, 5, [1]), 403);
  assert.match(err.message, /خارج نطاق صلاحيتك/);
  assert.equal(db.projectSectors.length, 1, "مافيش ربط خارج النطاق");

  await rejected(mod.create({ name: "الورشة", projectIds: [1, 2] }, 5, [1]), 403);
  assert.equal(db.sectors.length, 1, "مافيش قطاع جديد اتكتب");
  assert.equal(db.projectSectors.length, 1);
});

test("٨) إلغاء الربط لا يحذف القطاع", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
    projectSectors: [{ id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true }],
  });
  const mod = await service();
  const result = await mod.removeFromProject(1, 1, 5, null);

  assert.equal((result as any).active, false);
  assert.equal(db.sectors.length, 1, "القطاع باقٍ");
  assert.equal(db.sectorDeletes, 0, "مافيش delete على القطاع");
  assert.equal(db.projectSectors[0].active, false, "soft-delete على صف الربط فقط");
});

test("٩) إلغاء الربط يحافظ على السجل التاريخي ولا يحذف أي بيانات تشغيل", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
    projectSectors: [{ id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true }],
  });
  const mod = await service();
  await mod.removeFromProject(1, 1, 5, null);

  assert.equal(db.sectorDeletes, 0);
  assert.equal(db.sectors[0].id, 1);
  assert.equal(db.projectSectors.length, 1, "صف الربط محفوظ للـFKs التاريخية");
  assert.equal(db.projectSectors[0].active, false);
  const audit = db.audits.find((a) => a.details?.removedProjectId === 1);
  assert.ok(audit, "الإلغاء متسجل في الـAuditLog");
});

test("٩ب) إلغاء ربط مشروع لا يمس ربط مشروع آخر ولا يحذف القطاع", async () => {
  reset({
    sectors: [
      {
        id: 1,
        name: "المخازن",
        projectId: 1,
        // سجلات تشغيلية/تاريخية موجودة على القطاع — إلغاء الربط ما بيقرأهاش أصلًا
        equipment: [{ id: 50 }],
        dailyLogs: [{ id: 60 }],
        maintenance: [{ id: 70 }],
        faults: [{ id: 71 }],
        needRequests: [{ id: 80 }],
        repairOrders: [{ id: 90 }],
      },
    ],
    projectSectors: [
      { id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true },
      { id: 11, projectId: 2, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true },
    ],
  });
  const mod = await service();
  const result = await mod.removeFromProject(1, 1, 5, null);

  assert.equal((result as any).active, false);
  const first = db.projectSectors.find((ps) => ps.id === 10)!;
  const second = db.projectSectors.find((ps) => ps.id === 11)!;
  assert.equal(first.active, false, "الربط المطلوب فقط اتلغى");
  assert.equal(second.active, true, "ربط المشروع الآخر ما اتلمسش");
  assert.equal(db.projectSectors.length, 2, "الصفوف محفوظة للـFKs التاريخية");
  assert.equal(db.sectors.length, 1, "القطاع باقٍ");
  const sector = db.sectors[0];
  assert.equal(sector.equipment.length, 1, "سجلات المعدات باقية");
  assert.equal(sector.dailyLogs.length, 1, "السجلات اليومية باقية");
  assert.equal(sector.maintenance.length, 1, "أوامر الشغل باقية");
  assert.equal(sector.faults.length, 1, "الأعطال باقية");
  assert.equal(sector.needRequests.length, 1, "طلبات الاحتياج باقية");
  assert.equal(sector.repairOrders.length, 1, "أوامر الإصلاح باقية");
  assert.equal(db.sectorDeletes, 0, "مافيش delete على القطاع");
});

test("٩ج) إلغاء ربط غير نشط أو غير موجود → 404 من غير أي كتابة", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
    projectSectors: [
      { id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: false },
    ],
  });
  const mod = await service();
  await rejected(mod.removeFromProject(1, 1, 5, null), 404);
  assert.equal(db.projectSectors[0].active, false, "الحالة ما اتغيرتش");
  assert.equal(db.sectorDeletes, 0);
  assert.equal(db.audits.length, 0);

  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
  });
  await rejected(mod.removeFromProject(1, 1, 5, null), 404);
  assert.equal(db.projectSectors.length, 0, "مافيش صف ربط اتعمل");
  assert.equal(db.audits.length, 0);
});

test("٩د) إلغاء ربط مشروع خارج نطاق المستخدم → 403 من غير أي كتابة", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
    projectSectors: [
      { id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true },
    ],
  });
  const mod = await service();
  const err = await rejected(mod.removeFromProject(1, 1, 5, [2]), 403);
  assert.match(err.message, /خارج نطاق صلاحيتك/);
  assert.equal(db.projectSectors[0].active, true, "مافيش إلغاء خارج النطاق");
  assert.equal(db.audits.length, 0);
});

test("١٠) فشل المعاملة ما بيسيبش ربطًا جزئيًا", async () => {
  reset();
  db.failProjectSectorCreate = true;
  const mod = await service();

  await assert.rejects(mod.create({ name: "ورشة جديدة", projectIds: [1, 2] }, 5, null), /simulated/);
  assert.equal(db.sectors.length, 0, "القطاع اللي اتعمل جوه المعاملة اترجع");
  assert.equal(db.projectSectors.length, 0, "مافيش ربط جزئي");
});

test("١١) توافق قائمة القطاعات القديمة مع الأعمدة القديمة والربط الجديد", async () => {
  reset({
    sectors: [
      { id: 1, name: "قديم", projectId: 1 },
      { id: 2, name: "ملغي", projectId: 1 },
      { id: 3, name: "مشترك", projectId: 2 },
    ],
    projectSectors: [
      { id: 10, projectId: 1, sectorId: 2, normalizedName: normalizeArabic("ملغي"), active: false },
      { id: 11, projectId: 2, sectorId: 3, normalizedName: normalizeArabic("مشترك"), active: true },
    ],
  });
  const mod = await service();

  const legacyOnly = await mod.listProjectSectors(1, null);
  assert.deepEqual(legacyOnly.map((s: any) => s.id), [1], "القطاع القديم بدون صف ربط يظهر، والملغي لا يظهر");

  const viaAssociation = await mod.listProjectSectors(2, null);
  assert.deepEqual(viaAssociation.map((s: any) => s.id), [3]);
});

test("١٢) سلوك ROOT/ADMIN: بلا تضييق نطاق يقدر يربط بأي مشروع", async () => {
  reset();
  const mod = await service();
  const created = await mod.create({ name: "التشغيل", projectIds: [1, 2] }, 1, null);
  const linked = await mod.associateToProject(created.id, 3, 1, null);

  assert.equal(linked.projectId, 3);
  assert.equal(db.projectSectors.length, 3);
  const projects = await mod.listSectorProjects(created.id, null);
  assert.deepEqual(projects.map((p: any) => p.projectId), [1, 2, 3]);
});

test("اسم فارغ أو مسافات فقط → 400", async () => {
  reset();
  const mod = await service();
  await rejected(mod.create({ name: "   ", projectId: 1 }, 5, null), 400);
  assert.equal(db.sectors.length, 0);
});

test("قراءة قطاعات المدرين لمشروع خارج النطاق → 403", async () => {
  reset();
  const mod = await service();
  const err = await rejected(mod.managersRooms(2, [1]), 403);
  assert.match(err.message, /خارج نطاق|غير مصرح/);
});

test("قائمة مشاريع القطاع لا تكشف مشاريع خارج نطاق المستخدم", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 1 }],
    projectSectors: [
      { id: 10, projectId: 1, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true },
      { id: 11, projectId: 2, sectorId: 1, normalizedName: normalizeArabic("المخازن"), active: true },
    ],
  });
  const mod = await service();

  const visible = await mod.listSectorProjects(1, [1]);
  assert.deepEqual(visible.map((p: any) => p.projectId), [1], "مافيش كشف للمشروع ٢");

  await rejected(mod.listProjectSectors(2, [1]), 403);
});

test("قطاع أو مشروع غير موجود → 404", async () => {
  reset();
  const mod = await service();
  await rejected(mod.associateToProject(999, 1, 5, null), 404);
  await rejected(mod.create({ name: "قطاع", projectId: 999 }, 5, null), 404);
});
