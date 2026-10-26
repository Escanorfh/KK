import * as XLSX from "xlsx";
import { PrismaClient, type Prisma, type WorkType, type WorkStatus } from "@prisma/client";

const prisma = new PrismaClient();
const FILE = "F:\\app\\farouk\\patches\\DB sheets\\SOUTHMED.xlsm";
const PROJECT_CODE = "SOUTH-MED";
const PROJECT_NAME = "ساوثميد";
const SECTOR_NAME = "المعدات";

function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][];
}

function serialToDate(n: number): Date {
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

function parseDate(v: unknown): Date | null {
  if (typeof v === "number" && v > 40000 && v < 60000) return serialToDate(v);
  if (typeof v === "string") {
    const s = v.trim();
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (us) {
      const [, a, b, y] = us;
      const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
      const month = Number(a);
      const day = Number(b);
      if (month <= 12 && day <= 31) return new Date(Date.UTC(year, month - 1, day));
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return null;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function numOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type Condition = "GOOD" | "BROKEN" | "STOPPED";

function conditionOf(v: unknown): Condition | null {
  const s = str(v);
  if (!s) return null;
  if (s.includes("غير صالح") || s.includes("غير صالخ")) return "BROKEN";
  if (s.includes("صالح") || s.includes("تم الصيانة") || s.includes("تم الصيانه")) return "GOOD";
  if (
    s.includes("عاطل") ||
    s.includes("عطل") ||
    s.includes("عطلان") ||
    s.includes("لا يعمل") ||
    s.includes("مكسور") ||
    s.includes("كسر") ||
    s.includes("غاطل") ||
    s.includes("غعاطل") ||
    s.includes("عاطر") ||
    s.includes("عغطل")
  )
    return "BROKEN";
  if (
    s.includes("متوقف") ||
    s.includes("متوثف") ||
    s.includes("جاري الصيانة") ||
    s.includes("جارى الصيانة") ||
    s.includes("جاري الصيانه") ||
    s.includes("جاري تليين") ||
    s.includes("جارى تليين") ||
    s.includes("صيانة لحام")
  )
    return "STOPPED";
  if (s.includes("يعمل")) return "GOOD";
  return null;
}

const isStandardCondition = (v: unknown) => {
  const s = str(v);
  return s === "صالح" || s === "عاطل" || s === "متوقف";
};

interface DailyRow {
  date: Date;
  equipmentCode: string;
  operatingHours: number | null;
  endMeter: number | null;
  diesel: number | null;
  condition: Condition | null;
  conditionNote: string | null;
  notes: string | null;
  source: string;
}

async function main() {
  console.log("Reading", FILE);
  const wb = XLSX.readFile(FILE, { cellDates: false });

  // ---------- 1. Project + Sector ----------
  const project = await prisma.project.upsert({
    where: { code: PROJECT_CODE },
    update: { name: PROJECT_NAME },
    create: { code: PROJECT_CODE, name: PROJECT_NAME, description: "مستورد من ملف SOUTHMED.xlsm" },
  });
  const sector = await prisma.sector.upsert({
    where: { projectId_name: { projectId: project.id, name: SECTOR_NAME } },
    update: {},
    create: { projectId: project.id, name: SECTOR_NAME },
  });
  console.log(`Project: ${project.name} (id=${project.id}), Sector: ${sector.name}`);

  // ---------- 2. Collect equipment codes ----------
  const codes = new Set<string>();
  for (const r of sheetRows(wb, "HELP").slice(1)) if (str(r[0])) codes.add(str(r[0]));
  for (const r of sheetRows(wb, "Sheet2").slice(1)) if (str(r[1])) codes.add(str(r[1]));
  for (const r of sheetRows(wb, "day").slice(5)) if (str(r[1])) codes.add(str(r[1]));
  for (const r of sheetRows(wb, "Sheet3").slice(1)) if (str(r[4])) codes.add(str(r[4]));
  for (const r of sheetRows(wb, "Sheet6")) {
    if (str(r[6]).includes("ساوث") || str(r[7]).includes("ساوث")) {
      if (str(r[1])) codes.add(str(r[1]));
    }
  }

  const equipmentMap = new Map<string, number>();
  let createdEquipment = 0;
  for (const code of codes) {
    const existing = await prisma.equipment.findUnique({ where: { code } });
    if (existing) {
      equipmentMap.set(code, existing.id);
      continue;
    }
    const eq = await prisma.equipment.create({
      data: { code, name: code, projectId: project.id, sectorId: sector.id },
    });
    equipmentMap.set(code, eq.id);
    createdEquipment++;
  }
  console.log(`Equipment: ${codes.size} total (${createdEquipment} new)`);

  // ---------- 3. Collect daily logs (priority: Sheet6 < Sheet2 < day) ----------
  const daily = new Map<string, DailyRow>();

  const put = (row: DailyRow, overwrite: boolean) => {
    const eqId = equipmentMap.get(row.equipmentCode);
    if (!eqId) return;
    const key = `${row.date.toISOString().slice(0, 10)}|${eqId}`;
    if (!daily.has(key) || overwrite) daily.set(key, row);
  };

  let s6 = 0;
  for (const r of sheetRows(wb, "Sheet6")) {
    const site = str(r[6]);
    const sec = str(r[7]);
    if (!site.includes("ساوث") && !sec.includes("ساوث")) continue;
    const date = parseDate(r[11]);
    const code = str(r[1]);
    if (!date || !code) continue;
    put(
      {
        date,
        equipmentCode: code,
        operatingHours: numOrNull(r[3]),
        endMeter: numOrNull(r[5]),
        diesel: null,
        condition: conditionOf(r[8]),
        conditionNote: isStandardCondition(r[8]) ? null : str(r[8]) || null,
        notes: null,
        source: "Sheet6",
      },
      false
    );
    s6++;
  }
  console.log(`Sheet6 south rows read: ${s6}`);

  let s2 = 0;
  for (const r of sheetRows(wb, "Sheet2").slice(1)) {
    const date = parseDate(r[15]);
    const code = str(r[1]);
    if (!date || !code) continue;
    put(
      {
        date,
        equipmentCode: code,
        operatingHours: numOrNull(r[3]),
        endMeter: numOrNull(r[4]),
        diesel: numOrNull(r[8]),
        condition: conditionOf(r[2]),
        conditionNote: isStandardCondition(r[2]) ? null : str(r[2]) || null,
        notes: str(r[11]) || null,
        source: "Sheet2",
      },
      true
    );
    s2++;
  }
  console.log(`Sheet2 rows read: ${s2}`);

  let d1 = 0;
  for (const r of sheetRows(wb, "day").slice(5)) {
    const date = parseDate(r[15]);
    const code = str(r[1]);
    if (!date || !code) continue;
    put(
      {
        date,
        equipmentCode: code,
        operatingHours: numOrNull(r[3]),
        endMeter: numOrNull(r[4]),
        diesel: numOrNull(r[8]),
        condition: conditionOf(r[2]),
        conditionNote: isStandardCondition(r[2]) ? null : str(r[2]) || null,
        notes: str(r[11]) || null,
        source: "day",
      },
      true
    );
    d1++;
  }
  console.log(`day rows read: ${d1}`);
  console.log(`DailyLog unique rows to import: ${daily.size}`);

  // ---------- 4. Replace project daily logs (idempotent re-import) ----------
  const southEquipIds = [...equipmentMap.values()];
  const deleted = await prisma.dailyLog.deleteMany({
    where: { equipmentId: { in: southEquipIds } },
  });
  console.log(`Deleted previous daily logs for these equipment: ${deleted.count}`);

  const dailyValues: Prisma.DailyLogCreateManyInput[] = [];
  for (const [key, row] of daily) {
    const [, eqIdStr] = key.split("|");
    dailyValues.push({
      date: row.date,
      equipmentId: Number(eqIdStr),
      operatingHours: row.operatingHours,
      endMeter: row.endMeter,
      diesel: row.diesel,
      condition: row.condition,
      conditionNote: row.conditionNote,
      notes: row.notes,
      startMeter: null,
      productivity: null,
    });
  }

  let inserted = 0;
  for (let i = 0; i < dailyValues.length; i += 500) {
    const chunk = dailyValues.slice(i, i + 500);
    const res = await prisma.dailyLog.createMany({ data: chunk, skipDuplicates: true });
    inserted += res.count;
    process.stdout.write(`\rDailyLog inserted: ${inserted}/${dailyValues.length}`);
  }
  console.log(`\nDailyLog done: ${inserted} inserted`);

  const byCond = await prisma.dailyLog.groupBy({
    by: ["condition"],
    where: { equipmentId: { in: southEquipIds } },
    _count: true,
  });
  console.log(
    "Condition distribution:",
    byCond.map((c) => `${c.condition ?? "NULL"}=${c._count}`).join(", ")
  );
  const withNote = await prisma.dailyLog.count({
    where: { equipmentId: { in: southEquipIds }, conditionNote: { not: null } },
  });
  console.log(`conditionNote preserved: ${withNote}`);

  // ---------- 5. Maintenance: skipped here — use `npm run import:work` ----------
  console.log("Maintenance: skipped (run import:work for the rich work orders from SOUTH MED.xlsm)");

  // ---------- Summary ----------
  const totalDaily = await prisma.dailyLog.count({
    where: { equipment: { projectId: project.id } },
  });
  const totalMaint = await prisma.maintenance.count({
    where: { equipment: { projectId: project.id } },
  });
  const totalEquip = await prisma.equipment.count({ where: { projectId: project.id } });

  console.log("\n===== IMPORT SUMMARY =====");
  console.log(`Project:        ${PROJECT_NAME}`);
  console.log(`Equipment:      ${totalEquip}`);
  console.log(`DailyLog:       ${totalDaily}`);
  console.log(`Maintenance:    ${totalMaint}`);
  console.log("===========================");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
