import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyLogExportRow, DAILYLOG_CSV_HEADERS } from "../modules/dailylogs/dailylogExport";

test("export row uses the record snapshot, not equipment.project", () => {
  const row = buildDailyLogExportRow({
    id: 1,
    date: new Date("2024-03-05"),
    equipment: { code: "EX50", name: "Excavator" },
    projectName: "المشروع من الملف",
    projectCode: "P-EX",
    sectorName: "القطاع من الملف",
    // deliberately conflicting equipment source values are NOT passed
  } as any);
  assert.equal(row[4], "المشروع من الملف");
  assert.equal(row[5], "القطاع من الملف");
});

test("export row falls back projectCode then 'غير محدد'", () => {
  const row = buildDailyLogExportRow({
    id: 2,
    date: new Date("2024-03-05"),
    equipment: { code: "EX50", name: "Excavator" },
    projectName: null,
    projectCode: "P-9",
    sectorName: null,
  } as any);
  assert.equal(row[4], "P-9");
  assert.equal(row[5], "غير محدد");
});

test("export headers include project and sector", () => {
  assert.ok(DAILYLOG_CSV_HEADERS.includes("المشروع"));
  assert.ok(DAILYLOG_CSV_HEADERS.includes("القطاع"));
});
