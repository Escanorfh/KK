import * as XLSX from "xlsx";
import type { WorkStatus, WorkType, Condition } from "@prisma/client";
import prisma from "../../config/prisma";
import { managersProjects, normalizeArabic } from "../../utils/managers";
import { ensureSectorLink, syncSectorsForProject } from "../sectors/sector.service";
import { withDbRetry } from "../../utils/db";
import {
  buildImportedSnapshot,
  createMasterIndex,
  detectDailyLogColumns,
  detectDailyLogEquipmentColumns,
  extractTitleProjectSector,
  makeColFinder,
  matchProjectId,
  matchSectorId,
  normHeader as norm,
  type DailyLogSnapshot,
} from "./excelImport";
import { DAILYLOG_CSV_HEADERS, buildDailyLogExportRow } from "../dailylogs/dailylogExport";

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

export const IMPORT_ENTITIES = [
  "projects",
  "equipments",
  "dailylogs",
  "maintenance",
  "partschedules",
] as const;
export const EXPORT_ENTITIES = [...IMPORT_ENTITIES, "users"] as const;
export type Entity = (typeof EXPORT_ENTITIES)[number];

export function isEntity(v: string): v is Entity {
  return (EXPORT_ENTITIES as readonly string[]).includes(v);
}

const SHEET_NAMES: Record<Entity, string> = {
  projects: "المشاريع",
  equipments: "المعدات",
  dailylogs: "السجل اليومي",
  maintenance: "أوامر الشغل",
  partschedules: "مواعيد الأصناف",
  users: "المستخدمون",
};

const CONDITION_AR: Record<string, string> = { GOOD: "صالح", BROKEN: "عاطل", STOPPED: "متوقف" };
const STATUS_AR: Record<string, string> = {
  NEW: "جديد",
  IN_PROGRESS: "جاري صيانة",
  DONE: "تم الصيانة",
  WAITING_PARTS: "متوقف الصيانة",
};
const WORKTYPE_AR: Record<string, string> = { MAINTENANCE: "صيانة", REPAIR: "إصلاح" };

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function numOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function serialToDate(n: number): Date {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(new Date(ms).toISOString().slice(0, 10) + "T00:00:00.000Z");
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  if (typeof v === "number" && v > 30000 && v < 70000) return serialToDate(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (us) {
      let day = Number(us[1]);
      let month = Number(us[2]);
      const year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
      // الصيغة المعتمدة dd/mm/yyyy — لو التاني أكبر من 12 يبقى كان month-first
      if (month > 12 && day <= 12) {
        [day, month] = [month, day];
      }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return new Date(Date.UTC(year, month - 1, day));
      }
      return null;
    }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  }
  return null;
}

function fmtDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

function conditionOf(v: unknown): Condition | null {
  const s = str(v);
  if (!s) return null;
  if (s === "GOOD" || s.includes("صالح")) return "GOOD";
  if (s === "BROKEN" || s.includes("عاطل") || s.includes("عطل")) return "BROKEN";
  if (s === "STOPPED" || s.includes("متوقف")) return "STOPPED";
  return null;
}

function workStatusOf(v: unknown): WorkStatus | null {
  const s = str(v);
  if (!s) return null;
  if (s === "NEW" || s.includes("جديد")) return "NEW";
  if (s === "IN_PROGRESS" || s.includes("جاري")) return "IN_PROGRESS";
  if (s === "DONE" || s.includes("تم الصيانة") || s.includes("تم الصيانه")) return "DONE";
  if (s === "WAITING_PARTS" || s.includes("متوقف") || s.includes("انتظار")) return "WAITING_PARTS";
  return null;
}

function workTypeOf(v: unknown): WorkType {
  const s = str(v);
  if (s === "REPAIR" || s.includes("طارئ")) return "REPAIR";
  return "MAINTENANCE";
}

interface PartsCell {
  name: string;
  code: string | null;
  qty: number | null;
  notes: string | null;
}

function parsePartsCell(v: unknown): PartsCell[] {
  const s = str(v);
  if (!s) return [];
  const out: PartsCell[] = [];
  for (const chunk of s.split(/;|;;/)) {
    const t = chunk.trim();
    if (!t) continue;
    const m = t.match(/^(.*?)(?:\s*[x×*]\s*([\d.]+))?$/i);
    if (!m) continue;
    const name = m[1].trim();
    if (!name) continue;
    out.push({ name, code: null, qty: m[2] ? Number(m[2]) : null, notes: null });
  }
  return out;
}

function partsToCell(parts: { name: string; qty: number | null }[]): string {
  return parts.map((p) => (p.qty != null ? `${p.name}×${p.qty}` : p.name)).join("; ");
}

function sheetFromAoa(aoa: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = (aoa[0] ?? []).map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}

type SheetData = { name: string; rows: unknown[][] };

function sheetsFromBuffer(buffer: Buffer): SheetData[] {
  const head = buffer.subarray(0, 4);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf;
  const isBiff = head[0] === 0x09 && head[1] === 0x00;
  const looksBinary = isZip || isOle || isBiff;

  if (!looksBinary) {
    // CSV: نحاول UTF-8 (مع/بدون BOM) وبعدها Windows-1256 لملفات Excel العربي القديمة
    const utf8 = new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
    let text = utf8;
    if (utf8.includes("�")) {
      text = new TextDecoder("windows-1256").decode(buffer).replace(/^﻿/, "");
    }
    const wb = XLSX.read(text, { type: "string", raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) fail("الملف لا يحتوي على بيانات", 400);
    return [{ name: wb.SheetNames[0] || "CSV", rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][] }];
  }

  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    return { name, rows: ws ? (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][]) : [] };
  }).filter((s) => s.rows.length > 0);
}

function sheetSignature(rows: unknown[][]) {
  const hIdx = findHeaderRow(rows);
  const cells = new Set<string>();
  if (hIdx !== -1) {
    // الرؤوس ممكن تكون موزعة على صفوف حول صف الرأس الرئيسي (فوق أو تحت)
    for (const row of [rows[hIdx - 2], rows[hIdx - 1], rows[hIdx], rows[hIdx + 1]]) {
      if (!row) continue;
      for (const c of row) {
        const n = norm(c);
        if (n) cells.add(n);
      }
    }
  }
  const has = (sub: string) => [...cells].some((c) => c.includes(sub));
  return {
    hIdx,
    hasDate: cells.has("التاريخ") || cells.has("تاريخ"),
    hasPart: has("صنف"),
    hasWO: has("امر الشغل") || has("نوع الصيانه") || has("الورشه"),
  };
}

function sheetMatches(entity: Entity, rows: unknown[][]): boolean {
  const s = sheetSignature(rows);
  if (s.hIdx === -1) return false;
  if (entity === "dailylogs") return s.hasDate && !s.hasPart;
  // فورم «work» فيه نوع أمر الشغل والورشة لكنه طلب واحد مش جدول — لازم معاه
  // عمود «التاريخ» فعليًا عشان يعتبر سجل أوامر شغل.
  if (entity === "maintenance") return s.hasPart || (s.hasDate && s.hasWO);
  return false;
}

function pickSheet(entity: Entity, sheets: SheetData[], sheetName?: string): SheetData {
  if (sheets.length === 0) fail("الملف لا يحتوي على بيانات", 400);
  if (sheetName) {
    const s = sheets.find((x) => x.name === sheetName);
    if (!s) fail(`الشيت «${sheetName}» غير موجود — الملف فيه: ${sheets.map((x) => x.name).join("، ")}`, 400);
    return s;
  }
  const matched = sheets.find((s) => sheetMatches(entity, s.rows));
  if (matched) return matched;
  return sheets[0];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  warnings: string[];
}

function findHeaderRow(rows: unknown[][]): number {
  return rows.findIndex((row) =>
    row.some((c) => {
      const n = norm(c);
      return n === "كود المعده" || n === "الكود" || n === "رقم امر الشغل";
    })
  );
}

