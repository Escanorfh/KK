/**
 * اختبارات الحذف الآمن للقطاع — بديل Prisma في الذاكرة، بدون أي اتصال قاعدة بيانات.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_sector_delete_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";

type Counts = {
  projectSectors: number;
  equipment: number;
  dailyLogs: number;
  maintenance: number;
  faults: number;
  needRequests: number;
  repairOrders: number;
};

const emptyCounts = (): Counts => ({
  projectSectors: 0,
  equipment: 0,
  dailyLogs: 0,
  maintenance: 0,
  faults: 0,
  needRequests: 0,
  repairOrders: 0,
});

let state: {
  exists: boolean;
  counts: Counts;
  deletes: number;
  audits: unknown[];
  deleteError: unknown;
};

function reset(counts: Partial<Counts> = {}, exists = true) {
  state = {
    exists,
    counts: { ...emptyCounts(), ...counts },
    deletes: 0,
    audits: [],
    deleteError: null,
  };
}

const prismaMock: any = {
  sector: {
    findUnique: async () => {
      if (!state.exists) return null;
      return { id: 7, name: "المخازن", _count: { ...state.counts } };
    },
    delete: async () => {
      if (state.deleteError) throw state.deleteError;
      state.deletes++;
      return { id: 7 };
    },
  },
  auditLog: {
    create: async ({ data }: any) => {
      state.audits.push(data);
      return { id: 1, ...data };
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

const BLOCKING: { label: string; counts: Partial<Counts> }[] = [
  { label: "ربط مشروع نشط/ملغي (أي صف ProjectSector)", counts: { projectSectors: 1 } },
  { label: "سجل يومي", counts: { dailyLogs: 1 } },
  { label: "أمر شغل (Maintenance)", counts: { maintenance: 1 } },
  { label: "عطل (Fault)", counts: { faults: 1 } },
  { label: "طلب احتياج", counts: { needRequests: 1 } },
  { label: "أمر إصلاح", counts: { repairOrders: 1 } },
  { label: "معدة", counts: { equipment: 1 } },
];

for (const item of BLOCKING) {
  test(`مرجع تشغيلي يمنع الحذف: ${item.label} → 409`, async () => {
    reset(item.counts);
    const mod = await service();
    const err = await rejected(mod.remove(7, 1), 409);
    assert.match(err.message, /مرتبط بمشاريع أو بسجلات/);
    assert.equal(state.deletes, 0, "مافيش حذف فعلي");
    assert.equal(state.audits.length, 0);
  });
}

test("مراجع متعددة في نفس الوقت بتتجمع وتمنع الحذف", async () => {
  reset({ projectSectors: 2, dailyLogs: 3, equipment: 1 });
  const mod = await service();
  await rejected(mod.remove(7, 1), 409);
  assert.equal(state.deletes, 0);
});

test("قطاع غير موجود → 404", async () => {
  reset({}, false);
  const mod = await service();
  await rejected(mod.remove(7, 1), 404);
  assert.equal(state.deletes, 0);
});

test("قطاع غير مرتبط بأي شيء → بيتحذف وبيتسجل في التدقيق", async () => {
  reset();
  const mod = await service();
  const result = await mod.remove(7, 1);
  assert.deepEqual(result, { message: "تم حذف القطاع" });
  assert.equal(state.deletes, 1);
  assert.equal(state.audits.length, 1);
});

test("سباق P2003 بين الفحص والحذف → 409 عربي مفهوم", async () => {
  reset();
  state.deleteError = Object.assign(new Error("foreign key constraint"), {
    name: "PrismaClientKnownRequestError",
    code: "P2003",
  });
  const mod = await service();
  const err = await rejected(mod.remove(7, 1), 409);
  assert.match(err.message, /مرتبط ببيانات أخرى/);
  assert.equal(state.deletes, 0);
  assert.equal(state.audits.length, 0);
});

test("خطأ حذف غير معروف بينتشر زي ما هو", async () => {
  reset();
  const boom = new Error("unexpected delete failure");
  state.deleteError = boom;
  const mod = await service();
  const err = await mod.remove(7, 1).then(
    () => null,
    (e: unknown) => e
  );
  assert.equal(err, boom);
  assert.equal(state.audits.length, 0);
});
