/**
 * اختبارات حماية ROOT-only لتسجيل المعدات:
 * - requireRole("ROOT") يرفض كل الأدوار الأخرى بـ 403.
 * - راوت POST /equipments/register مربوط فعلًا بحراسة ROOT.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { requireRole } from "../../middleware/auth.middleware";
import equipmentRouter from "./equipment.routes";

function mockResponse() {
  const state: { statusCode: number; body: any } = { statusCode: 0, body: null };
  const res: any = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(body: any) {
      state.body = body;
      return res;
    },
  };
  return { res, state };
}

function invokeGuard(guard: any, role: string | null) {
  const { res, state } = mockResponse();
  let nextCalled = false;
  guard({ user: role ? { id: 1, role } : undefined }, res, () => {
    nextCalled = true;
  });
  return { ...state, nextCalled };
}

for (const role of ["ADMIN", "USER", "MANAGER"]) {
  test(`requireRole("ROOT") يرفض ${role} بـ 403`, () => {
    const result = invokeGuard(requireRole("ROOT"), role);
    assert.equal(result.statusCode, 403);
    assert.equal(result.nextCalled, false);
    assert.deepEqual(result.body, { message: "Forbidden" });
  });
}

test('requireRole("ROOT") يسمح لـ ROOT بالمرور', () => {
  const result = invokeGuard(requireRole("ROOT"), "ROOT");
  assert.equal(result.statusCode, 0);
  assert.equal(result.nextCalled, true);
});

test("بدون مستخدم → 403", () => {
  const result = invokeGuard(requireRole("ROOT"), null);
  assert.equal(result.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("POST /equipments/register مربوط بحراسة ROOT", () => {
  const layer = (equipmentRouter as any).stack.find(
    (l: any) => l.route?.path === "/register" && l.route?.methods?.post
  );
  assert.ok(layer, "راوت POST /register موجود");

  const guard = layer.route.stack[0].handle;

  const blocked = invokeGuard(guard, "ADMIN");
  assert.equal(blocked.statusCode, 403, "ADMIN ممنوع");
  assert.equal(blocked.nextCalled, false);

  const allowed = invokeGuard(guard, "ROOT");
  assert.equal(allowed.statusCode, 0);
  assert.equal(allowed.nextCalled, true, "ROOT مسموح");
});
