import type { Prisma } from "@prisma/client";
import prisma from "../config/prisma";

/**
 * Equipment assignment history.
 *
 * System Managers owns projects/sectors/equipment, but its `/equipments`
 * endpoint exposes only the CURRENT project and sector. It carries no transfer
 * dates and no assignment identifiers, so:
 *
 *  - we never invent `effectiveFrom`/`effectiveTo`;
 *  - we never infer a transfer date from operational records;
 *  - we record an interval only when EFMS actually observes a change, starting
 *    at the observation time.
 *
 * Historical records created before this table existed therefore stay UNKNOWN.
 */

export const ASSIGNMENT_SOURCES = {
  /** Project/sector changed while syncing from System Managers. */
  MANAGERS_SYNC: "MANAGERS_SYNC",
  /** Project/sector changed by an explicit edit inside EFMS. */
  EFMS_MANUAL: "EFMS_MANUAL",
  /** Project/sector changed during a spreadsheet import. */
  IMPORT: "IMPORT",
  /** Row backfilled from a trusted external history source (never auto-run). */
  BACKFILL: "BACKFILL",
} as const;

export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[keyof typeof ASSIGNMENT_SOURCES];

export interface AssignmentLike {
  projectId: number | null;
  sectorId: number | null;
  projectSectorId: number | null;
  effectiveFrom: Date | string;
  effectiveTo: Date | string | null;
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function sameAssignment(
  a: Pick<AssignmentLike, "projectId" | "sectorId" | "projectSectorId">,
  b: Pick<AssignmentLike, "projectId" | "sectorId" | "projectSectorId">
): boolean {
  return a.projectId === b.projectId && a.sectorId === b.sectorId && a.projectSectorId === b.projectSectorId;
}

/**
 * Resolve the assignment covering `at`, using half-open intervals
 * [effectiveFrom, effectiveTo). Returns null when nothing is known, which
 * callers MUST treat as UNKNOWN rather than falling back to the current
 * equipment assignment.
 */
export function resolveAssignmentAt<T extends AssignmentLike>(assignments: T[], at: Date | string): T | null {
  const t = toTime(at);
  for (const a of assignments) {
    const from = toTime(a.effectiveFrom);
    const to = a.effectiveTo == null ? Number.POSITIVE_INFINITY : toTime(a.effectiveTo);
    if (t >= from && t < to) return a;
  }
  return null;
}

/** Sort by interval start so callers get a stable, chronological view. */
export function sortAssignments<T extends AssignmentLike>(assignments: T[]): T[] {
  return [...assignments].sort((a, b) => toTime(a.effectiveFrom) - toTime(b.effectiveFrom));
}

/** Detect overlapping or duplicated intervals for a single equipment. */
export function findOverlaps<T extends AssignmentLike>(assignments: T[]): Array<[T, T]> {
  const sorted = sortAssignments(assignments);
  const overlaps: Array<[T, T]> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const prevTo = prev.effectiveTo == null ? Number.POSITIVE_INFINITY : toTime(prev.effectiveTo);
    if (toTime(next.effectiveFrom) < prevTo) overlaps.push([prev, next]);
  }
  return overlaps;
}

/** True when the two rows describe the same project/sector/projectSector. */
export function isSameAssignment(a: AssignmentLike, b: AssignmentLike): boolean {
  return sameAssignment(a, b);
}

export interface RecordAssignmentInput {
  equipmentId: number;
  projectId: number | null;
  sectorId: number | null;
  projectSectorId: number | null;
  sourceSystem: AssignmentSource;
  sourceReference?: string | null;
  at?: Date;
}

/**
 * Append an observed assignment.
 *
 * Idempotent: if the currently open interval already describes the same
 * project/sector/projectSector, nothing is written. Otherwise the open interval
 * is closed at `at` and a new one starts there, so intervals never overlap and
 * previous history is never deleted.
 */
export async function recordAssignment(
  input: RecordAssignmentInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ created: boolean; closedId: number | null }> {
  const at = input.at ?? new Date();
  const open = await tx.equipmentAssignment.findFirst({
    where: { equipmentId: input.equipmentId, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
  });

  const next = {
    projectId: input.projectId,
    sectorId: input.sectorId,
    projectSectorId: input.projectSectorId,
  };

  if (open && sameAssignment(open, next)) {
    return { created: false, closedId: null };
  }

  let closedId: number | null = null;
  if (open) {
    const updated = await tx.equipmentAssignment.update({
      where: { id: open.id },
      data: { effectiveTo: at },
    });
    closedId = updated.id;
  }

  await tx.equipmentAssignment.create({
    data: {
      equipmentId: input.equipmentId,
      ...next,
      effectiveFrom: at,
      effectiveTo: null,
      sourceSystem: input.sourceSystem,
      sourceReference: input.sourceReference ?? null,
    },
  });

  return { created: true, closedId };
}

/**
 * Best-effort wrapper for call sites that must not fail when the migration has
 * not been applied yet (production is migrated manually, never by this code).
 */
export async function recordAssignmentSafe(input: RecordAssignmentInput): Promise<void> {
  try {
    await recordAssignment(input);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2021" || code === "P2010") {
      console.warn("[assignment-history] table is not migrated yet; change was not recorded");
      return;
    }
    console.warn("[assignment-history] failed to record assignment:", err instanceof Error ? err.message : String(err));
  }
}

/** Resolve the active ProjectSector link for a project/sector pair, if any. */
export async function activeProjectSectorId(
  projectId: number | null,
  sectorId: number | null
): Promise<number | null> {
  if (projectId == null || sectorId == null) return null;
  const link = await prisma.projectSector.findFirst({
    where: { projectId, sectorId, active: true },
    select: { id: true },
  });
  return link?.id ?? null;
}

export async function listAssignments(equipmentId: number) {
  const rows = await prisma.equipmentAssignment.findMany({
    where: { equipmentId },
    orderBy: { effectiveFrom: "asc" },
    select: {
      id: true,
      projectId: true,
      sectorId: true,
      projectSectorId: true,
      effectiveFrom: true,
      effectiveTo: true,
      sourceSystem: true,
      sourceReference: true,
      project: { select: { id: true, code: true, name: true } },
      sector: { select: { id: true, name: true } },
    },
  });
  return rows;
}
