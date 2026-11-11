/**
 * اختبارات موحّدة لمعالج أخطاء Express مع أكواد Prisma.
 * بنستدعي الدالة مباشرةً — مافيش سيرفر ولا اتصال قاعدة بيانات.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_error_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "./app.js";

type Captured = { status: number; body: { message?: string } };

function invoke(err: unknown): Captured {
  const captured: Captured = { status: 200, body: {} };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(payload: { message?: string }) {
      captured.body = payload;
      return res;
    },
  };
  errorHandler(
    err as Error & { status?: number; code?: string },
    {} as never,
    res as never,
    (() => undefined) as never
  );
  return captured;
}

function prismaError(code: string, meta?: Record<string, unknown>) {
  return Object.assign(new Error(`prisma ${code}`), {
    name: "PrismaClientKnownRequestError",
    code,
    meta,
  });
}

test("P2002 على زوج (projectId, sectorId) → 409 برسالة ربط مكرر", () => {
  const res = invoke(prismaError("P2002", { target: ["projectId", "sectorId"] }));
  assert.equal(res.status, 409);
  assert.match(res.body.message ?? "", /مرتبط بالمشروع/);
});

test("P2002 على normalizedName → 409 برسالة اسم مكرر داخل المشروع", () => {
  const res = invoke(prismaError("P2002", { target: "ProjectSector_projectId_normalizedName_key" }));
  assert.equal(res.status, 409);
  assert.match(res.body.message ?? "", /بنفس الاسم داخل المشروع/);
});

test("P2002 على Sector.projectId + name → 409 برسالة القطاع القديم المكرر", () => {
  const res = invoke(prismaError("P2002", { target: ["projectId", "name"] }));
  assert.equal(res.status, 409);
  assert.match(res.body.message ?? "", /موجود بالفعل في هذا المشروع/);
});

test("P2002 على حقل code → 409 برسالة قيمة مستخدمة", () => {
  const res = invoke(prismaError("P2002", { target: ["code"] }));
  assert.equal(res.status, 409);
  assert.match(res.body.message ?? "", /مستخدمة من قبل/);
});

test("P2002 بدون target أو بشكل غير متوقع → 409 برسالة عامة آمنة", () => {
  const res = invoke(prismaError("P2002", { target: { unexpected: true } }));
  assert.equal(res.status, 409);
  assert.match(res.body.message ?? "", /مكرّرة/);
  assert.doesNotMatch(res.body.message ?? "", /sql|prisma|select|insert/i);
});

test("P2003 (foreign key) → 409", () => {
  const res = invoke(prismaError("P2003"));
  assert.equal(res.status, 409);
  assert.match(res.body.message ?? "", /مرتبط ببيانات أخرى/);
});

test("P2014 (required relation violation) → 409", () => {
  const res = invoke(prismaError("P2014"));
  assert.equal(res.status, 409);
  assert.match(res.body.message ?? "", /البيانات المرتبطة/);
});

test("P2025 (record not found) → 404", () => {
  const res = invoke(prismaError("P2025"));
  assert.equal(res.status, 404);
  assert.match(res.body.message ?? "", /غير موجود/);
});

test("P2022 محفوظ: بنية القاعدة أقدم من الكود → 500 مع اسم العمود والترحيل", () => {
  const err = prismaError("P2022", { model: "Sector", column: "managersRoomId" });
  const res = invoke(err);
  assert.equal(res.status, 500);
  assert.match(res.body.message ?? "", /Sector\.managersRoomId/);
  assert.match(res.body.message ?? "", /migrations-manual/);
});

test("خطأ اتصال قاعدة البيانات محفوظ → 503", () => {
  const err = Object.assign(new Error("Can't reach database server"), {
    name: "PrismaClientInitializationError",
  });
  const res = invoke(err);
  assert.equal(res.status, 503);
  assert.match(res.body.message ?? "", /تعذّر الاتصال بقاعدة البيانات/);
});

test("خطأ عادي بـ status (422) → نفس الرسالة والحالة", () => {
  const err = Object.assign(new Error("القطاع لا ينتمي لهذا المشروع"), { status: 422 });
  const res = invoke(err);
  assert.equal(res.status, 422);
  assert.equal(res.body.message, "القطاع لا ينتمي لهذا المشروع");
});

test("كود Prisma غير مُعالَج أو خطأ غير معروف → 500 عام من غير تفاصيل داخلية", () => {
  const known = invoke(prismaError("P2004"));
  assert.equal(known.status, 500);
  assert.equal(known.body.message, "حدث خطأ غير متوقع في الخادم");

  const unknown = invoke(new Error("internal stack should not leak"));
  assert.equal(unknown.status, 500);
  assert.equal(unknown.body.message, "حدث خطأ غير متوقع في الخادم");
  assert.doesNotMatch(unknown.body.message ?? "", /internal stack/);
});
