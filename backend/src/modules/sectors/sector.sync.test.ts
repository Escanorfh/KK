// مزامنة القطاعات مع مشاريع نظام المدرين: المصدر الوحيد هو rooms[] المصرّح بها للتوكن.
// الاختبارات بتتأكد إن الربط بيتم بمعرّف الغرفة، وإن مافيش حذف ولا إعادة تسمية لبيانات موجودة.
// بديل Prisma كامل في الذاكرة — مافيش اتصال قاعدة بيانات.
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_sector_sync_test";
delete process.env.EFMS_MODE;

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeArabic } from "../../utils/managers.js";

type Row = Record<string, any>;

interface Stub {
  sectors: Row[];
  links: Row[];
  updates: Row[];
  creates: Row[];
  linkCreates: Row[];
  linkUpdates: Row[];
  seq: { sector: number; link: number };
}

let state: Stub;

function fresh(
  sectors: Row[] = [],
  links: Row[] = []
): Stub {
  state = {
    sectors,
    links,
    updates: [],
    creates: [],
    linkCreates: [],
    linkUpdates: [],
    seq: { sector: 100, link: 500 },
  };
  return state;
}

function sectorMatches(row: Row, where: any): boolean {
  if (!where) return true;
  if (where.projectId !== undefined) {
    if (typeof where.projectId === "object") return true;
    if (row.projectId !== where.projectId) return false;
  }
  if (where.projectSectors?.none !== undefined) {
    return !state.links.some((l) => l.sectorId === row.id);
  }
  return true;
}

function linkMatches(row: Row, where: any): boolean {
  if (!where) return true;
  if (where.projectId !== undefined && row.projectId !== where.projectId) return false;
  if (where.sectorId !== undefined && row.sectorId !== where.sectorId) return false;
  if (where.normalizedName !== undefined && row.normalizedName !== where.normalizedName) return false;
  if (where.active !== undefined && row.active !== where.active) return false;
  return true;
}

function linkView(row: Row): Row {
  return {
    ...row,
    sector: state.sectors.find((s) => s.id === row.sectorId) ?? null,
  };
}

function plant(): void {
  (globalThis as any).prisma = {
    sector: {
      findMany: async ({ where }: any = {}) =>
        state.sectors.filter((s) => sectorMatches(s, where)).map((s) => ({ ...s })),
      update: async ({ where, data }: any) => {
        state.updates.push({ where, data });
        const row = state.sectors.find((s) => s.id === where.id);
        Object.assign(row!, data);
        return { ...row };
      },
      create: async ({ data }: any) => {
        state.creates.push(data);
        const row = { id: ++state.seq.sector, ...data };
        state.sectors.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: any) =>
        state.sectors.find((s) => s.id === where.id) ?? null,
    },
    projectSector: {
      findMany: async ({ where }: any = {}) =>
        state.links.filter((l) => linkMatches(l, where)).map(linkView),
      findUnique: async ({ where }: any = {}) => {
        const pair = where?.projectId_sectorId;
        if (!pair) return null;
        return (
          state.links.find(
            (l) => l.projectId === pair.projectId && l.sectorId === pair.sectorId
          ) ?? null
        );
      },
      create: async ({ data }: any) => {
        state.linkCreates.push(data);
        const row = { id: ++state.seq.link, ...data };
        state.links.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        state.linkUpdates.push({ where, data });
        const row = state.links.find((l) => l.id === where.id);
        Object.assign(row!, data);
        return { ...row };
      },
    },
  };
}

async function mod() {
  return await import("./sector.service.js");
}

test("قطاع جديد لموجودش عنده مثيل → بيتعمل مربوط بمعرّف الغرفة وعنوانها", async () => {
  fresh();
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "قطاع المخازن" }]);

  assert.equal(res.created, 1);
  assert.deepEqual(state.creates[0], { projectId: 11, name: "قطاع المخازن" });
  assert.equal(state.links.length, 1);
  assert.equal(state.links[0].projectId, 11);
  assert.equal(state.links[0].sectorId, state.sectors[0].id);
  assert.equal(state.links[0].normalizedName, normalizeArabic("قطاع المخازن"));
  assert.equal(state.sectors[0].managersRoomId, 77);
  assert.equal(state.sectors[0].managersRoomTitle, "قطاع المخازن");
});

test("المطابقة بمعرّف الغرفة أولًا — وجود القطاع بيمنع أي تكرار", async () => {
  fresh([{ id: 5, projectId: 11, name: "المخازن", managersRoomId: 77, managersRoomTitle: "قطاع المخازن" }]);
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "قطاع المخازن" }]);

  assert.equal(res.created, 0);
  assert.equal(res.linked, 0);
  assert.equal(res.unchanged, 1);
  assert.equal(state.creates.length, 0);
  assert.equal(state.updates.length, 0);
  assert.equal(state.links.length, 0);
});

