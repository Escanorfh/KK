import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("DataDayPage reads project/sector from snapshot fields only", () => {
  const file = path.resolve(process.cwd(), "..", "frontend", "src", "pages", "data-day", "DataDayPage.tsx");
  const src = fs.readFileSync(file, "utf8");
  // snapshot fields are used for display
  assert.match(src, /rec\.projectName/);
  assert.match(src, /rec\.sectorName/);
  // must not fall back to equipment's current project/sector for display
  assert.doesNotMatch(src, /rec\.equipment\.project/);
  assert.doesNotMatch(src, /rec\.equipment\.sector/);
  // filter uses snapshot fields
  assert.match(src, /params\.projectId/);
  assert.match(src, /params\.sector/);
});
