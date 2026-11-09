// EFMS — ProjectSector normalizedName backfill: pure functions.
// These functions are independently testable. The script in
// prisma/normalize-project-sector-names.ts wraps them with safety guards.

import { normalizeArabic } from "./managers.js";

export interface ProjectSectorRow {
  id: number;
  projectId: number;
  sectorId: number;
  normalizedName: string | null;
  active: boolean;
  sectorName: string;
}

export interface BackfillUpdate {
  id: number;
  normalizedName: string;
}

export interface BackfillConflict {
  projectId: number;
  normalizedName: string;
  ids: number[];
}

export interface BackfillResult {
  updates: BackfillUpdate[];
  conflicts: BackfillConflict[];
  emptyNames: number[];
}

/**
 * Compute the list of updates and detect conflicts.
 * Pure function — no database access.
 */
export function computeBackfill(rows: ProjectSectorRow[]): BackfillResult {
  const updates: BackfillUpdate[] = [];
  const conflicts: BackfillConflict[] = [];
  const emptyNames: number[] = [];

  // Group by (projectId, normalized name) for conflict detection
  const groups = new Map<string, number[]>();

  for (const row of rows) {
    const normalized = normalizeArabic(row.sectorName);

    if (normalized === "") {
      emptyNames.push(row.id);
      continue;
    }

    const key = `${row.projectId}|${normalized}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row.id);
  }

  // Detect conflicts
  for (const [key, ids] of groups) {
    if (ids.length > 1) {
      const [projectId, normalizedName] = key.split("|");
      conflicts.push({ projectId: Number(projectId), normalizedName, ids });
    }
  }

  // If conflicts exist, return zero updates
  if (conflicts.length > 0) {
    return { updates: [], conflicts, emptyNames };
  }

  // If empty names exist, return zero updates
  if (emptyNames.length > 0) {
    return { updates: [], conflicts, emptyNames };
  }

  // No conflicts — compute updates
  for (const row of rows) {
    const normalized = normalizeArabic(row.sectorName);
    if (row.normalizedName !== normalized) {
      updates.push({ id: row.id, normalizedName: normalized });
    }
  }

  return { updates, conflicts, emptyNames };
}

/**
 * Check if an environment is safe for backfill.
 * Fail-closed: returns false unless all guards pass.
 */
export interface EnvSafetyResult {
  safe: boolean;
  reason: string;
}

export function checkEnvSafety(env: {
  allowBackfill?: string;
  backfillDatabaseUrl?: string;
  efmsMode?: string;
  disposableDb?: string;
}): EnvSafetyResult {
  // Guard 1: explicit opt-in
  if (env.allowBackfill !== "1") {
    return { safe: false, reason: "EFMS_ALLOW_BACKFILL must be set to 1" };
  }

  // Guard 2: dedicated backfill database URL must be present (not general DATABASE_URL)
  if (!env.backfillDatabaseUrl) {
    return { safe: false, reason: "EFMS_BACKFILL_DATABASE_URL must be set (dedicated disposable database)" };
  }

  // Guard 3: must be explicitly designated as disposable
  if (env.disposableDb !== "1") {
    return { safe: false, reason: "EFMS_DISPOSABLE_DB must be set to 1" };
  }

  // Guard 4: refuse desktop/SQLite mode
  if (env.efmsMode === "desktop") {
    return { safe: false, reason: "Desktop/SQLite mode is not supported for this script" };
  }

  // Guard 5: refuse production-like URLs (defense-in-depth, not proof of safety)
  const productionPatterns = [
    /neon\.tech/i,
    /vercel/i,
    /aws\.com/i,
    /azure\.com/i,
    /googleapis\.com/i,
    /supabase/i,
    /railway/i,
    /render\.com/i,
    /heroku/i,
    /production/i,
    /amazonaws/i,
  ];
  if (productionPatterns.some((p) => p.test(env.backfillDatabaseUrl!))) {
    return { safe: false, reason: "EFMS_BACKFILL_DATABASE_URL appears to be a production URL" };
  }

  return { safe: true, reason: "OK" };
}
