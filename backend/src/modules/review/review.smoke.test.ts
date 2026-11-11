process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_review_smoke";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";

test("review module loads", async () => {
  const mod = await import("./review.service.js");
  assert.ok(typeof mod.createReviewRequest === "function");
  assert.ok(typeof mod.approve === "function");
  assert.ok(typeof mod.reject === "function");
});
