/**
 * Dry-run-first backfill of historical project/sector snapshots.
 *
 * SAFETY: this script is never imported by the application and is never run
 * automatically. Default mode is a read-only dry run. It only fills a snapshot
 * when a *trusted* EquipmentAssignment interval covers the record date; it never
 * falls back to the equipment's current assignment and never guesses dates.
 *
 * Usage (manual, after review):
 *   npx tsx scripts/backfill-assignment-history.ts                 # dry run
 *   npx tsx scripts/backfill-assignment-history.ts --apply --confirm
 *
 * Because System Managers exposes only the current assignment, a fresh install
 * has no historical intervals, so this reports 0 recoverable rows by design.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.argv.includes("--confirm");

interface Totals {
  entity: string;
  total: number;
  missingSnapshot: number;
  recoverable: number;
}

function span(rows: { effectiveFrom: Date; effectiveTo: Date | null }[], at: Date): boolean {
  return rows.some((r) => at >= r.effectiveFrom && (r.effectiveTo == null || at < r.effectiveTo));
}

async function main() {
  const assignments = await prisma.equipmentAssignment.findMany({
    select: { equipmentId: true, projectId: true, sectorId: true, effectiveFrom: true, effectiveTo: true },
  });

  const byEquipment = new Map<number, typeof assignments>();
  for (const a of assignments) {
    const list = byEquipment.get(a.equipmentId) ?? [];
    list.push(a);
    byEquipment.set(a.equipmentId, list);
  }

  const results: Totals[] = [];

  const dailyLogs = await prisma.dailyLog.findMany({
    where: { OR: [{ projectName: null }, { projectName: "" }] },
    select: { id: true, equipmentId: true, date: true },
  });
  results.push({
    entity: "DailyLog",
    total: await prisma.dailyLog.count(),
    missingSnapshot: dailyLogs.length,
    recoverable: dailyLogs.filter((r) => span(byEquipment.get(r.equipmentId) ?? [], r.date)).length,
  });

  const maintenance = await prisma.maintenance.findMany({
    where: { OR: [{ projectName: null }, { projectName: "" }] },
    select: { id: true, equipmentId: true, date: true },
  });
  results.push({
    entity: "Maintenance",
    total: await prisma.maintenance.count(),
    missingSnapshot: maintenance.length,
    recoverable: maintenance.filter((r) => span(byEquipment.get(r.equipmentId) ?? [], r.date)).length,
  });

  const faults = await prisma.fault.findMany({
    select: { id: true, equipmentId: true, date: true },
  });
  results.push({
    entity: "Fault",
    total: faults.length,
    missingSnapshot: faults.length,
    recoverable: faults.filter((r) => span(byEquipment.get(r.equipmentId) ?? [], r.date)).length,
  });

  console.log(JSON.stringify({ mode: APPLY ? "APPLY" : "DRY_RUN", assignmentIntervals: assignments.length, results }, null, 2));

  if (!APPLY) {
    console.log("Dry run only. No rows changed. Pass --apply --confirm to write BACKFILL snapshots.");
    return;
  }
  if (!CONFIRMED) {
    throw new Error("Refusing to write without --confirm");
  }
  if (assignments.length === 0) {
    throw new Error("No trusted assignment intervals exist; nothing can be backfilled without inventing history.");
  }

  // Intentionally not implemented: writing snapshots requires a reviewed mapping
  // per entity and an explicit source reference. Add it only when a trusted
  // history source actually exists.
  throw new Error("Apply mode is intentionally disabled until a trusted history source exists.");
}

main().finally(() => prisma.$disconnect());
