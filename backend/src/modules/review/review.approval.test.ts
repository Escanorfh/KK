/**
 * اختبارات مسار المراجعة الجديد:
 * اعتماد جماعي بمفتاح المجموعة، حذف الطلب المعلّق، ومنع الإرسال قبل الاعتماد.
 * بديل Prisma في الذاكرة — مافيش سيرفر ولا قاعدة بيانات.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_review_approval_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, any>;

let db: {
  reviews: Row[];
  repairOrders: Row[];
  needRequests: Row[];
  audits: Row[];
  seq: number;
};

function reset() {
  db = { reviews: [], repairOrders: [], needRequests: [], audits: [], seq: 100 };
}

function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

const prismaMock: any = {
  reviewRequest: {
    findUnique: async ({ where }: any) => {
      if (where?.id != null) return db.reviews.find((r) => r.id === where.id) ?? null;
      if (where?.clientRequestId != null)
        return db.reviews.find((r) => r.clientRequestId === where.clientRequestId) ?? null;
      return null;
    },
    findFirst: async ({ where }: any) => db.reviews.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) =>
      db.reviews.filter((r) => {
        if (!where) return true;
        if (where.status && r.status !== where.status) return false;
        if (where.id?.in && !where.id.in.includes(r.id)) return false;
        return true;
      }),
    count: async () => db.reviews.length,
    create: async ({ data }: any) => {
      const row = {
        id: ++db.seq,
        status: "PENDING_REVIEW",
        submittedAt: new Date(),
        ...data,
      };
      db.reviews.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = db.reviews.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of db.reviews) {
        if (row.id === where.id && row.status === where.status) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    delete: async ({ where }: any) => {
      db.reviews = db.reviews.filter((r) => r.id !== where.id);
      return {};
    },
  },
  repairOrder: {
    findUnique: async ({ where }: any) =>
      db.repairOrders.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where }: any = {}) =>
      db.repairOrders.filter((r) => !where?.id?.in || where.id.in.includes(r.id)),
    update: async ({ where, data }: any) => {
      const row = db.repairOrders.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
    deleteMany: async ({ where }: any) => {
      const before = db.repairOrders.length;
      db.repairOrders = db.repairOrders.filter(
        (r) => !(r.id === where.id && r.managersId == null && r.sentAt == null),
      );
      return { count: before - db.repairOrders.length };
    },
  },
  needRequest: {
    findUnique: async ({ where }: any) =>
      db.needRequests.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where }: any = {}) =>
      db.needRequests.filter((r) => !where?.id?.in || where.id.in.includes(r.id)),
    update: async ({ where, data }: any) => {
      const row = db.needRequests.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
    deleteMany: async ({ where }: any) => {
      const before = db.needRequests.length;
      db.needRequests = db.needRequests.filter(
        (r) => !(r.id === where.id && r.managersId == null && r.status !== "SENT"),
      );
      return { count: before - db.needRequests.length };
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

const reviewService = () => import("./review.service.js");
const approval = () => import("../../utils/reviewApproval.js");

async function rejected(promise: Promise<unknown>, status: number) {
  const err = await promise.then(
    () => null,
    (e: any) => e,
  );
  assert.ok(err, "المفروض العملية ترفض");
  assert.equal(err.status, status, err.message);
  return err;
}

test("اعتماد جماعي يعتمد المعلّق وي skipping المعتمد بالفعل", async () => {
  reset();
  db.reviews = [
    { id: 1, entity: "repairorder", status: "PENDING_REVIEW", recordId: 10, submittedById: 7, submittedData: {}, submittedAt: new Date() },
    { id: 2, entity: "repairorder", status: "APPROVED", recordId: 11, submittedById: 7, submittedData: {}, submittedAt: new Date() },
    { id: 3, entity: "needrequest", status: "PENDING_REVIEW", recordId: 20, submittedById: 7, submittedData: {}, submittedAt: new Date() },
  ];
  db.repairOrders = [{ id: 10, managersId: null, sentAt: null }];
  db.needRequests = [{ id: 20, managersId: null, status: "DRAFT" }];

  const result = await (await reviewService()).bulkApprove([1, 2, 3], 9);
  assert.equal(result.approved, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.total, 3);
  assert.equal(db.reviews.find((r) => r.id === 1)!.status, "APPROVED");
  assert.equal(db.reviews.find((r) => r.id === 3)!.status, "APPROVED");
  assert.equal(db.reviews.find((r) => r.id === 1)!.reviewedById, 9);
  assert.ok(db.audits.some((a) => a.action === "UPDATE" && a.details?.action === "BULK_APPROVE"));
});

test("الاعتماد الجماعي يرفض طلبًا أُرسل للمديرين ويرجّع الباقي", async () => {
  reset();
  db.reviews = [
    { id: 1, entity: "repairorder", status: "PENDING_REVIEW", recordId: 10, submittedById: 7, submittedData: {}, submittedAt: new Date() },
    { id: 2, entity: "repairorder", status: "PENDING_REVIEW", recordId: 11, submittedById: 7, submittedData: {}, submittedAt: new Date() },
  ];
  db.repairOrders = [
    { id: 10, managersId: null, sentAt: null },
    { id: 11, managersId: 55, sentAt: new Date() },
  ];

  await rejected((await reviewService()).bulkApprove([1, 2], 9), 409);
  assert.equal(db.reviews.find((r) => r.id === 1)!.status, "PENDING_REVIEW", "الـ transaction ترجّعت كلها");
});

test("حذف طلب معلّق يمسح سجل المراجعة والطلب المرتبط", async () => {
  reset();
  db.reviews = [
    { id: 1, entity: "repairorder", status: "PENDING_REVIEW", recordId: 10, submittedById: 7, submittedData: {}, submittedAt: new Date() },
  ];
  db.repairOrders = [{ id: 10, managersId: null, sentAt: null }];

  await (await reviewService()).remove(1, 9, "ROOT");
  assert.equal(db.reviews.length, 0);
  assert.equal(db.repairOrders.length, 0);
});

test("ما يتحذفش سجل اعتُمد أو طلب غير إداري", async () => {
  reset();
  db.reviews = [
    { id: 1, entity: "needrequest", status: "APPROVED", recordId: 20, submittedById: 7, submittedData: {}, submittedAt: new Date() },
  ];
  db.needRequests = [{ id: 20, managersId: null, status: "DRAFT" }];

  await rejected((await reviewService()).remove(1, 9, "ROOT"), 409);
  await rejected((await reviewService()).remove(1, 9, "USER"), 403);
  assert.equal(db.reviews.length, 1);
  assert.equal(db.needRequests.length, 1);
});

test("اعتماد التعديل ينزّل القيم المعدّلة على السجل الأصلي", async () => {
  reset();
  db.reviews = [
    {
      id: 1,
      entity: "repairorder",
      status: "PENDING_REVIEW",
      recordId: 10,
      submittedById: 7,
      submittedData: { workshop: "ورشة قديمة", quantity: 2 },
      reviewedData: { workshop: "ورشة معدّلة", quantity: 5, entryDate: "2026-11-20" },
      submittedAt: new Date(),
    },
    {
      id: 2,
      entity: "needrequest",
      status: "PENDING_REVIEW",
      recordId: 20,
      submittedById: 7,
      submittedData: { department: "قديم" },
      reviewedData: { department: "مخازن", requestDate: "2026-11-19" },
      submittedAt: new Date(),
    },
  ];
  db.repairOrders = [{ id: 10, managersId: null, sentAt: null, workshop: "ورشة قديمة" }];
  db.needRequests = [{ id: 20, managersId: null, status: "DRAFT", department: "قديم" }];

  const svc = await reviewService();
  await svc.approve(1, 9);
  await svc.approve(2, 9);

  assert.equal(db.repairOrders[0].workshop, "ورشة معدّلة");
  assert.equal(db.repairOrders[0].quantity, 5);
  assert.ok(db.repairOrders[0].entryDate instanceof Date, "التاريخ اتحوّل لـ Date");
  assert.equal(db.needRequests[0].department, "مخازن");
  assert.ok(db.needRequests[0].requestDate instanceof Date);
  assert.ok(db.audits.some((a) => a.details?.source === "review-approve"));
});

test("بوابة الإرسال تنشئ مراجعة للطلب القديم وتمنع الإرسال لحد الاعتماد", async () => {
  reset();
  db.repairOrders = [{ id: 10, managersId: null, sentAt: null }];
  const input = {
    data: { requestNo: 5, equipmentId: 3 },
    context: { projectId: 1, contextSource: "SNAPSHOT" as const },
    submittedById: 3,
  };

  const err = await rejected(
    (await approval()).assertManagerSendApproved("repairorder", 10, input),
    409,
  );
  assert.match(err.message, /تعتمد|اعتماد/);
  assert.equal(db.reviews.length, 1);
  assert.equal(db.reviews[0].clientRequestId, "repairorder:record:10");
  assert.equal(db.reviews[0].status, "PENDING_REVIEW");

  // محاولة تانية ما تكررش السجل.
  await rejected((await approval()).assertManagerSendApproved("repairorder", 10, input), 409);
  assert.equal(db.reviews.length, 1);

  db.reviews[0].status = "APPROVED";
  await (await approval()).assertManagerSendApproved("repairorder", 10, input);
});

test("طلب الاحتياج القديم ياخد مراجعة قبل الإرسال كمان", async () => {
  reset();
  db.needRequests = [{ id: 20, managersId: null, status: "DRAFT" }];
  const input = {
    data: { requestNo: 7 },
    context: { projectId: 1, projectCode: "100", contextSource: "SNAPSHOT" as const },
    submittedById: 4,
  };

  await rejected((await approval()).assertManagerSendApproved("needrequest", 20, input), 409);
  assert.equal(db.reviews[0].entity, "needrequest");
  assert.equal(db.reviews[0].projectCode, "100");
});
