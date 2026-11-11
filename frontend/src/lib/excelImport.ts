// Client-side mirror of backend/src/modules/data/excelImport.ts detection.
// Used only for the import preview; the real mapping happens on the server.

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

export function extractTitleProjectSector(rows: unknown[][], headerRowIdx: number): { projectName: string | null; sectorName: string | null } {
  let projectName: string | null = null;
  let sectorName: string | null = null;
  const limit = Math.max(0, headerRowIdx);
  for (let i = 0; i <= limit; i++) {
    const r = (rows[i] || []) as unknown[];
    for (let j = 0; j < r.length; j++) {
      const n = normHeader(r[j]);
      if ((n === "المشروع" || n === "المشروع:") && projectName == null) {
        for (let k = j + 1; k < r.length; k++) {
          const v = String(r[k] ?? "").trim();
          if (v) { projectName = v; break; }
        }
      }
      if ((n === "القطاع" || n === "القطاع:") && sectorName == null) {
        for (let k = j + 1; k < r.length; k++) {
          const v = String(r[k] ?? "").trim();
          if (v) { sectorName = v; break; }
        }
      }
    }
  }
  return { projectName, sectorName };
}

export function findDailyLogHeaderRow(rows: unknown[][]): number {
  return rows.findIndex((row) =>
    row.some((c) => {
      const n = normHeader(c);
      return n === "كود المعده" || n === "الكود" || n === "رقم امر الشغل";
    })
  );
}

const PROJECT_NAME_ALIASES = ["المشروع", "المشروع:", "اسم المشروع", "اسم المشروع:"];
const PROJECT_CODE_ALIASES = ["كود المشروع", "كود المشروع:", "رمز المشروع"];
const SECTOR_ALIASES = ["القطاع", "القطاع:", "اسم القطاع", "اسم القطاع:"];

function findExact(norms: string[], aliases: string[]) {
  for (const a of aliases.map(normHeader)) {
    const i = norms.indexOf(a);
    if (i !== -1) return i;
  }
  return null;
}
function findLoose(norms: string[], aliases: string[], allow: (n: string) => boolean) {
  for (const a of aliases.map(normHeader)) {
    if (!a) continue;
    const i = norms.findIndex((n) => allow(n) && n.includes(a));
    if (i !== -1) return i;
  }
  return null;
}

export interface DailyLogPreview {
  headers: unknown[];
  dataStart: number;
  projectNameIndex: number | null;
  projectCodeIndex: number | null;
  sectorIndex: number | null;
  projectNameHeader: string | null;
  projectCodeHeader: string | null;
  sectorHeader: string | null;
  hasProject: boolean;
  hasSector: boolean;
  warnings: string[];
  projectSamples: string[];
  sectorSamples: string[];
}

export function readDailyLogPreview(rows: unknown[][]): DailyLogPreview | null {
  const hIdx = findDailyLogHeaderRow(rows);
  if (hIdx === -1) return null;
  let headers = rows[hIdx];
  let dataStart = hIdx + 1;
  if (!headers.some((c) => normHeader(c) === "التاريخ" || normHeader(c) === "تاريخ")) {
    headers = headers.map((h, i) => (String(h ?? "").trim() ? h : rows[hIdx + 1]?.[i] ?? ""));
    dataStart = hIdx + 2;
  }
  const norms = headers.map(normHeader);
  const headerAt = (i: number | null) => (i == null ? null : String(headers[i] ?? "").trim() || null);
  const codeIndex = findExact(norms, PROJECT_CODE_ALIASES) ?? findLoose(norms, PROJECT_CODE_ALIASES, () => true);
  const nameIndexRaw = findExact(norms, PROJECT_NAME_ALIASES) ?? findLoose(norms, PROJECT_NAME_ALIASES, (n) => !n.includes("كود"));
  const nameIndex = nameIndexRaw != null && nameIndexRaw !== codeIndex ? nameIndexRaw : null;
  const sectorIndex = findExact(norms, SECTOR_ALIASES) ?? findLoose(norms, SECTOR_ALIASES, () => true);

  const warnings: string[] = [];
  if (nameIndex == null && codeIndex == null) warnings.push("لم يتم العثور على عمود «المشروع» أو «كود المشروع» — مشروع السجلات سيُحفظ فارغًا (غير محدد).");
  if (sectorIndex == null) warnings.push("لم يتم العثور على عمود «القطاع» — قطاع السجلات سيُحفظ فارغًا (غير محدد).");

  const projectSamples: string[] = [];
  const sectorSamples: string[] = [];
  for (let i = dataStart; i < rows.length && (projectSamples.length < 3 || sectorSamples.length < 3); i++) {
    const r = rows[i];
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;
    if (nameIndex != null || codeIndex != null) {
      const idx = nameIndex ?? codeIndex;
      if (idx != null) {
        const v = String(r[idx] ?? "").trim();
        if (v && projectSamples.length < 3 && !projectSamples.includes(v)) projectSamples.push(v);
      }
    }
    if (sectorIndex != null) {
      const v = String(r[sectorIndex] ?? "").trim();
      if (v && sectorSamples.length < 3 && !sectorSamples.includes(v)) sectorSamples.push(v);
    }
  }

  return {
    headers,
    dataStart,
    projectNameIndex: nameIndex,
    projectCodeIndex: codeIndex,
    sectorIndex,
    projectNameHeader: headerAt(nameIndex),
    projectCodeHeader: headerAt(codeIndex),
    sectorHeader: headerAt(sectorIndex),
    hasProject: nameIndex != null || codeIndex != null,
    hasSector: sectorIndex != null,
    warnings,
    projectSamples,
    sectorSamples,
  };
}