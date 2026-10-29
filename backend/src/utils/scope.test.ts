import test from "node:test";
import assert from "node:assert/strict";
import { scopeOr } from "./scope";

test("أدمن/روت بلا تضييق مشروع", () => {
  assert.equal(scopeOr(null), null);
  assert.equal(scopeOr(undefined), null);
});

test("مستخدم محدود يشوف مشاريعه والسجلات بلا مشروع", () => {
  assert.deepEqual(scopeOr([3, 7]), [{ projectId: { in: [3, 7] } }, { projectId: null }]);
});

test("مستخدم بلا مشروع إسناد لا يفتح له كل المشاريع", () => {
  const own = scopeOr([]);
  assert.deepEqual(own, [{ projectId: { in: [] } }, { projectId: null }]);
});