function locateLayout(rows: unknown[][], entity: Entity) {
  const hIdx = findHeaderRow(rows);
  if (hIdx === -1) {
    fail(
      "لم يتم العثور على رأس الأعمدة — الملف لازم يحتوي عمود «كود المعدة» أو «الكود» في أول الصفوف",
      400
    );
  }
  let headers = rows[hIdx];
  let dataStart = hIdx + 1;
  // شيت اليومي: الرأس ممكن يكون ممتد على صفوف حول صف الرأس الرئيسي.
  // - الصف اللي تحت (نهاري/ليلي/عدد/النوع أو المشروع/القطاع في الملفات القديمة)
  // - وصفوف فوقه (المشروع:/التاريخ/القطاع في الملفات الجديدة)
  // الأولوية للصف الأقرب للبيانات، والأعمدة الفارغة في كل الصفوف تسيب فاضية.
  if (
    entity === "dailylogs" &&
    !headers.some((c) => norm(c) === "التاريخ" || norm(c) === "تاريخ")
  ) {
    const width = Math.max(
      headers.length,
      ...(hIdx + 1 < rows.length ? [rows[hIdx + 1].length] : []),
      ...(hIdx - 1 >= 0 ? [rows[hIdx - 1].length] : []),
      ...(hIdx - 2 >= 0 ? [rows[hIdx - 2].length] : [])
    );
    headers = Array.from({ length: width }, (_, i) => {
      if (str(headers[i])) return headers[i];
      for (const j of [hIdx + 1, hIdx - 1, hIdx - 2]) {
        const v = rows[j]?.[i];
        if (v !== undefined && str(v)) return v;
      }
      return "";
    });
    dataStart = hIdx + 2;
  }
  return { headers, col: makeColFinder(headers), dataStart, hIdx };
}

/**
 * Find an existing project by its normalized Arabic name, or create it.
 * Normalization prevents "ساوثميد" / "ساوث ميد " from creating duplicates.
 * A per-process cache keeps repeated 300-row imports from re-querying.
 */
const projectNameCache = new Map<string, number>();
async function ensureProjectByName(name: string): Promise<number> {
  const clean = name.trim();
  const key = norm(clean);
  if (!key) throw Object.assign(new Error("اسم المشروع مطلوب"), { status: 400 });

  const cached = projectNameCache.get(key);
  if (cached) return cached;

  const looseKey = key.replace(/\s+/g, "");
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  const hit = projects.find(
    (p) => norm(p.name) === key || norm(p.name).replace(/\s+/g, "") === looseKey
  );
  const id = hit ? hit.id : (await prisma.project.create({ data: { name: clean } })).id;
  projectNameCache.set(key, id);
  return id;
}

async function ensureSector(projectId: number, name: string): Promise<number> {
  // القطاع التشغيلي بيتعمل/بيتعاد استخدامه مع ربط ProjectSector إجباري — نفس قاعدة M:N
  return ensureSectorLink(projectId, name);
}

async function resolveEquipmentBatch(
  codes: string[],
  cache: Map<string, number>,
  names?: Map<string, string>,
  serials?: Map<string, number>
) {
  const missing = [...new Set(codes.filter((c) => c && !cache.has(c)))];
  if (missing.length === 0) return;
  const found = await prisma.equipment.findMany({
    where: { code: { in: missing } },
    select: { id: true, code: true, serialNumber: true },
  });
  for (const f of found) {
    cache.set(f.code, f.id);
    // استيراد الرقم التسلسلي من شيت day للمعدات اللي ملهاش رقم —
    // ومش بنغيّر رقم موجود (التسجيل هو مصدر الترقيم التلقائي).
    const serial = serials?.get(f.code);
    if (f.serialNumber == null && serial != null) {
      try {
        await prisma.equipment.update({ where: { id: f.id }, data: { serialNumber: serial } });
      } catch (err) {
        // تعارض الفريد (projectId, serialNumber) — نسيب الرقم فاضي بدل ما نكسر الاستيراد
        if ((err as { code?: string })?.code !== "P2002") throw err;
      }
    }
  }
  for (const code of missing) {
    if (cache.has(code)) continue;
    // New equipment: keep the code as the key, use the serial number as the
    // display name when the sheet provided one.
    const name = names?.get(code)?.trim() || code;
    const serial = serials?.get(code);
    try {
      const eq = await prisma.equipment.create({
        data: { code, name, ...(serial != null ? { serialNumber: serial } : {}) },
      });
      cache.set(code, eq.id);
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") throw err;
      // تعارض رقم تسلسلي داخل نفس المشروع — أنشئ المعدة بدون رقم
      const eq = await prisma.equipment.create({ data: { code, name } });
      cache.set(code, eq.id);
    }
  }
}

/**
 * Best-effort serial-number column when the header is a bare "م".
 * A real row-number column stays small (1..N); asset serials are large.
 */