test("اسم مطابق حرفيًا ولسه مش مربوط → القطاع بيتربط بمعرّف الغرفة من غير ما نعمل نسخة", async () => {
  fresh([{ id: 6, projectId: 11, name: "الورشة المركزية", managersRoomId: null, managersRoomTitle: null }]);
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 88, title: "الورشة   المركزية" }]);

  assert.equal(res.created, 0);
  assert.equal(res.linked, 1);
  assert.equal(state.creates.length, 0, "مافيش قطاع duplicate اتعمل");
  assert.equal(state.linkCreates.length, 1);
  assert.equal(state.linkCreates[0].sectorId, 6);
  assert.deepEqual(
    state.updates.find((u) => u.data.managersRoomId === 88)?.data,
    { managersRoomId: 88, managersRoomTitle: "الورشة   المركزية" }
  );
});

test("اسط الغرفة اتغير عند المدرين → العنوان المربوط بيتحدث والاسم المحلي ما بيتلمسش", async () => {
  fresh([{ id: 7, projectId: 11, name: "المخازن", managersRoomId: 77, managersRoomTitle: "مخزن قديم" }]);
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "قطاع المخازن الجديد" }]);

  assert.equal(res.unchanged, 1);
  assert.equal(state.creates.length, 0);
  assert.deepEqual(state.updates[0].data, { managersRoomTitle: "قطاع المخازن الجديد" });
  assert.equal((state.sectors[0] as any).name, "المخازن", "اسم القطاع المحلي ما اتغيرش");
});

test("الاسم مشغول بقطاع مربوط بغرفة تانية → بيرفض بهدوء، والقيد الفريد ما بيخترقش", async () => {
  fresh([{ id: 8, projectId: 11, name: "التشغيل", managersRoomId: 91, managersRoomTitle: "التشغيل" }]);
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [
    { id: 91, title: "التشغيل" },
    { id: 92, title: "التشغيل" },
  ]);

  assert.equal(res.created, 0, "مافيش create هيكسر @@unique([projectId, name])");
  assert.equal(res.unchanged, 1);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /مربوط بالفعل بغرفة أخرى/);
});

test("غرف كتير لنفس المشروع → كل واحدة بتاخد قطاعها، واللي ملهاش متطابق بيتعمل جديد", async () => {
  fresh([{ id: 9, projectId: 11, name: "المخازن", managersRoomId: 77, managersRoomTitle: "المخازن" }]);
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [
    { id: 77, title: "المخازن" },
    { id: 88, title: "الورشة" },
  ]);

  assert.equal(res.unchanged, 1);
  assert.equal(res.created, 1);
  const made = state.sectors.find((s) => s.id !== 9);
  assert.ok(made);
  assert.equal((made as any).name, "الورشة");
  assert.equal((made as any).managersRoomId, 88);
  assert.equal(state.links.length, 1);
});

test("قطاع مربوط بغرفة اتسحبت من التصريح → بيفضل زي ما هو وبيتبلّغ عنه للمراجعة (مافيش إلغاء ربط تلقائي)", async () => {
  fresh([
    { id: 10, projectId: 11, name: "الورشة", managersRoomId: 88, managersRoomTitle: "الورشة" },
    { id: 11, projectId: 11, name: "المخازن", managersRoomId: 77, managersRoomTitle: "المخازن" },
  ]);
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "المخازن" }]);

  assert.deepEqual(res.stale, [{ id: 10, name: "الورشة", managersRoomId: 88 }]);
  assert.equal((state.sectors[0] as any).managersRoomId, 88, "مافيش unlink تلقائي");
  assert.equal(state.creates.length, 0);
});

test("مصفوفة rooms فاضية (التوكن ملوش قطاع مصرّح به) → مافيش أي كتابة على القاعدة", async () => {
  fresh([{ id: 12, projectId: 11, name: "المخازن", managersRoomId: 77, managersRoomTitle: "المخازن" }]);
  plant();
  const res = await (await mod()).syncSectorsForProject(11, []);

  assert.equal(res.created, 0);
  assert.equal(res.linked, 0);
  assert.equal(res.skipped.length, 0);
  assert.equal(state.creates.length, 0);
  assert.equal(state.updates.length, 0);
  assert.equal(state.links.length, 0);
});

test("قطاع مشترك M:N (أصله مشروع تاني) بيتكتشف من الربط مش من العمود القديم", async () => {
  fresh(
    [{ id: 20, projectId: 22, name: "قطاع المخازن", managersRoomId: 77, managersRoomTitle: "قطاع المخازن" }],
    [{ id: 70, projectId: 11, sectorId: 20, active: true, normalizedName: normalizeArabic("قطاع المخازن") }]
  );
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "قطاع المخازن" }]);

  assert.equal(res.created, 0);
  assert.equal(res.unchanged, 1);
  assert.equal(state.creates.length, 0);
});

test("ربط ملغي لمشروع + غرفة مصرّح بها → يتفعّل من جديد بدل إنشاء قطاع", async () => {
  fresh(
    [{ id: 30, projectId: 22, name: "الورشة", managersRoomId: 88, managersRoomTitle: "الورشة" }],
    [{ id: 80, projectId: 11, sectorId: 30, active: false, normalizedName: normalizeArabic("الورشة") }]
  );
  plant();
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 88, title: "الورشة" }]);

  assert.equal(res.created, 0);
  assert.equal(res.linked, 1);
  assert.equal(state.linkUpdates.length, 1);
  assert.equal(state.linkUpdates[0].data.active, true);
  assert.equal(state.links[0].active, true);
});
