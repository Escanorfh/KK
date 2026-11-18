/**
 * Excel column detection and DailyLog snapshot mapping.
 *
 * The DailyLog project/sector snapshot must come ONLY from the imported Excel
 * row. This module is intentionally pure (no Prisma, no Managers, no equipment
 * lookups) so that:
 *   - the parser can be tested in isolation;
 *   - no other source can accidentally fill or replace an imported value.
 *
 * Master-data matching is passed in as pre-built indexes. A match only decides
 * `projectId`/`sectorId`; the Excel text is always preserved verbatim in
 * `projectCode`/`projectName`/`sectorName`.
 */

export const DAILYLOG_PROJECT_NAME_ALIASES = [
  "المشروع",
  "المشروع:",
  "اسم المشروع",
  "اسم المشروع:",
];

export const DAILYLOG_PROJECT_CODE_ALIASES = [
  "كود المشروع",
  "كود المشروع:",
  "رمز المشروع",
];

export const DAILYLOG_SECTOR_ALIASES = ["القطاع", "القطاع:", "اسم القطاع", "اسم القطاع:"];

/** Equipment code column (the registry key). */
export const DAILYLOG_EQUIPMENT_CODE_ALIASES = ["كود المعدة", "كود المعدة:", "الكود"];

/** Serial number column — used as a fallback key when no code column exists. */
export const DAILYLOG_SERIAL_ALIASES = [
  "الرقم التسلسلي",
  "الرقم التسلسلى",
  "الرقم المسلسل",
  "المسلسل",
  "السيريال",
  "serial",
];

