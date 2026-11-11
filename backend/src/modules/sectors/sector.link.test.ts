/**
 * اختبارات المساعد المشترك ensureSectorLink — بديل Prisma كامل في الذاكرة.
 * مافيش اتصال قاعدة بيانات ولا كتابة على أي بيانات حقيقية.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_sector_link_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArabic } from "../../utils/managers.js";

type Row = Record<string, any>;

interface State {
  sectors: Row[];
  links: Row[];
  seq: { sector: number; link: number };
  failNextLinkCreate: boolean;
}

let db: State;

function reset(data: Partial<Pick<State, "sectors" | "links">> = {}): State {
  db = {
    sectors: data.sectors ?? [],
    links: data.links ?? [],
    seq: { sector: 100, link: 500 },
    failNextLinkCreate: false,
  };
  return db;
}

function clone<T>(row: T): T {
  return { ...row };
}

const prismaMock: any = {
  sector: {
    findMany: async ({ orderBy }: any = {}) => {
      const rows = [...db.sectors];
      if (orderBy?.id === "asc") rows.sort((a, b) => a.id - b.id);
      return rows.map(clone);
    },
    create: async ({ data }: any) => {
      const row = { id: ++db.seq.sector, ...data };
      db.sectors.push(row);
      return clone(row);
    },
  },
  projectSector: {
    findMany: async ({ where }: any = {}) => {
      let rows = db.links;
      if (where?.projectId != null) rows = rows.filter((l) => l.projectId === where.projectId);
      if (where?.normalizedName != null) {
        rows = rows.filter((l) => l.normalizedName === where.normalizedName);
      }
      return rows.sort((a, b) => a.id - b.id).map(clone);
    },
    findUnique: async ({ where }: any = {}) => {
      const pair = where?.projectId_sectorId;
      if (!pair) return null;
      const row = db.links.find(
        (l) => l.projectId === pair.projectId && l.sectorId === pair.sectorId
      );
      return row ? clone(row) : null;
    },
    update: async ({ where, data }: any) => {
      const row = db.links.find((l) => l.id === where.id);
      if (!row) throw new Error("link not found");
      Object.assign(row, data);
      return clone(row);
    },
    create: async ({ data }: any) => {
      if (db.failNextLinkCreate) {
        db.failNextLinkCreate = false;
        throw Object.assign(new Error("unique"), {
          name: "PrismaClientKnownRequestError",
          code: "P2002",
          meta: { target: ["projectId", "normalizedName"] },
        });
      }
      const pairTaken = db.links.some(
        (l) => l.projectId === data.projectId && l.sectorId === data.sectorId
      );
      const nameTaken = db.links.some(
        (l) => l.projectId === data.projectId && l.normalizedName === data.normalizedName
      );
      if (pairTaken || nameTaken) {
        throw Object.assign(new Error("unique"), {
          name: "PrismaClientKnownRequestError",
          code: "P2002",
          meta: { target: ["projectId", "sectorId"] },
        });
      }
      const row = { id: ++db.seq.link, active: true, ...data };
      db.links.push(row);
      return clone(row);
    },
  },
};

(globalThis as any).prisma = prismaMock;

async function rejected(promise: Promise<unknown>, status: number) {
  const err = await promise.then(
    () => null,
    (e: any) => e
  );
  assert.ok(err, "المفروض العملية ترفض");
  assert.equal(err.status, status, err.message);
  return err;
}

const service = () => import("./sector.service.js");

test("ينشئ قطاعًا جديدًا + ربط ProjectSector مطبع، ويحفظ الأصل القديم", async () => {
  reset();
  const { ensureSectorLink } = await service();
  const id = await ensureSectorLink(11, "  قطاع المخازن  ");

  assert.equal(db.sectors.length, 1);
  assert.equal(db.sectors[0].id, id);
  assert.equal(db.sectors[0].name, "قطاع المخازن");
  assert.equal(db.sectors[0].projectId, 11);
  assert.equal(db.links.length, 1);
  assert.equal(db.links[0].projectId, 11);
  assert.equal(db.links[0].sectorId, id);
  assert.equal(db.links[0].normalizedName, normalizeArabic("قطاع المخازن"));
  assert.equal(db.links[0].active, true);
});

test("يرجع نفس القطاع لو الربط النشط موجود بنفس الاسم المطبع", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 11 }],
    links: [
      {
        id: 10,
        projectId: 11,
        sectorId: 1,
        normalizedName: normalizeArabic("المخازن"),
        active: true,
      },
    ],
  });
  const { ensureSectorLink } = await service();
  const id = await ensureSectorLink(11, "المخازن");
  assert.equal(id, 1);
  assert.equal(db.sectors.length, 1);
  assert.equal(db.links.length, 1);
});

test("يعيد تفعيل الربط الملغي لنفس القطاع بدل إنشاء نسخة", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 11 }],
    links: [
      {
        id: 10,
        projectId: 11,
        sectorId: 1,
        normalizedName: normalizeArabic("المخازن"),
        active: false,
      },
    ],
  });
  const { ensureSectorLink } = await service();
  const id = await ensureSectorLink(11, "المخازن");
  assert.equal(id, 1);
  assert.equal(db.links.length, 1);
  assert.equal(db.links[0].active, true);
});

test("يعيد استخدام قطاع موجود لمشروع آخر بنفس الاسم ولا يغيّر أصله القديم", async () => {
  reset({
    sectors: [{ id: 1, name: "المخازن", projectId: 22 }],
    links: [
      {
        id: 10,
        projectId: 22,
        sectorId: 1,
        normalizedName: normalizeArabic("المخازن"),
        active: true,
      },
    ],
  });
  const { ensureSectorLink } = await service();
  const id = await ensureSectorLink(11, "المخازن");
  assert.equal(id, 1, "نفس معرّف القطاع");
  assert.equal(db.sectors.length, 1, "مافيش قطاع جديد");
  assert.equal(db.sectors[0].projectId, 22, "أصل القطاع القديم ما اتغيّرش");
  assert.equal(db.links.length, 2);
  assert.equal(db.links[1].projectId, 11);
  assert.equal(db.links[1].sectorId, 1);
});

test("نداءان متتاليان لنفس المشروع لا ينشئان تكرارًا", async () => {
  reset();
  const { ensureSectorLink } = await service();
  const first = await ensureSectorLink(11, "الورشة");
  const second = await ensureSectorLink(11, "الورشة");
  assert.equal(first, second);
  assert.equal(db.sectors.length, 1);
  assert.equal(db.links.length, 1);
});

test("لا ينشئ قطاعًا ثانيًا لو فيه ربط نشط بنفس الاسم المطبع لقطاع مختلف", async () => {
  reset({
    sectors: [
      { id: 1, name: "المخازن", projectId: 22 },
      { id: 2, name: "مخزن", projectId: 33 },
    ],
    links: [
      {
        id: 10,
        projectId: 11,
        sectorId: 1,
        normalizedName: normalizeArabic("المخازن"),
        active: true,
      },
    ],
    // لاحظ: الاسم "مخزن" يطبع لمختلف، فمش تعارض
  });
  const { ensureSectorLink } = await service();
  const id = await ensureSectorLink(11, "المخازن");
  assert.equal(id, 1);
  assert.equal(db.sectors.length, 2);
  assert.equal(db.links.length, 1);
});

test("اسم فارغ أو غير صالح بعد التطبيع → 400", async () => {
  reset();
  const { ensureSectorLink } = await service();
  await rejected(ensureSectorLink(11, "   "), 400);
  await rejected(ensureSectorLink(11, "---"), 400);
  assert.equal(db.sectors.length, 0);
  assert.equal(db.links.length, 0);
});

test("يستخدم transaction العميل لو اتبعت (مافيش nested transaction)", async () => {
  reset();
  const { ensureSectorLink } = await service();
  const calls: string[] = [];
  const tx: any = {
    sector: {
      findMany: async () => {
        calls.push("tx.sector.findMany");
        return [];
      },
      create: async ({ data }: any) => {
        calls.push("tx.sector.create");
        const row = { id: 900, ...data };
        db.sectors.push(row);
        return clone(row);
      },
    },
    projectSector: {
      findMany: async () => {
        calls.push("tx.projectSector.findMany");
        return [];
      },
      findUnique: async () => {
        calls.push("tx.projectSector.findUnique");
        return null;
      },
      create: async ({ data }: any) => {
        calls.push("tx.projectSector.create");
        const row = { id: 901, ...data };
        db.links.push(row);
        return clone(row);
      },
      update: async () => {
        throw new Error("should not update");
      },
    },
    $transaction: async () => {
      throw new Error("ما ينفعش يبدأ transaction جوه transaction");
    },
  };

  const id = await ensureSectorLink(11, "الورشة", tx);
  assert.equal(id, 900);
  assert.deepEqual(calls, [
    "tx.projectSector.findMany",
    "tx.sector.findMany",
    "tx.sector.create",
    "tx.projectSector.create",
  ]);
});

test("سباق القيد الفريد بينتشر كخطأ Prisma بدل كتمانه", async () => {
  reset();
  db.failNextLinkCreate = true;
  const { ensureSectorLink } = await service();
  const { mapPrismaError } = await import("../../utils/prismaError.js");
  const err = await ensureSectorLink(11, "المخازن").then(
    () => null,
    (e: unknown) => e
  );
  assert.ok(err);
  const mapped = mapPrismaError(err);
  assert.equal(mapped?.status, 409);
});
