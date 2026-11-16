import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImportedSnapshot,
  cellText,
  createMasterIndex,
  detectDailyLogColumns,
  detectDailyLogEquipmentColumns,
  extractTitleProjectSector,
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

test("detects equipment code column and falls back to serial number", () => {
  const withCode = detectDailyLogEquipmentColumns([
    "م",
    "كود المعدة",
    "الصلاحية",
    "التاريخ",
    "المشروع:",
    "القطاع",
  ]);
  assert.equal(withCode.keyIndex, 1);
  assert.equal(withCode.keySource, "code");

  const serialOnly = detectDailyLogEquipmentColumns(["الرقم التسلسلي", "التاريخ", "القطاع"]);
  assert.equal(serialOnly.keyIndex, 0);
  assert.equal(serialOnly.keySource, "serial");

  const none = detectDailyLogEquipmentColumns(["التاريخ", "العداد"]);
  assert.equal(none.keyIndex, null);
  assert.equal(none.keySource, null);
});

test("detects project/sector/date on the real SOUTH MED day sheet merged header", () => {
  const row3 = [
    "م",
    "كود المعدة",
    "الصلاحية",
    "ساعات التشغيل",
    "عداد ساعات",
    "عداد الكيلومترات",
    "اسم السائق",
    "",
    "السولار",
    "الانتاجية ",
    "",
    "ملاحظات",
  ];
  const row4 = [
    "",
    "",
    "",
    "",
    "",
    "",
    "نهاري",
    "ليلي",
    "",
    "عدد",
    "النوع",
    "",
    "معدل تغيير الزيت\\الساعة",
    "معدل تغيير زيت \\كيلو متر",
    "المشروع:",
    "التاريخ",
    "القطاع",
  ];
  const width = Math.max(row3.length, row4.length);
  const merged = Array.from({ length: width }, (_, i) => row3[i] || row4[i] || "");
  const layout = detectDailyLogColumns(merged);
  assert.equal(layout.projectNameIndex, 14);
  assert.equal(layout.sectorIndex, 16);
  assert.equal(layout.hasProject, true);
  assert.equal(layout.hasSector, true);
  assert.equal(merged[15], "التاريخ");
});

test("new day layout: labels one row ABOVE the header still detect project/sector/date", () => {
  // SOTH MED NEW day sheet: rows below the header are empty beyond col 10, so
  // المشروع:/التاريخ/القطاع live in the row directly above the header row.
  const merged = [
    "م",
    "كود المعدة",
    "الصلاحية",
    "ساعات التشغيل",
    "عداد ساعات",
    "عداد الكيلومترات",
    "اسم السائق",
    "ليلي",
    "السولار",
    "الانتاجية ",
    "عدد",
    "ملاحظات",
    "معدل تغيير الزيت\\الساعة",
    "معدل تغيير زيت \\كيلو متر",
    "المشروع:",
    "التاريخ",
    "القطاع",
  ];
  const layout = detectDailyLogColumns(merged);
  assert.equal(layout.projectNameIndex, 14);
  assert.equal(layout.sectorIndex, 16);
  assert.equal(layout.hasProject, true);
  assert.equal(layout.hasSector, true);
  assert.equal(merged[15], "التاريخ");
});

test("title extraction skips label-like values in the new day sheet", () => {
  const rows: unknown[][] = [
    [],
    [],
    [
      "المشروع:",
      "",
      "ساوثميد",
      "",
      "",
      "صيانة دورية",
      "زيت محرك",
      "",
      "",
      "التاريخ:",
      46341,
      "",
      "معدل تغيير الزيت\\الساعة",
      "معدل تغيير زيت \\كيلو متر",
      "المشروع:",
      "التاريخ",
      "القطاع",
      "نسبة تغيير الزيت",
      "نسبه تغيير الزيت -كيلومتر",
      "اَخر عداد تغيير زيت",
      "عداد كيلومتر",
    ],
    [
      "م",
      "كود المعدة",
      "الصلاحية",
      "ساعات التشغيل",
      "عداد ساعات",
      "عداد الكيلومترات",
      "اسم السائق",
      "",
      "السولار",
      "الانتاجية ",
      "",
      "ملاحظات",
    ],
  ];
  const title = extractTitleProjectSector(rows, 3);
  assert.equal(title.projectName, "ساوثميد");
  // Before the guard this wrongly returned "نسبة تغيير الزيت".
  assert.equal(title.sectorName, null);
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