/** Same normalization the Excel importer has always used for headers. */
export function normHeader(v: unknown): string {
  return String(v ?? "")
    .replace(/[:：]/g, "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Locate a column by aliases: exact normalized match first, then `includes`. */
export function makeColFinder(headers: unknown[]) {
  const norms = headers.map(normHeader);
  return (aliases: string[]): number | null => {
    const as = aliases.map(normHeader);
    for (const a of as) {
      const i = norms.indexOf(a);
      if (i !== -1) return i;
    }
    for (const a of as) {
      if (!a) continue;
      const i = norms.findIndex((n) => n.includes(a));
      if (i !== -1) return i;
    }
    return null;
  };
}

export interface DailyLogColumnLayout {
  /** Column holding the Excel project name, or null when not found. */
  projectNameIndex: number | null;
  /** Column holding the Excel project code, or null when not found. */
  projectCodeIndex: number | null;
  /** Column holding the Excel sector name, or null when not found. */
  sectorIndex: number | null;
  projectNameHeader: string | null;
  projectCodeHeader: string | null;
  sectorHeader: string | null;
  /** True when at least one project column was recognized. */
  hasProject: boolean;
  hasSector: boolean;
  /** Human-readable warnings for the import preview / result. */
  warnings: string[];
}

/**
 * Detect the project/sector columns for DailyLog imports.
 *
 * A project-code header (e.g. "كود المشروع") must never be mistaken for the
 * project-name column, so name aliases skip headers that contain "كود".
 */
export function detectDailyLogColumns(headers: unknown[]): DailyLogColumnLayout {
  const norms = headers.map(normHeader);
  const headerAt = (i: number | null) => (i == null ? null : String(headers[i] ?? "").trim() || null);

  const findExact = (aliases: string[]) => {
    const as = aliases.map(normHeader);
    for (const a of as) {
      const i = norms.indexOf(a);
      if (i !== -1) return i;
    }
    return null;
  };

  const findLoose = (aliases: string[], allow: (n: string) => boolean) => {
    for (const a of aliases.map(normHeader)) {
      if (!a) continue;
      const i = norms.findIndex((n) => allow(n) && n.includes(a));
      if (i !== -1) return i;
    }
    return null;
  };

  const codeIndex =
    findExact(DAILYLOG_PROJECT_CODE_ALIASES) ??
    findLoose(DAILYLOG_PROJECT_CODE_ALIASES, () => true);

  const nameIndex =
    findExact(DAILYLOG_PROJECT_NAME_ALIASES) ??
    findLoose(DAILYLOG_PROJECT_NAME_ALIASES, (n) => !n.includes("كود") && n !== normHeader("رمز المشروع"));

  const safeNameIndex = nameIndex != null && nameIndex !== codeIndex ? nameIndex : null;
  const sectorIndex =
    findExact(DAILYLOG_SECTOR_ALIASES) ?? findLoose(DAILYLOG_SECTOR_ALIASES, () => true);

  const warnings: string[] = [];
  if (safeNameIndex == null && codeIndex == null) {
    warnings.push(
      "لم يتم العثور على عمود «المشروع» أو «كود المشروع» — مشروع السجلات سيُحفظ فارغًا (غير محدد)."
    );
  }
  if (sectorIndex == null) {
    warnings.push("لم يتم العثور على عمود «القطاع» — قطاع السجلات سيُحفظ فارغًا (غير محدد).");
  }

  return {
    projectNameIndex: safeNameIndex,
    projectCodeIndex: codeIndex,
    sectorIndex,
    projectNameHeader: headerAt(safeNameIndex),
    projectCodeHeader: headerAt(codeIndex),
    sectorHeader: headerAt(sectorIndex),
    hasProject: safeNameIndex != null || codeIndex != null,
    hasSector: sectorIndex != null,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Equipment key detection (code first, serial number as fallback)    */
/* ------------------------------------------------------------------ */

export interface DailyLogEquipmentLayout {
  /** Column holding "كود المعدة" — the preferred equipment key. */
  codeIndex: number | null;
  /** Column holding the serial number — used only when there is no code column. */
  serialIndex: number | null;
  codeHeader: string | null;
  serialHeader: string | null;
  /** The column the importer must use as the equipment key. */
  keyIndex: number | null;
  keySource: "code" | "serial" | null;
}

export function detectDailyLogEquipmentColumns(headers: unknown[]): DailyLogEquipmentLayout {
  const find = makeColFinder(headers);
  const codeIndex = find(DAILYLOG_EQUIPMENT_CODE_ALIASES);
  const serialIndex = find(DAILYLOG_SERIAL_ALIASES);
  const keySource =
    codeIndex != null ? "code" : serialIndex != null ? "serial" : null;
  const keyIndex = codeIndex ?? serialIndex;
  const headerAt = (i: number | null) =>
    i == null ? null : String(headers[i] ?? "").trim() || null;
  return {
    codeIndex,
    serialIndex,
    codeHeader: headerAt(codeIndex),
    serialHeader: headerAt(serialIndex),
    keyIndex,
    keySource,
  };
}

/* ------------------------------------------------------------------ */
/* Master-data matching (IDs only — never touches the Excel text)      */
/* ------------------------------------------------------------------ */

export interface MasterProjectRow {
  id: number;
  code: string | null;
  name: string;
}

export interface MasterSectorLinkRow {
  projectId: number;
  sectorId: number;
  sectorName: string;
}

export interface MasterIndex {
  projectByCode: Map<string, number | null>;
  projectByName: Map<string, number | null>;
  projectByNormName: Map<string, number | null>;
  sectorByProjectAndNorm: Map<string, number | null>;
}

/** `null` means "ambiguous" — more than one master row matches. */
function putUnique(map: Map<string, number | null>, key: string, id: number) {
  if (!key) return;
  const cur = map.get(key);
  if (cur === undefined) map.set(key, id);
  else if (cur !== id) map.set(key, null);
}

export function createMasterIndex(
  projects: MasterProjectRow[],
  sectorLinks: MasterSectorLinkRow[]
): MasterIndex {
  const index: MasterIndex = {
    projectByCode: new Map(),
    projectByName: new Map(),
    projectByNormName: new Map(),
    sectorByProjectAndNorm: new Map(),
  };
  for (const p of projects) {
    if (p.code) putUnique(index.projectByCode, p.code.trim(), p.id);
    putUnique(index.projectByName, p.name.trim(), p.id);
    putUnique(index.projectByNormName, normHeader(p.name), p.id);
  }
  for (const l of sectorLinks) {
    putUnique(index.sectorByProjectAndNorm, `${l.projectId}|${normHeader(l.sectorName)}`, l.sectorId);
  }
  return index;
}

/**
 * Resolve an existing project id. Order: exact code → exact name → normalized
 * name. Anything ambiguous returns null so we never guess.
 */
export function matchProjectId(
  index: MasterIndex,
  name: string | null,
  code: string | null
): number | null {
  if (code) {
    const byCode = index.projectByCode.get(code.trim());
    if (byCode !== undefined) return byCode;
  }
  if (name) {
    const exact = index.projectByName.get(name.trim());
    if (exact !== undefined) return exact;
    const normalized = index.projectByNormName.get(normHeader(name));
    if (normalized !== undefined) return normalized;
  }
  return null;
}

/** Resolve a sector only through an active ProjectSector link for that project. */
export function matchSectorId(
  index: MasterIndex,
  projectId: number | null,
  sectorName: string | null
): number | null {
  if (projectId == null || !sectorName) return null;
  const key = `${projectId}|${normHeader(sectorName)}`;
  const found = index.sectorByProjectAndNorm.get(key);
  return found ?? null;
}

/**
 * A cell sitting where a value is expected but that is itself a column label
 * (e.g. "نسبة تغيير الزيت" right after "القطاع" in the new day sheets).
 * Such cells must never be captured as project/sector values.
 */
function looksLikeLabelValue(v: string): boolean {
  const t = v.trim();
  if (!t || t.endsWith(":") || t.endsWith("：")) return true;
  const n = normHeader(t);
  return /^(معدل|نسب[هة]|عداد|عدد|ا[خب]ر|التاريخ|المشروع|القطاع|كود|زيت)/.test(n);
}

export function extractTitleProjectSector(
  rows: unknown[][],
  headerRowIdx: number
): { projectName: string | null; sectorName: string | null } {
  let projectName: string | null = null;
  let sectorName: string | null = null;
  const limit = Math.max(0, headerRowIdx);
  for (let i = 0; i <= limit; i++) {
    const r = rows[i] || [];
    for (let j = 0; j < r.length; j++) {
      const n = normHeader(r[j]);
      if ((n === "المشروع" || n === "المشروع:") && projectName == null) {
        for (let k = j + 1; k < r.length; k++) {
          const v = String(r[k] ?? "").trim();
          if (v && !looksLikeLabelValue(v)) {
            projectName = v;
            break;
          }
        }
      }
      if ((n === "القطاع" || n === "القطاع:") && sectorName == null) {
        for (let k = j + 1; k < r.length; k++) {
          const v = String(r[k] ?? "").trim();
          if (v && !looksLikeLabelValue(v)) {
            sectorName = v;
            break;
          }
        }
      }
    }
  }
  return { projectName, sectorName };
}

/** شكل القيمة اللي تنفع تكون تاريخ (سيريال إكسل أو نص dd/mm/yyyy). */
function looksLikeDateValue(v: unknown): boolean {
  if (typeof v === "number") return v > 30000 && v < 70000;
  const s = String(v ?? "").trim();
  if (!s) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return true;
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

/**
 * تاريخ الشيت نفسه: خلية «التاريخ:» اللي فوق رأس الجدول (زي `day!J3:K3`).
 *
 * شيتات اليومية فيها تاريخ واحد للشيت كله، وصفوف البيانات قد تخرج من إكسل
 * بخلية تاريخ فاضية (معادلة لسه ماتحسبتش / ماكرو مامَلّاش الصف). بدون
 * هذا الاحتياطي يُسقط المستورد الصف بالكامل — ومعه المعدة نفسها.
 */
export function extractTitleDate(rows: unknown[][], headerRowIdx: number): unknown | null {
  const limit = Math.max(0, headerRowIdx);
  for (let i = 0; i <= limit; i++) {
    const r = rows[i] || [];
    for (let j = 0; j < r.length; j++) {
      const n = normHeader(r[j]);
      if (n !== "التاريخ" && n !== "التاريخ:") continue;
      for (let k = j + 1; k < Math.min(r.length, j + 4); k++) {
        if (looksLikeDateValue(r[k])) return r[k];
      }
    }
  }
  return null;
}

export interface DailyLogSnapshot {
  projectId: number | null;
  projectCode: string | null;
  projectName: string | null;
  sectorId: number | null;
  sectorName: string | null;
  contextSource: "SNAPSHOT" | "UNKNOWN";
}

export interface DailyLogSnapshotCells {
  projectName: unknown;
  projectCode: unknown;
  sectorName: unknown;
}

/** Trim edges only; never rewrite the Arabic text itself. */
export function cellText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Build the snapshot for one Excel row.
 *
 * Returns `null` when the workbook has no project AND no sector column: in that
 * case the caller must leave any existing snapshot untouched (nothing was
 * imported that could legitimately replace it).
 */
export function buildImportedSnapshot(
  cells: DailyLogSnapshotCells,
  layout: Pick<DailyLogColumnLayout, "hasProject" | "hasSector">,
  match: { projectId: number | null; sectorId: number | null }
): DailyLogSnapshot | null {
  if (!layout.hasProject && !layout.hasSector) return null;

  const projectName = cellText(cells.projectName);
  const projectCode = cellText(cells.projectCode);
  const sectorName = cellText(cells.sectorName);

  const projectId = layout.hasProject ? match.projectId : null;
  const sectorId =
    layout.hasSector && projectId != null ? match.sectorId : null;

  return {
    projectId,
    projectCode,
    projectName,
    sectorId,
    sectorName,
    contextSource: projectName || projectCode || sectorName ? "SNAPSHOT" : "UNKNOWN",
  };
}

/**
 * Snapshot fields to write when re-importing over an existing row.
 *
 * - no detected project/sector column → `{}` (preserve what is already stored)
 * - detected columns → the Excel values win, including empty cells
 */
export function importedSnapshotForUpdate(
  incoming: DailyLogSnapshot | null
): Partial<DailyLogSnapshot> {
  return incoming ?? {};
}
