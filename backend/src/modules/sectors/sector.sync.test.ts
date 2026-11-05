// مزامنة القطاعات مع مشاريع نظام المدرين: المصدر الوحيد هو rooms[] المصرّح بها للتوكن.
// الاختبارات بتتأكد إن الربط بيتم بمعرّف الغرفة، وإن مافيش حذف ولا إعادة تسمية لبيانات موجودة.
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_sector_sync_test";
delete process.env.EFMS_MODE;

import { test } from "node:test";
import assert from "node:assert/strict";

interface Stub {
  sectors: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  creates: Record<string, unknown>[];
  seq: number;
}

const stubs: Record<string, unknown> = {};
(globalThis as any).prisma = new Proxy(stubs, {
  get(_t, prop) {
    if (typeof prop === "symbol") return undefined;
    if (prop in _t) return (_t as Record<string, unknown>)[prop];
    throw new Error(`الاختبار مزروش فيه: prisma.${String(prop)}`);
  },
});

/** بديل prisma.sector: كل عمليات القراءة/الكتابة على مصفوفة في الذاكرة */
function plant(state: Stub): void {
  Object.assign(stubs, {
    sector: {
      findMany: async () => state.sectors.map((s) => ({ ...s })),
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        state.updates.push({ where, data });
        const row = state.sectors.find((s) => s.id === where.id);
        Object.assign(row!, data);
        return row;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.creates.push(data);
        const row = { id: ++state.seq, ...data };
        state.sectors.push(row);
        return row;
      },
    },
  });
}

function fresh(sectors: Record<string, unknown>[]): Stub {
  return { sectors, updates: [], creates: [], seq: 100 };
}

async function mod() {
  return await import("./sector.service.js");
}

test("قطاع جديد لموجودش عنده مثيل → بيتعمل مربوط بمعرّف الغرفة وعنوانها", async () => {
  const state = fresh([]);
  plant(state);
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "قطاع المخازن" }]);

  assert.equal(res.created, 1);
  assert.deepEqual(state.creates[0], {
    projectId: 11,
    name: "قطاع المخازن",
    managersRoomId: 77,
    managersRoomTitle: "قطاع المخازن",
  });
  assert.equal(state.updates.length, 0);
});

test("المطابقة بمعرّف الغرفة أولًا — وجود القطاع بيمنع أي تكرار", async () => {
  const state = fresh([{ id: 5, name: "المخازن", managersRoomId: 77, managersRoomTitle: "قطاع المخازن" }]);
  plant(state);
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "قطاع المخازن" }]);

  assert.equal(res.created, 0);
  assert.equal(res.linked, 0);
  assert.equal(res.unchanged, 1);
  assert.equal(state.creates.length, 0);
  assert.equal(state.updates.length, 0);
});

test("اسم مطابق حرفيًا ولسه مش مربوط → القطاع بيتربط بمعرّف الغرفة من غير ما نعمل نسخة", async () => {
  const state = fresh([{ id: 6, name: "الورشة المركزية", managersRoomId: null, managersRoomTitle: null }]);
  plant(state);
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 88, title: "الورشة   المركزية" }]);

  assert.equal(res.created, 0);
  assert.equal(res.linked, 1);
  assert.equal(state.creates.length, 0, "مافيش قطاع duplicate اتعمل");
  assert.deepEqual(state.updates[0].data, { managersRoomId: 88, managersRoomTitle: "الورشة   المركزية" });
});

test("اسط الغرفة اتغير عند المدرين → العنوان المربوط بيتحدث والاسم المحلي ما بيتلمسش", async () => {
  const state = fresh([{ id: 7, name: "المخازن", managersRoomId: 77, managersRoomTitle: "مخزن قديم" }]);
  plant(state);
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "قطاع المخازن الجديد" }]);

  assert.equal(res.unchanged, 1);
  assert.equal(state.creates.length, 0);
  assert.deepEqual(state.updates[0].data, { managersRoomTitle: "قطاع المخازن الجديد" });
  assert.equal((state.sectors[0] as any).name, "المخازن", "اسم القطاع المحلي ما اتغيرش");
});

test("الاسم مشغول بقطاع مربوط بغرفة تانية → بيرفض بهدوء، والقيد الفريد ما بيخترقش", async () => {
  const state = fresh([{ id: 8, name: "التشغيل", managersRoomId: 91, managersRoomTitle: "التشغيل" }]);
  plant(state);
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
  const state = fresh([{ id: 9, name: "المخازن", managersRoomId: 77, managersRoomTitle: "المخازن" }]);
  plant(state);
  const res = await (await mod()).syncSectorsForProject(11, [
    { id: 77, title: "المخازن" },
    { id: 88, title: "الورشة" },
  ]);

  assert.equal(res.unchanged, 1);
  assert.equal(res.created, 1);
  assert.equal((state.creates[0] as any).managersRoomId, 88);
  assert.equal((state.creates[0] as any).name, "الورشة");
});

test("قطاع مربوط بغرفة اتسحبت من التصريح → بيفضل زي ما هو وبيتبلّغ عنه للمراجعة (مافيش إلغاء ربط تلقائي)", async () => {
  const state = fresh([
    { id: 10, name: "الورشة", managersRoomId: 88, managersRoomTitle: "الورشة" },
    { id: 11, name: "المخازن", managersRoomId: 77, managersRoomTitle: "المخازن" },
  ]);
  plant(state);
  const res = await (await mod()).syncSectorsForProject(11, [{ id: 77, title: "المخازن" }]);

  assert.deepEqual(res.stale, [{ id: 10, name: "الورشة", managersRoomId: 88 }]);
  assert.equal((state.sectors[0] as any).managersRoomId, 88, "مافيش unlink تلقائي");
  assert.equal(state.creates.length, 0);
});

test("مصفوفة rooms فاضية (التوكن ملوش قطاع مصرّح به) → مافيش أي كتابة على القاعدة", async () => {
  const state = fresh([{ id: 12, name: "المخازن", managersRoomId: 77, managersRoomTitle: "المخازن" }]);
  plant(state);
  const res = await (await mod()).syncSectorsForProject(11, []);

  assert.equal(res.created, 0);
  assert.equal(res.linked, 0);
  assert.equal(res.skipped.length, 0);
  assert.equal(state.creates.length, 0);
  assert.equal(state.updates.length, 0);
});