function guessSerialColumn(
  headers: unknown[],
  rows: unknown[][],
  dataStart: number,
  exclude: number | null
): number | null {
  const candidates = headers
    .map((h, i) => ({ i, n: norm(h) }))
    .filter(({ i, n }) => i !== exclude && (n === "م" || n === "م." || n === "مسلسل"))
    .map(({ i }) => i);
  for (const i of candidates) {
    let hits = 0;
    for (let r = dataStart; r < rows.length && hits < 3; r++) {
      const v = Number(rows[r]?.[i]);
      if (Number.isFinite(v) && v >= 100000) hits++;
    }
    if (hits >= 2) return i;
  }
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dayKey(date: Date, equipmentId: number) {
  return `${date.toISOString().slice(0, 10)}|${equipmentId}`;
}

export async function exportEntity(entity: Entity): Promise<{ buffer: Buffer; filename: string }> {
  let aoa: unknown[][] = [];
  const today = fmtDate(new Date());

  if (entity === "projects") {
    aoa = [["الكود", "الاسم", "الوصف", "عدد المعدات"]];
    const projects = await prisma.project.findMany({
      include: { _count: { select: { equipment: true } } },
      orderBy: { id: "asc" },
    });
    for (const p of projects) aoa.push([p.code ?? "", p.name, p.description ?? "", p._count.equipment]);
  } else if (entity === "equipments") {
    aoa = [["الكود", "الاسم", "المشروع", "القطاع", "تاريخ الإضافة"]];
    const eqs = await prisma.equipment.findMany({
      include: { project: true, sector: true },
      orderBy: { id: "asc" },
    });
    for (const e of eqs) {
      aoa.push([e.code, e.name, e.project?.name ?? "", e.sector?.name ?? "", fmtDate(e.createdAt)]);
    }
  } else if (entity === "dailylogs") {
    aoa = [
      [
        "التاريخ",
        "كود المعدة",
        "العداد النهاية",
        "ساعات التشغيل",
        "الديزل",
        "نوع الإنتاجية",
        "عدد الإنتاجية",
        "الحالة",
        "ملاحظة الحالة",
        "ملاحظات",
      ],
    ];
    const logs = await prisma.dailyLog.findMany({
      include: { equipment: { include: { project: true } } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    for (const l of logs) {
      aoa.push([
        fmtDate(l.date),
        l.equipment.code,
        l.endMeter ?? "",
        l.operatingHours ?? "",
        l.diesel ?? "",
        l.productivityType ?? "",
        l.productivityCount ?? "",
        l.condition ? CONDITION_AR[l.condition] : "",
        l.conditionNote ?? "",
        l.notes ?? "",
      ]);
    }
  } else if (entity === "maintenance") {
    aoa = [
      [
        "رقم أمر الشغل",
        "التاريخ",
        "تاريخ الانتهاء",
        "كود المعدة",
        "نوع الأمر",
        "نوع الصيانة",
        "الورشة",
        "العداد",
        "كم العداد",
        "الحالة",
        "نوع العمل",
        "وصف العطل",
        "الإجراء",
        "ملاحظات",
        "الأصناف",
      ],
    ];
    const orders = await prisma.maintenance.findMany({
      include: {
        equipment: true,
        workParts: { orderBy: { id: "asc" } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    for (const o of orders) {
      aoa.push([
        o.workOrderNo ?? "",
        fmtDate(o.date),
        o.endDate ? fmtDate(o.endDate) : "",
        o.equipment.code,
        o.orderType ?? "",
        o.maintenanceType ?? "",
        o.workshop ?? "",
        o.meterReading ?? "",
        o.kmMeter ?? "",
        STATUS_AR[o.status] ?? o.status,
        WORKTYPE_AR[o.workType] ?? o.workType,
        o.description ?? "",
        o.action ?? "",
        o.notes ?? "",
        partsToCell(o.workParts),
      ]);
    }
  } else if (entity === "partschedules") {
    aoa = [["كود المعدة", "الصنف", "الفترة", "الوحدة", "ملاحظات"]];
    const rows = await prisma.partSchedule.findMany({
      include: { equipment: true },
      orderBy: [{ equipmentId: "asc" }, { id: "asc" }],
    });
    for (const s of rows) aoa.push([s.equipment.code, s.partName, s.interval, s.unit, s.notes ?? ""]);
  } else if (entity === "users") {
    aoa = [["الاسم", "البريد", "الدور", "مفعل", "تاريخ الإضافة"]];
    const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
    for (const u of users) {
      aoa.push([u.name, u.email, u.role, u.active ? "نعم" : "لا", fmtDate(u.createdAt)]);
    }
  }

  const wb = sheetFromAoa(aoa);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buffer, filename: `${entity}-${today}.xlsx` };
}

export async function importEntity(
  entity: Entity,
  buffer: Buffer,
  sheetName?: string,
  fileName?: string,
  userId?: number
): Promise<ImportResult> {
  // Fresh master lookups for every import (projects may have been deleted since).
  projectNameCache.clear();
  const sheets = sheetsFromBuffer(buffer);
  let chosen = pickSheet(entity, sheets, sheetName);
  // فورم «work» في ملفات الـ day الجديدة طلب صيانة واحد مش جدول — لو اتبعت
  // (اختيار يدوي أو تلقائي) بنجرب شيت الصيانة الحقيقي في نفس الملف بدل الفشل.
  let sheetNote: string | null = null;
  if (entity === "maintenance" && !sheetMatches(entity, chosen.rows)) {
    const alt = sheets.find((s) => s !== chosen && sheetMatches(entity, s.rows));
    if (alt) {
      sheetNote = `الشيت «${chosen.name}» فورم طلب صيانة واحد مش جدول أوامر شغل — تم استيراد «${alt.name}» (سجل الصيانة) بدلًا منه.`;
      chosen = alt;
    }
  }
  const allRows = chosen.rows;
  const { headers, col, dataStart, hIdx } = locateLayout(allRows, entity);
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [], warnings: [] };
  if (sheetNote) result.warnings.push(sheetNote);
  const eqCache = new Map<string, number>();
  // معرّفات السجلات اللي الاستيراد ده أنشأها — تُحفظ في سجل الاستيراد لحذفها لاحقًا
  const createdIds: number[] = [];
  const MAX_ERRORS = 50;

  console.log(
    `[import:${entity}] sheet="${chosen.name}" sheets=[${sheets
      .map((s) => s.name + (s === chosen ? "*" : ""))
      .join(", ")}] rows=${allRows.length} dataStart=${dataStart + 1} headers=[${headers
      .map((h) => str(h))
      .filter(Boolean)
      .join(" | ")}]`
  );

  const pushErr = (rowNo: number, message: string) => {
    result.skipped++;
    if (result.errors.length < MAX_ERRORS) result.errors.push({ row: rowNo, message });
    if (result.errors.length <= 8) console.warn(`[import:${entity}] row ${rowNo}: ${message}`);
  };

  const g = (r: unknown[], i: number | null): string => (i == null ? "" : str(r[i]));
  const gn = (r: unknown[], i: number | null): number | null => (i == null ? null : numOrNull(r[i]));

  // ربط المعدة بمشروع/قطاع من ملفات اليومي القديمة (لو المعدة بدون مشروع)
  const eqMeta = new Map<string, { projName: string; secName: string }>();
  const rememberMeta = (code: string, projName: string, secName: string) => {
    if (!code || !projName) return;
    const cur = eqMeta.get(code);
    if (cur) {
      if (!cur.projName) eqMeta.set(code, { projName, secName: secName || cur.secName });
    } else {
      eqMeta.set(code, { projName, secName });
    }
  };
  const applyEqMeta = async () => {
    for (const [code, meta] of eqMeta) {
      try {
        const eq = await prisma.equipment.findUnique({ where: { code } });
        if (!eq) continue;
        const projectId = await ensureProjectByName(meta.projName);
        const sectorId = meta.secName ? await ensureSector(projectId, meta.secName) : null;
        const needs =
          (!eq.projectId && projectId) ||
          (!eq.sectorId && sectorId);
        if (needs) {
          await prisma.equipment.update({
            where: { id: eq.id },
            data: {
              ...(!eq.projectId ? { projectId } : {}),
              ...(!eq.sectorId && sectorId ? { sectorId } : {}),
            },
          });
        }
      } catch {
        /* تجاهل أخطاء الربط */
      }
    }
  };

  if (entity === "projects") {
    const cCode = col(["الكود", "كود المشروع"]);
    const cName = col(["الاسم", "اسم المشروع"]);
    const cDesc = col(["الوصف"]);
    for (let i = dataStart; i < allRows.length; i++) {
      const r = allRows[i];
      if (r.every((c) => str(c) === "")) continue;
      const code = g(r, cCode) || null;
      const name = g(r, cName);
      if (!name) {
        pushErr(i + 1, "الاسم مطلوب");
        continue;
      }
      try {
        const existing = await prisma.project.findFirst({
          where: code ? { code } : { name, code: null },
        });
        if (existing) {
          await prisma.project.update({
            where: { id: existing.id },
            data: { name, description: g(r, cDesc) || null, ...(code ? { code } : {}) },
          });
          result.updated++;
        } else {
          const made = await prisma.project.create({ data: { code, name, description: g(r, cDesc) || null } });
          createdIds.push(made.id);
          result.created++;
        }
      } catch {
        pushErr(i + 1, "تعذّر الحفظ");
      }
    }
  } else if (entity === "equipments") {
    const cCode = col(["الكود", "كود المعدة"]);
    const cName = col(["الاسم", "اسم المعدة"]);
    const cProj = col(["المشروع", "المشروع:"]);
    const cSec = col(["القطاع"]);

    interface EqRow {
      rowNo: number;
      code: string;
      name: string;
      projName: string;
      secName: string;
    }
    const byCode = new Map<string, EqRow>();
    for (let i = dataStart; i < allRows.length; i++) {
      const r = allRows[i];
      if (r.every((c) => str(c) === "")) continue;
      const code = g(r, cCode);
      if (!code) {
        pushErr(i + 1, "الكود مطلوب");
        continue;
      }
      byCode.set(code, {
        rowNo: i + 1,
        code,
        name: g(r, cName),
        projName: g(r, cProj),
        secName: g(r, cSec),
      });
    }

    const codes = [...byCode.keys()];
    const existed = new Set(
      (await prisma.equipment.findMany({ where: { code: { in: codes } }, select: { code: true } })).map(
        (x) => x.code
      )
    );

    const projCache = new Map<string, number>();
    const secCache = new Map<string, number>();
    const resolveMeta = async (projName: string, secName: string) => {
      if (!projName) return { projectId: null as number | null, sectorId: null as number | null };
      let projectId = projCache.get(projName);
      if (!projectId) {
        projectId = await ensureProjectByName(projName);
        projCache.set(projName, projectId);
      }
      let sectorId: number | null = null;
      if (secName) {
        const k = `${projName}|${secName}`;
        sectorId = secCache.get(k) ?? null;
        if (!sectorId) {
          sectorId = await ensureSector(projectId, secName);
          secCache.set(k, sectorId);
        }
      }
      return { projectId, sectorId };
    };

    const toCreate: (EqRow & { projectId: number | null; sectorId: number | null })[] = [];
    for (const p of byCode.values()) {
      if (existed.has(p.code)) continue;
      const meta = await resolveMeta(p.projName, p.secName);
      toCreate.push({ ...p, ...meta });
    }
    for (const c of chunk(toCreate, 300)) {
      await prisma.equipment.createMany({
        data: c.map((p) => ({
          code: p.code,
          name: p.name || p.code,
          projectId: p.projectId,
          sectorId: p.sectorId,
        })),
        skipDuplicates: true,
      });
      result.created += c.length;
    }
    if (toCreate.length > 0) {
      // createMany لا يُرجع المعرّفات — نجلبها بعد الإنشاء لتتبّع سجل الاستيراد
      const made = await prisma.equipment.findMany({
        where: { code: { in: toCreate.map((p) => p.code) } },
        select: { id: true },
      });
      createdIds.push(...made.map((m) => m.id));
    }

    const toUpdate = [...byCode.values()].filter((p) => existed.has(p.code));
    for (const c of chunk(toUpdate, 20)) {
      await Promise.all(
        c.map(async (p) => {
          try {
            const { projectId, sectorId } = await resolveMeta(p.projName, p.secName);
            const data = {
              ...(p.name ? { name: p.name } : {}),
              ...(projectId ? { projectId } : {}),
              ...(sectorId ? { sectorId } : {}),
            };
            if (Object.keys(data).length > 0) {
              await prisma.equipment.update({ where: { code: p.code }, data });
            }
            result.updated++;
          } catch {
            pushErr(p.rowNo, "تعذّر حفظ المعدة");
          }
        })
      );
    }

    const all = await prisma.equipment.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    for (const e of all) eqCache.set(e.code, e.id);
  } else if (entity === "dailylogs") {
    // Equipment key: "كود المعدة" first, then the serial number as fallback.
    const eqCols = detectDailyLogEquipmentColumns(headers);
    const cCode = eqCols.keyIndex;
    if (cCode == null) {
      result.warnings.push(
        "لم يتم العثور على عمود «كود المعدة» ولا «الرقم التسلسلي» — لن يمكن ربط السجلات بالمعدات."
      );
    }
    const cDate = col(["التاريخ", "تاريخ"]);
    const cEnd = col(["العداد النهاية", "عداد الساعات", "عداد ساعات", "الساعة"]);
    const cHours = col(["ساعات التشغيل", "الساعات"]);
    const cDiesel = col(["السولار", "الديزل"]);
    const cProdType = col(["نوع الانتاجية", "نوع الإنتاجية", "الانتاجية", "الإنتاجية"]);
    const cProdCount = col(["عدد الانتاجية", "عدد الإنتاجية", "كم الانتاجية"]);
    const cCond = col(["الصلاحية", "الحالة"]);
    const cCondNote = col(["ملاحظة الحالة"]);
    const cNotes = col(["ملاحظات"]);
    // Project/sector come ONLY from the Excel row. Detection is explicit so a
    // missing column produces a warning instead of mapping an unrelated column.
    const layout = detectDailyLogColumns(headers);
    result.warnings.push(...layout.warnings);
    const titleVals = extractTitleProjectSector(allRows, hIdx);
    const cProj = layout.projectNameIndex;
    const cProjCode = layout.projectCodeIndex;
    const cSec = layout.sectorIndex;
    const serialIndex =
      eqCols.serialIndex ?? guessSerialColumn(headers, allRows, dataStart, cCode);
    const effectiveLayout = {
      hasProject: layout.hasProject || !!titleVals.projectName,
      hasSector: layout.hasSector || !!titleVals.sectorName,
    };
    console.log(
      `[import:dailylogs] project="${layout.projectNameHeader ?? titleVals.projectName ?? "-"}" projectCode="${
        layout.projectCodeHeader ?? "-"
      }" sector="${layout.sectorHeader ?? titleVals.sectorName ?? "-"}" warnings=${layout.warnings.length}`
    );
    if (cDate == null) {
      fail("الملف مفيهوش عمود «التاريخ» — ده ملف يومية أصلًا؟", 400);
    }

    // Read the project/sector text for a row. The row wins; the sheet title is
    // only a fallback (and for `day` sheets the title is often the only source).
    const rowProjectName = (r: unknown[]) =>
      cProj != null ? g(r, cProj) || titleVals.projectName || "" : titleVals.projectName || "";
    const rowProjectCode = (r: unknown[]) => (cProjCode != null ? g(r, cProjCode) : "");
    const rowSectorName = (r: unknown[]) =>
      cSec != null ? g(r, cSec) || titleVals.sectorName || "" : titleVals.sectorName || "";

    // Master data is used for IDs only. It can never supply or replace the
    // Excel project/sector text.
    const loadMaster = async () => {
      const [projects, links] = await Promise.all([
        prisma.project.findMany({ select: { id: true, code: true, name: true } }),
        prisma.projectSector.findMany({
          where: { active: true },
          select: { projectId: true, sectorId: true, sector: { select: { name: true } } },
        }),
      ]);
      return createMasterIndex(
        projects,
        links.map((l) => ({ projectId: l.projectId, sectorId: l.sectorId, sectorName: l.sector.name }))
      );
    };
    let master = await loadMaster();

    // ------------------------------------------------------------------
    // Auto-provision master data from the uploaded day sheet:
    //   - missing project names are created
    //   - missing sectors are created and linked to their project
    // This runs BEFORE snapshots are built so the imported logs get the
    // resolved projectId/sectorId on the very first import.
    // ------------------------------------------------------------------
    const distinctProjects = new Map<string, { name: string; code: string }>();
    const distinctSectors = new Map<string, { projectKey: string; name: string }>();
    // Don't create junk master rows from placeholder text.
    const PLACEHOLDER_NAMES = new Set(
      ["غير محدد", "بدون", "بدون مشروع", "بدون قطاع", "غير معروف", "-"].map((v) => norm(v))
    );
    for (let i = dataStart; i < allRows.length; i++) {
      const r = allRows[i];
      if (!r || r.every((c) => str(c) === "")) continue;
      const projName = rowProjectName(r);
      const projectKey = norm(projName);
      if (!projName || PLACEHOLDER_NAMES.has(projectKey)) continue;
      if (!distinctProjects.has(projectKey)) {
        distinctProjects.set(projectKey, { name: projName, code: rowProjectCode(r) });
      }
      const secName = rowSectorName(r);
      const sectorKey = norm(secName);
      if (secName && !PLACEHOLDER_NAMES.has(sectorKey)) {
        distinctSectors.set(`${projectKey}|${sectorKey}`, { projectKey, name: secName });
      }
    }

    const projectIdByKey = new Map<string, number>();
    let createdProjects = 0;
    for (const [key, info] of distinctProjects) {
      const matched = matchProjectId(master, info.name, info.code || null);
      const id = matched ?? (await ensureProjectByName(info.name));
      if (matched == null) createdProjects++;
      projectIdByKey.set(key, id);
    }
    if (createdProjects > 0) master = await loadMaster();

    let createdSectors = 0;
    for (const info of distinctSectors.values()) {
      const projectId = projectIdByKey.get(info.projectKey);
      if (projectId == null) continue;
      if (matchSectorId(master, projectId, info.name) != null) continue;
      await ensureSector(projectId, info.name);
      createdSectors++;
    }
    if (createdSectors > 0) master = await loadMaster();

    if (createdProjects > 0 || createdSectors > 0) {
      result.warnings.push(
        `تم إنشاء ${createdProjects} مشروع و${createdSectors} قطاع تلقائيًا من ملف اليومية.`
      );
    }

    interface DlRow {
      rowNo: number;
      code: string;
      projName: string;
      secName: string;
      data: {
        date: Date;
        endMeter: number | null;
        operatingHours: number | null;
        diesel: number | null;
        productivityType: string | null;
        productivityCount: number | null;
        condition: Condition | null;
        conditionNote: string | null;
        notes: string | null;
      } & Partial<DailyLogSnapshot>;
    }
    const parsed: DlRow[] = [];
    const equipNameByCode = new Map<string, string>();
    const equipSerialByCode = new Map<string, number>();
    /** (مشروع|رقم تسلسلي) → كود المعدة — لمنع تكرار رقم داخل نفس المشروع. */
    const serialOwner = new Map<string, string>();
    for (let i = dataStart; i < allRows.length; i++) {
      const r = allRows[i];
      if (r.every((c) => str(c) === "")) continue;
      const code = g(r, cCode);
      const date = cDate != null ? parseDate(r[cDate]) : null;
      if (!date || !code) {
        pushErr(i + 1, !date ? "التاريخ غير صالح" : "كود المعدة مطلوب");
        continue;
      }
      const condCell = g(r, cCond);
      const cond = conditionOf(condCell);
      const condNote = g(r, cCondNote) || (cond == null ? condCell : "");
      const prodCell = g(r, cProdType);
      const prodCountCell = gn(r, cProdCount);
      const prodNumber = prodCell === "" ? null : Number(prodCell);
      // خلية الإنتاجية القديمة: رقم يعني عدد، وغير الرقمي يعني النوع
      const prodIsCount = prodCountCell == null && prodNumber != null && Number.isFinite(prodNumber);

      const projNameText = rowProjectName(r);
      const projCodeText = rowProjectCode(r);
      const secNameText = rowSectorName(r);
      const serialText = serialIndex != null ? g(r, serialIndex) : "";
      if (serialText) equipNameByCode.set(code, serialText);
      // الرقم التسلسلي في الشيت بنفس صيغة الترقيم التلقائي (كود المشروع × مليون + تسلسل)
      const serialNum = Number(serialText);
      if (serialText && Number.isInteger(serialNum) && serialNum >= 100000) {
        const serialKey = `${norm(projNameText)}|${serialNum}`;
        const owner = serialOwner.get(serialKey);
        if (owner == null || owner === code) {
          serialOwner.set(serialKey, code);
          equipSerialByCode.set(code, serialNum);
        }
      }
      const projectId =
        projectIdByKey.get(norm(projNameText)) ??
        matchProjectId(master, projNameText || null, projCodeText || null);
      const sectorId = matchSectorId(master, projectId, secNameText || null);
      const snapshot = buildImportedSnapshot(
        { projectName: projNameText, projectCode: projCodeText, sectorName: secNameText },
        effectiveLayout,
        { projectId, sectorId }
      );

      parsed.push({
        rowNo: i + 1,
        code,
        projName: projNameText,
        secName: secNameText,
        data: {
          date,
          endMeter: gn(r, cEnd),
          operatingHours: gn(r, cHours),
          diesel: gn(r, cDiesel),
          productivityType: prodIsCount ? null : prodCell || null,
          productivityCount: prodCountCell ?? (prodIsCount ? prodNumber : null),
          condition: cond,
          conditionNote: condNote || null,
          notes: g(r, cNotes) || null,
          ...(snapshot ?? {}),
        },
      });
    }

    await resolveEquipmentBatch(
      parsed.map((p) => p.code),
      eqCache,
      equipNameByCode,
      equipSerialByCode
    );
    for (const p of parsed) rememberMeta(p.code, p.projName, p.secName);

    // آخر صف داخل الملف بنفس (التاريخ + المعدة) بغلب
    const byKey = new Map<string, DlRow>();
    for (const p of parsed) byKey.set(dayKey(p.data.date, eqCache.get(p.code)!), p);
    const rows = [...byKey.values()];

    const eqIds = [...new Set(rows.map((p) => eqCache.get(p.code)!))];
    const dates = [...new Set(rows.map((p) => p.data.date))];
    const existing = await prisma.dailyLog.findMany({
      where: { equipmentId: { in: eqIds }, date: { in: dates } },
      select: {
        id: true,
        date: true,
        equipmentId: true,
        endMeter: true,
        operatingHours: true,
        diesel: true,
        productivityType: true,
        productivityCount: true,
        condition: true,
        conditionNote: true,
        notes: true,
        projectId: true,
        projectCode: true,
        projectName: true,
        sectorId: true,
        sectorName: true,
        contextSource: true,
        userId: true,
      },
    });
    const exMap = new Map(existing.map((e) => [dayKey(e.date, e.equipmentId), e]));

    const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
    // السجل المستورد بيتنسب للمستخدم اللي رفع الملف — فلو كان مسجل باسم
    // مستخدم تاني أو بدون مستخدم (استيراد قديم) بيتحدّث لاسم الرافع.
    const unchanged = (ex: (typeof existing)[number], d: DlRow["data"]) =>
      (userId == null || ex.userId === userId) &&
      same(ex.endMeter, d.endMeter) &&
      same(ex.operatingHours, d.operatingHours) &&
      same(ex.diesel, d.diesel) &&
      same(ex.productivityType, d.productivityType) &&
      same(ex.productivityCount, d.productivityCount) &&
      same(ex.condition, d.condition) &&
      same(ex.conditionNote, d.conditionNote) &&
      same(ex.notes, d.notes) &&
      // Snapshot is compared only when the workbook actually provided columns.
      ("contextSource" in d
        ? same(ex.projectId, d.projectId) &&
          same(ex.projectCode, d.projectCode) &&
          same(ex.projectName, d.projectName) &&
          same(ex.sectorId, d.sectorId) &&
          same(ex.sectorName, d.sectorName) &&
          same(ex.contextSource, d.contextSource)
        : true);

    const creates: DlRow[] = [];
    const updates: { id: number; data: DlRow["data"] }[] = [];
    for (const p of rows) {
      const ex = exMap.get(dayKey(p.data.date, eqCache.get(p.code)!));
      if (!ex) creates.push(p);
      else if (!unchanged(ex, p.data)) updates.push({ id: ex.id, data: p.data });
      else result.updated++;
    }

    // If the sheet has no project/sector columns, never touch an existing
    // stored snapshot (nothing legitimate to replace it with).
    const updateData = (d: DlRow["data"]) => {
      if (layout.hasProject || layout.hasSector) return d;
      const copy = { ...d };
      delete copy.projectId;
      delete copy.projectCode;
      delete copy.projectName;
      delete copy.sectorId;
      delete copy.sectorName;
      delete copy.contextSource;
      return copy;
    };

    for (const c of chunk(creates, 500)) {
      const res = await prisma.dailyLog.createMany({
        // الاستيراد بيتعامل مع البيانات كأنها مدخلة من المستخدم اللي رفع الملف
        data: c.map((p) => ({
          ...p.data,
          equipmentId: eqCache.get(p.code)!,
          ...(userId ? { userId } : {}),
        })),
        skipDuplicates: true,
      });
      result.created += res.count;
    }
    if (creates.length > 0) {
      // createMany لا يُرجع المعرّفات — نعيد جلب السجلات بالمفتاح (التاريخ + المعدة) لتتبّع الاستيراد
      const newKeys = new Set(creates.map((p) => dayKey(p.data.date, eqCache.get(p.code)!)));
      const made = await prisma.dailyLog.findMany({
        where: { equipmentId: { in: eqIds }, date: { in: dates } },
        select: { id: true, date: true, equipmentId: true },
      });
      createdIds.push(...made.filter((m) => newKeys.has(dayKey(m.date, m.equipmentId))).map((m) => m.id));
    }
    for (const c of chunk(updates, 100)) {
      await prisma.$transaction(
        c.map((u) =>
          prisma.dailyLog.update({
            where: { id: u.id },
            data: { ...updateData(u.data), ...(userId ? { userId } : {}) },
          })
        )
      );
      result.updated += c.length;
    }
  } else if (entity === "maintenance") {
    const legacy = headers.some((c) => norm(c) === "الصنف");

    interface PendingOrder {
      key: string;
      rowNo: number;
      workOrderNo: number | null;
      date: Date;
      endDate: Date | null;
      code: string;
      projName: string;
      secName: string;
      orderType: string | null;
      maintenanceType: string | null;
      workshop: string | null;
      meterReading: number | null;
      kmMeter: number | null;
      status: WorkStatus;
      workType: WorkType;
      description: string | null;
      action: string | null;
      notes: string | null;
      parts: { name: string; code: string | null; qty: number | null; notes: string | null }[];
    }

    const pending = new Map<string, PendingOrder>();

    for (let i = dataStart; i < allRows.length; i++) {
      const r = allRows[i];
      if (r.every((c) => str(c) === "")) continue;
      const rowNo = i + 1;

      let parsed: PendingOrder;
      if (legacy) {
        // صيغة الشيت القديم (Sheet3): ترتيب أعمدة ثابت
        const workOrderNo = numOrNull(r[0]);
        const date = parseDate(r[1]);
        const code = str(r[4]);
        if (!date || !code) {
          pushErr(rowNo, !date ? "التاريخ غير صالح" : "كود المعدة مطلوب");
          continue;
        }
        const maintType = str(r[10]) || null;
        parsed = {
          key: workOrderNo != null ? `wo:${workOrderNo}` : `row:${rowNo}`,
          rowNo,
          workOrderNo,
          date,
          endDate: parseDate(r[9]),
          code,
          projName: str(r[3]),
          secName: str(r[5]),
          orderType: str(r[2]) || null,
          maintenanceType: maintType,
          workshop: str(r[8]) || null,
          meterReading: numOrNull(r[6]),
          kmMeter: numOrNull(r[7]),
          status: workStatusOf(r[13]) ?? "NEW",
          workType: workTypeOf(maintType),
          description: str(r[11]) || null,
          action: str(r[12]) || null,
          notes: str(r[16]) || null,
          parts: str(r[19])
            ? [{ name: str(r[19]), code: str(r[22]) || null, qty: numOrNull(r[23]), notes: str(r[26]) || null }]
            : [],
        };
      } else {
        const cWo = col(["رقم أمر الشغل", "رقم امر الشغل"]);
        const cDate = col(["التاريخ"]);
        const cEnd = col(["تاريخ الانتهاء"]);
        const cCode = col(["كود المعدة", "الكود"]);
        const cOrderType = col(["نوع الأمر", "نوع امر الشغل"]);
        const cMaintType = col(["نوع الصيانة"]);
        const cWorkshop = col(["الورشة"]);
        const cMeter = col(["العداد"]);
        const cKm = col(["كم العداد"]);
        const cStatus = col(["الحالة"]);
        const cWorkType = col(["نوع العمل"]);
        const cDesc = col(["وصف العطل"]);
        const cAction = col(["الإجراء"]);
        const cNotes = col(["ملاحظات"]);
        const cParts = col(["الأصناف"]);
        const cProj = col(["المشروع", "المشروع:"]);
        const cSec = col(["القطاع"]);
        if (cDate == null) {
          fail(
            `الشيت «${chosen.name}» مش جدول أوامر شغل — مفيش عمود «التاريخ». الملف فيه الشيتات: ${sheets
              .map((s) => s.name)
              .join("، ")} — اختر شيت سجل الصيانة (زي Sheet3) من قائمة الشيتات.`,
            400
          );
        }

        const workOrderNo = gn(r, cWo);
        const date = cDate != null ? parseDate(r[cDate]) : null;
        const code = g(r, cCode);
        if (!date || !code) {
          pushErr(rowNo, !date ? "التاريخ غير صالح" : "كود المعدة مطلوب");
          continue;
        }
        const maintType = g(r, cMaintType);
        parsed = {
          key: workOrderNo != null ? `wo:${workOrderNo}` : `row:${rowNo}`,
          rowNo,
          workOrderNo,
          date,
          endDate: cEnd != null ? parseDate(r[cEnd]) : null,
          code,
          projName: g(r, cProj),
          secName: g(r, cSec),
          orderType: g(r, cOrderType) || null,
          maintenanceType: maintType || null,
          workshop: g(r, cWorkshop) || null,
          meterReading: gn(r, cMeter),
          kmMeter: gn(r, cKm),
          status: workStatusOf(g(r, cStatus)) ?? "NEW",
          workType: workTypeOf(g(r, cWorkType) || maintType),
          description: g(r, cDesc) || null,
          action: g(r, cAction) || null,
          notes: g(r, cNotes) || null,
          parts: parsePartsCell(g(r, cParts)),
        };
      }

      const existingOrder = pending.get(parsed.key);
      if (existingOrder) {
        if (parsed.parts.length > 0) existingOrder.parts.push(...parsed.parts);
        continue;
      }
      pending.set(parsed.key, parsed);
    }

    const orders = [...pending.values()];
    await resolveEquipmentBatch(
      orders.map((o) => o.code),
      eqCache
    );

    const woNos = orders.map((o) => o.workOrderNo).filter((n): n is number => n != null);
    const existingOrders =
      woNos.length > 0
        ? await prisma.maintenance.findMany({
            where: { workOrderNo: { in: woNos } },
            select: {
              id: true,
              workOrderNo: true,
              date: true,
              endDate: true,
              equipment: { select: { code: true } },
              workType: true,
              orderType: true,
              maintenanceType: true,
              workshop: true,
              meterReading: true,
              kmMeter: true,
              status: true,
              description: true,
              action: true,
              notes: true,
              workParts: { select: { name: true, code: true, qty: true, notes: true }, orderBy: { id: "asc" } },
            },
          })
        : [];
    const exWo = new Map(existingOrders.map((e) => [e.workOrderNo!, e]));

    const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
    const orderUnchanged = (ex: (typeof existingOrders)[number], o: PendingOrder) => {
      const eq = ex.workParts.map((p) => ({ name: p.name, code: p.code, qty: p.qty, notes: p.notes }));
      const op = o.parts.map((p) => ({ name: p.name, code: p.code, qty: p.qty, notes: p.notes }));
      return (
        same(ex.date.toISOString().slice(0, 10), o.date.toISOString().slice(0, 10)) &&
        same(ex.endDate?.toISOString().slice(0, 10) ?? null, o.endDate?.toISOString().slice(0, 10) ?? null) &&
        ex.equipment.code === o.code &&
        ex.workType === o.workType &&
        same(ex.orderType, o.orderType) &&
        same(ex.maintenanceType, o.maintenanceType) &&
        same(ex.workshop, o.workshop) &&
        same(ex.meterReading, o.meterReading) &&
        same(ex.kmMeter, o.kmMeter) &&
        ex.status === o.status &&
        same(ex.description, o.description) &&
        same(ex.action, o.action) &&
        same(ex.notes, o.notes) &&
        eq.length === op.length &&
        eq.every((p, i) => p.name === op[i].name && same(p.code, op[i].code) && same(p.qty, op[i].qty) && same(p.notes, op[i].notes))
      );
    };

    const saveOrder = async (order: PendingOrder) => {
      try {
        const equipmentId = eqCache.get(order.code)!;
        rememberMeta(order.code, order.projName, order.secName);
        const data = {
          workOrderNo: order.workOrderNo,
          date: order.date,
          endDate: order.endDate,
          equipmentId,
          workType: order.workType,
          orderType: order.orderType,
          maintenanceType: order.maintenanceType,
          workshop: order.workshop,
          meterReading: order.meterReading,
          kmMeter: order.kmMeter,
          status: order.status,
          description: order.description,
          action: order.action,
          notes: order.notes,
        };
        const ex = order.workOrderNo != null ? exWo.get(order.workOrderNo) : undefined;
        if (ex) {
          if (!orderUnchanged(ex, order)) {
            await prisma.maintenance.update({
              where: { id: ex.id },
              data: { ...data, workParts: { deleteMany: {}, create: order.parts } },
            });
          }
          result.updated++;
        } else {
          const made = await prisma.maintenance.create({
            data: { ...data, workParts: { create: order.parts } },
          });
          createdIds.push(made.id);
          result.created++;
        }
      } catch {
        pushErr(order.rowNo, "تعذّر حفظ أمر الشغل");
      }
    };
    for (const c of chunk(orders, 10)) {
      await Promise.all(c.map(saveOrder));
    }
  } else if (entity === "partschedules") {
    const cCode = col(["كود المعدة", "الكود"]);
    const cPart = col(["الصنف", "اسم الصنف"]);
    const cInterval = col(["الفترة"]);
    const cUnit = col(["الوحدة"]);
    const cNotes = col(["ملاحظات"]);

    interface PsRow {
      rowNo: number;
      code: string;
      partName: string;
      interval: number;
      unit: string;
      notes: string | null;
    }
    const byKey = new Map<string, PsRow>();
    for (let i = dataStart; i < allRows.length; i++) {
      const r = allRows[i];
      if (r.every((c) => str(c) === "")) continue;
      const code = g(r, cCode);
      const partName = g(r, cPart);
      const interval = gn(r, cInterval);
      if (!code || !partName || interval == null || interval <= 0) {
        pushErr(i + 1, "الكود والصنف والفترة مطلوبة");
        continue;
      }
      byKey.set(`${code}|${partName}`, {
        rowNo: i + 1,
        code,
        partName,
        interval,
        unit: g(r, cUnit) || "ساعة",
        notes: g(r, cNotes) || null,
      });
    }

    const rows = [...byKey.values()];
    await resolveEquipmentBatch(
      rows.map((p) => p.code),
      eqCache
    );

    const eqIds = [...new Set(rows.map((p) => eqCache.get(p.code)!))];
    const existing = await prisma.partSchedule.findMany({
      where: { equipmentId: { in: eqIds } },
      select: { id: true, equipmentId: true, partName: true },
    });
    const exMap = new Map(existing.map((e) => [`${e.equipmentId}|${e.partName}`, e.id]));

    const saveOne = async (p: PsRow) => {
      try {
        const equipmentId = eqCache.get(p.code)!;
        const exId = exMap.get(`${equipmentId}|${p.partName}`);
        const data = { interval: p.interval, unit: p.unit, notes: p.notes };
        if (exId) {
          await prisma.partSchedule.update({ where: { id: exId }, data });
          result.updated++;
        } else {
          const made = await prisma.partSchedule.create({ data: { equipmentId, partName: p.partName, ...data } });
          createdIds.push(made.id);
          result.created++;
        }
      } catch {
        pushErr(p.rowNo, "تعذّر حفظ موعد الصنف");
      }
    };
    for (const c of chunk(rows, 12)) {
      await Promise.all(c.map(saveOne));
    }
  } else {
    fail("لا يمكن استيراد هذا الجدول", 400);
  }

  await applyEqMeta();
  // تسجيل الاستيراد ليظهر في «سجل الشيتات» ويتمكّن المستخدم من حذف بيانات هذا الشيت لاحقًا
  await prisma.importLog.create({
    data: {
      entity,
      fileName: fileName || "—",
      sheetName: chosen.name,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      createdIds,
    },
  });
  return result;
}

const CLEARABLE: Record<Exclude<Entity, "users">, () => Promise<number>> = {
  projects: async () => (await prisma.project.deleteMany()).count,
  equipments: async () => (await prisma.equipment.deleteMany()).count,
  dailylogs: async () => (await prisma.dailyLog.deleteMany()).count,
  maintenance: async () => (await prisma.maintenance.deleteMany()).count,
  partschedules: async () => (await prisma.partSchedule.deleteMany()).count,
};

export async function clearEntity(entity: Entity) {
  if (entity === "users") fail("لا يمكن مسح جدول المستخدمين", 400);
  projectNameCache.clear();
  const count = await CLEARABLE[entity]();
  // سجلات الاستيراد الخاصة بهذا الجدول باتت بلا معنى بعد المسح الكامل
  await prisma.importLog.deleteMany({ where: { entity } });
  return { message: "تم مسح البيانات", deleted: count };
}

/**
 * Wipe all operational data in a single transaction.
 *
 * Order matters: leaf tables first, roots last. The previous version never
 * deleted ProjectSector, whose relations to Project and Sector are Restrict,
 * so sector/project deletion failed with a foreign-key error (P2003).
 * RepairOrder, NeedRequest and Fault reference ProjectSector with Restrict too,
 * so they must be removed before it. Users and equipment categories are kept.
 */
export async function clearAll() {
  projectNameCache.clear();
  const [
    workParts,
    repairParts,
    repairOrderEvents,
    needRequestItems,
    repairOrders,
    needRequests,
    faults,
    oilConsumptions,
    meterResets,
    dailyLogs,
    maintenance,
    oilSchedules,
    partSchedules,
    projectSectors,
    userProjects,
    equipmentAssignments,
    equipment,
    sectors,
    projects,
    auditLogs,
    importLogs,
  ] = await prisma.$transaction([
    prisma.workPart.deleteMany(),
    prisma.repairPart.deleteMany(),
    prisma.repairOrderEvent.deleteMany(),
    prisma.needRequestItem.deleteMany(),
    prisma.repairOrder.deleteMany(),
    prisma.needRequest.deleteMany(),
    prisma.fault.deleteMany(),
    prisma.oilConsumption.deleteMany(),
    prisma.meterReset.deleteMany(),
    prisma.dailyLog.deleteMany(),
    prisma.maintenance.deleteMany(),
    prisma.oilSchedule.deleteMany(),
    prisma.partSchedule.deleteMany(),
    prisma.projectSector.deleteMany(),
    prisma.userProject.deleteMany(),
    prisma.equipmentAssignment.deleteMany(),
    prisma.equipmentTransferRequest.deleteMany(),
    prisma.equipment.deleteMany(),
    prisma.sector.deleteMany(),
    prisma.project.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.importLog.deleteMany(),
  ]);

  return {
    message: "تم مسح كل البيانات وإبقاء المستخدمين",
    deleted: {
      workParts: workParts.count,
      repairParts: repairParts.count,
      repairOrderEvents: repairOrderEvents.count,
      needRequestItems: needRequestItems.count,
      repairOrders: repairOrders.count,
      needRequests: needRequests.count,
      faults: faults.count,
      oilConsumptions: oilConsumptions.count,
      meterResets: meterResets.count,
      dailyLogs: dailyLogs.count,
      maintenance: maintenance.count,
      oilSchedules: oilSchedules.count,
      partSchedules: partSchedules.count,
      projectSectors: projectSectors.count,
      userProjects: userProjects.count,
      equipmentAssignments: equipmentAssignments.count,
      equipment: equipment.count,
      sectors: sectors.count,
      projects: projects.count,
      auditLogs: auditLogs.count,
      importLogs: importLogs.count,
    },
  };
}

export interface ImportLogRow {
  id: number;
  entity: Entity;
  fileName: string;
  sheetName: string;
  created: number;
  updated: number;
  skipped: number;
  createdAt: Date;
}

export async function listImports(): Promise<ImportLogRow[]> {
  const rows = await prisma.importLog.findMany({
    orderBy: { id: "desc" },
    take: 200,
    select: {
      id: true,
      entity: true,
      fileName: true,
      sheetName: true,
      created: true,
      updated: true,
      skipped: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, entity: r.entity as Entity }));
}

export async function deleteImport(id: number): Promise<{ deleted: number; cascadeDeleted: number }> {
  const log = await prisma.importLog.findUnique({ where: { id } });
  if (!log) fail("سجل الاستيراد غير موجود", 404);

  const rawIds = Array.isArray(log.createdIds) ? log.createdIds : [];
  const ids = rawIds.filter((n): n is number => typeof n === "number");
  let deleted = 0;
  // السجلات المرتبطة اللي بتمسح مع السجلات الأساسية (Cascade) — تُعرض للمستخدم قبل التأكيد وبعده
  let cascadeDeleted = 0;

  // حذف على دفعات عشان استيراد ضخم (عشرات الآلاف) ما يكسّر حدود معاملات PostgreSQL
  const doDelete = async (del: (part: number[]) => Promise<{ count: number }>) => {
    let total = 0;
    for (const part of chunk(ids, 1000)) total += (await del(part)).count;
    return total;
  };

  if (ids.length > 0) {
    if (log.entity === "equipments") {
      // حذف المعدات بيمسح معها كل بياناتها المرتبطة تلقائيًا (سجل يومي، صيانة، أعطال، أوامر إصلاح، مواعيد، عدادات)
      const [dailyLogs, maintenance, faults, repairOrders, partSchedules, oilSchedules, meterResets] =
        await Promise.all([
          prisma.dailyLog.count({ where: { equipmentId: { in: ids } } }),
          prisma.maintenance.count({ where: { equipmentId: { in: ids } } }),
          prisma.fault.count({ where: { equipmentId: { in: ids } } }),
          prisma.repairOrder.count({ where: { equipmentId: { in: ids } } }),
          prisma.partSchedule.count({ where: { equipmentId: { in: ids } } }),
          prisma.oilSchedule.count({ where: { equipmentId: { in: ids } } }),
          prisma.meterReset.count({ where: { equipmentId: { in: ids } } }),
        ]);
      cascadeDeleted =
        dailyLogs + maintenance + faults + repairOrders + partSchedules + oilSchedules + meterResets;
      deleted = await doDelete((part) => prisma.equipment.deleteMany({ where: { id: { in: part } } }));
    } else if (log.entity === "projects") {
      // حذف المشاريع بيمسح القطاعات التابعة لها — والمعدات المرتبطة تفقد الربط فقط (SetNull)
      cascadeDeleted = await prisma.sector.count({ where: { projectId: { in: ids } } });
      deleted = await doDelete((part) => prisma.project.deleteMany({ where: { id: { in: part } } }));
      projectNameCache.clear();
    } else if (log.entity === "dailylogs") {
      deleted = await doDelete((part) => prisma.dailyLog.deleteMany({ where: { id: { in: part } } }));
    } else if (log.entity === "maintenance") {
      // الأصناف المرتبطة بأمر الشغل بتحذف معه تلقائيًا (Cascade)
      cascadeDeleted = await prisma.workPart.count({ where: { maintenanceId: { in: ids } } });
      deleted = await doDelete((part) => prisma.maintenance.deleteMany({ where: { id: { in: part } } }));
    } else if (log.entity === "partschedules") {
      deleted = await doDelete((part) => prisma.partSchedule.deleteMany({ where: { id: { in: part } } }));
    }
  }

  await prisma.importLog.delete({ where: { id } });
  return { deleted, cascadeDeleted };
}

export interface ManagersProjectsSyncResult {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  sectors: ManagersSectorsSyncSummary;
}

export interface ManagersSectorsSyncSummary {
  created: number;
  linked: number;
  unchanged: number;
  skipped: number;
  stale: number;
  error: string | null;
}

/**
 * جلب كل مشاريع نظام المدرين (/requisitions/projects) ومزامنتها مع المشاريع المحلية:
 * المطابقة بالكود أولًا ثم بالاسم (بعد التطبيع العربي) — المشروع الموجود بيتحدّث واللي مش موجود بيتعمل جديد.
 * ومع كل مشروع بتتجلب قطاعاته المصرّح بها (rooms[]) وتترابط به (انظر syncSectorsForProject).
 * لو حصل أي تغيير بيتتسجّل في سجل الاستيراد عشان يظهر في «إدارة البيانات» ويتمكّن ROOT من حذفه.
 */
export async function syncProjectsFromManagers(): Promise<ManagersProjectsSyncResult> {
  const remote = await managersProjects(true);
  const result: ManagersProjectsSyncResult = {
    fetched: remote.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    sectors: { created: 0, linked: 0, unchanged: 0, skipped: 0, stale: 0, error: null },
  };
  const createdIds: number[] = [];

  const local = await prisma.project.findMany({ select: { id: true, code: true, name: true } });
  const byCode = new Map<string, (typeof local)[number]>();
  const byName = new Map<string, (typeof local)[number]>();
  for (const p of local) {
    if (p.code) byCode.set(p.code.trim().toLowerCase(), p);
    const n = normalizeArabic(p.name).replace(/\s+/g, "");
    if (n && !byName.has(n)) byName.set(n, p);
  }

  for (const r of remote) {
    const remoteName = normalizeArabic(r.title).replace(/\s+/g, "");
    const match =
      (r.code ? byCode.get(r.code.trim().toLowerCase()) : undefined) ??
      (remoteName ? byName.get(remoteName) : undefined);

    let localId: number;
    if (!match) {
      const made = await prisma.project.create({ data: { code: r.code, name: r.title } });
      createdIds.push(made.id);
      result.created++;
      localId = made.id;
      if (r.code) byCode.set(r.code.trim().toLowerCase(), made);
      if (remoteName && !byName.has(remoteName)) byName.set(remoteName, made);
    } else {
      localId = match.id;
      const data: { name?: string; code?: string | null } = {};
      if (match.name !== r.title) data.name = r.title;
      if (r.code && match.code !== r.code) {
        // الكود عليه قيد فريد محليًا — لو مشغول من مشروع تاني نكتفي بتحديث الاسم
        const owner = await prisma.project.findUnique({ where: { code: r.code }, select: { id: true } });
        if (!owner || owner.id === match.id) data.code = r.code;
      }
      if (Object.keys(data).length > 0) {
        await prisma.project.update({ where: { id: match.id }, data });
        result.updated++;
      } else {
        result.unchanged++;
      }
    }

    // مزامنة القطاعات ما توقّفش مزامنة المشاريع: أي فشل بيتبلّغ في النتيجة ونكمّل
    try {
      const sectors = await syncSectorsForProject(localId, r.rooms);
      result.sectors.created += sectors.created;
      result.sectors.linked += sectors.linked;
      result.sectors.unchanged += sectors.unchanged;
      result.sectors.skipped += sectors.skipped.length;
      result.sectors.stale += sectors.stale.length;
    } catch (err) {
      result.sectors.error = err instanceof Error ? err.message : String(err);
    }
  }

  if (result.created > 0 || result.updated > 0 || result.sectors.created > 0 || result.sectors.linked > 0) {
    await prisma.importLog.create({
      data: {
        entity: "projects",
        fileName: "نظام المدرين",
        sheetName: `مزامنة تلقائية للمشاريع والقطاعات (${result.sectors.created} قطاع جديد)`,
        created: result.created,
        updated: result.updated,
        skipped: 0,
        createdIds,
      },
    });
  }
  return result;
}

const envSyncInterval = Number(process.env.PROJECTS_SYNC_INTERVAL_MIN);
const PROJECTS_SYNC_INTERVAL_MS =
  (Number.isFinite(envSyncInterval) && envSyncInterval > 0 ? envSyncInterval : 60) * 60 * 1000;

/**
 * مزامنة تلقائية لمشاريع نظام المدرين: تشتغل مرة عند تشغيل السيرفر ثم كل ساعة —
 * بتشتغل في الخلفية وما بتوقفش السيرفر لو نظام المدرين مغلّق (بتتسجّل محاولة فاشلة ونستنى اللفة الجاية).
 */
export function startProjectsAutoSync(intervalMs = PROJECTS_SYNC_INTERVAL_MS) {
  const run = async () => {
    try {
      const result = await withDbRetry(() => syncProjectsFromManagers());
      console.log(
        `[projects-sync] ${result.fetched} مشروع من نظام المدرين — ${result.created} جديد، ${result.updated} تحديث، ${result.unchanged} بدون تغيير | قطاعات: ${result.sectors.created} جديد، ${result.sectors.linked} ربط، ${result.sectors.unchanged} موجود${
          result.sectors.error ? ` | فشل: ${result.sectors.error}` : ""
        }`
      );
    } catch (err) {
      console.warn(
        `[projects-sync] تعذّرت مزامنة المشاريع من نظام المدرين: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };
  // تأخير بسيط عن الإقلاع عشان القاعدة تستيقظ والسيرفر يفتح أوّلًا
  const boot = setTimeout(run, 15_000);
  boot.unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => {
    clearTimeout(boot);
    clearInterval(timer);
  };
}

export async function stats() {
  const [projects, sectors, equipment, dailyLogs, maintenance, workParts, partSchedules, faults, users] =
    await Promise.all([
      prisma.project.count(),
      prisma.sector.count(),
      prisma.equipment.count(),
      prisma.dailyLog.count(),
      prisma.maintenance.count(),
      prisma.workPart.count(),
      prisma.partSchedule.count(),
      prisma.fault.count(),
      prisma.user.count(),
    ]);
  return {
    projects,
    sectors,
    equipment,
    dailyLogs,
    maintenance,
    workParts,
    partSchedules,
    faults,
    users,
  };
}
