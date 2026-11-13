process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_transfer_smoke";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";

test("transfer module loads", async () => {
  const mod = await import("./transfer.service.js");
  assert.ok(typeof mod.resolveEquipmentAssignmentAtDate === "function");
  assert.ok(typeof mod.completeDue === "function");
  assert.ok(typeof mod.approve === "function");
});
