import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImportedSnapshot,
  cellText,
  createMasterIndex,
  detectDailyLogColumns,
  matchProjectId,
  matchSectorId,
  normHeader,
} from "../modules/data/excelImport";

test("detects project and sector columns from the real all_DB header", () => {
  const headers = [
    "كود المعدة",
    "الصلاحية",
    "ساعات التشغيل",
    "عداد الساعات",
    "عداد الكياومترات",
    "سائق النهار",
    "سائق الليل",
    "السولار",
    "عدد الانتاجية ",
    "نوع الانتاجية",
    "ملاحظات",
    "الساعة",
    "الكيلو",
    "المشروع",
    "التاريخ",
    "القطاع",
    "بواسطة",
  ];
  const layout = detectDailyLogColumns(headers);
  assert.equal(layout.projectNameIndex, 13);
  assert.equal(layout.sectorIndex, 15);
  assert.equal(layout.hasProject, true);
  assert.equal(layout.hasSector, true);
  assert.equal(layout.warnings.length, 0);
});

test("recognizes Arabic variants and colon-terminated headers", () => {
  const headers = ["كود المعدة", "التاريخ", "المشروع:", "القطاع", "اسم المشروع", "كود المشروع"];
  const layout = detectDailyLogColumns(headers);
  // exact match wins; "المشروع:" normalizes to "المشروع"
  assert.equal(layout.projectNameIndex, 2);
  assert.equal(layout.projectCodeIndex, 5);
  assert.equal(layout.sectorIndex, 3);
});

test("does not confuse a project code column with the project name", () => {
  const headers = ["كود المعدة", "التاريخ", "كود المشروع", "القطاع"];
  const layout = detectDailyLogColumns(headers);
  assert.equal(layout.projectNameIndex, null);
  assert.equal(layout.projectCodeIndex, 2);
  assert.equal(layout.hasProject, true);
  // only a code column exists -> no warning (project is still detected)
  assert.equal(layout.warnings.filter((w) => w.includes("المشروع")).length, 0);
});

test("missing headers produce warnings and hasProject/hasSector false", () => {
  const headers = ["كود المعدة", "التاريخ", "العداد"];
  const layout = detectDailyLogColumns(headers);
  assert.equal(layout.hasProject, false);
  assert.equal(layout.hasSector, false);
  assert.equal(layout.warnings.length, 2);
});

test("preserves Arabic text verbatim (only trims edges)", () => {
  assert.equal(cellText("  ساوث  ميد  "), "ساوث  ميد");
  assert.equal(cellText(""), null);
  assert.equal(cellText(null), null);
});

test("buildImportedSnapshot keeps text even without master match", () => {
  const snap = buildImportedSnapshot(
    { projectName: "مشروع غير موجود", projectCode: "X-9", sectorName: "قطاع غير موجود" },
    { hasProject: true, hasSector: true },
    { projectId: null, sectorId: null }
  );
  assert.ok(snap);
  assert.equal(snap!.projectId, null);
  assert.equal(snap!.projectName, "مشروع غير موجود");
  assert.equal(snap!.projectCode, "X-9");
  assert.equal(snap!.sectorId, null);
  assert.equal(snap!.sectorName, "قطاع غير موجود");
  assert.equal(snap!.contextSource, "SNAPSHOT");
});

test("empty cells remain empty/UNKNOWN", () => {
  const snap = buildImportedSnapshot(
    { projectName: "", projectCode: "", sectorName: "" },
    { hasProject: true, hasSector: true },
    { projectId: null, sectorId: null }
  );
  assert.ok(snap);
  assert.equal(snap!.projectName, null);
  assert.equal(snap!.sectorName, null);
  assert.equal(snap!.contextSource, "UNKNOWN");
});

test("returns null when no project and no sector column exist", () => {
  const snap = buildImportedSnapshot(
    { projectName: "anything", projectCode: "", sectorName: "" },
    { hasProject: false, hasSector: false },
    { projectId: 1, sectorId: 2 }
  );
  assert.equal(snap, null);
});

test("master matching resolves by exact name/code and stays null otherwise", () => {
  const index = createMasterIndex(
    [
      { id: 10, code: "P1", name: "ساوثميد" },
      { id: 20, code: "P2", name: "ابوقير طرق" },
    ],
    [{ projectId: 10, sectorId: 100, sectorName: "المعدات" }]
  );
  assert.equal(matchProjectId(index, "ساوثميد", null), 10);
  assert.equal(matchProjectId(index, null, "P2"), 20);
  assert.equal(matchProjectId(index, "مشروع وهمي", null), null);
  assert.equal(matchSectorId(index, 10, "المعدات"), 100);
  assert.equal(matchSectorId(index, 10, "قطاع وهمي"), null);
  assert.equal(matchSectorId(index, 999, "المعدات"), null);
});

test("ambiguous master rows resolve to null instead of guessing", () => {
  const index = createMasterIndex(
    [
      { id: 1, code: null, name: "نفس الاسم" },
      { id: 2, code: null, name: "نفس الاسم" },
    ],
    []
  );
  assert.equal(matchProjectId(index, "نفس الاسم", null), null);
});

test("normHeader normalizes Arabic variants", () => {
  assert.equal(normHeader("المشروع:"), "المشروع");
  assert.equal(normHeader("أإآ"), "ااا");
});
