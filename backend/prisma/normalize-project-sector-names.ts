// EFMS — Backfill ProjectSector.normalizedName using the canonical normalizeArabic()
//
// SAFETY GUARDS (fail-closed):
// - Requires EFMS_ALLOW_BACKFILL=1
// - Requires EFMS_DISPOSABLE_DB=1 (explicit disposable database designation)
// - Refuses desktop/SQLite mode
// - Refuses production-like DATABASE_URL patterns
// - Does not print credentials
// - Detects conflicts before writing; exits non-zero if conflicts found
// - Idempotent: safe to rerun
//
// Usage:
//   EFMS_MODE=web EFMS_ALLOW_BACKFILL=1 EFMS_DISPOSABLE_DB=1 npx tsx prisma/normalize-project-sector-names.ts

import "dotenv/config";

// Override DATABASE_URL with the dedicated backfill URL before creating the Prisma client
if (process.env.EFMS_BACKFILL_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.EFMS_BACKFILL_DATABASE_URL;
}

import prisma from "../src/config/prisma";
import {
  computeBackfill,
  checkEnvSafety,
  type ProjectSectorRow,
} from "../src/utils/projectSectorBackfill";

async function main() {
  // Environment safety check (fail-closed)
  const safety = checkEnvSafety({
    allowBackfill: process.env.EFMS_ALLOW_BACKFILL,
    backfillDatabaseUrl: process.env.EFMS_BACKFILL_DATABASE_URL,
    efmsMode: process.env.EFMS_MODE,
    disposableDb: process.env.EFMS_DISPOSABLE_DB,
  });

  if (!safety.safe) {
    console.error(`BLOCKED: ${safety.reason}`);
    process.exit(1);
  }

  console.log("Starting ProjectSector.normalizedName backfill...");

  // Read all ProjectSector rows with their associated Sector names
  const associations = await prisma.projectSector.findMany({
    include: {
      sector: { select: { id: true, name: true } },
    },
  });

  console.log(`Found ${associations.length} ProjectSector rows.`);

  // Map to pure function input
  const rows: ProjectSectorRow[] = associations.map((a) => ({
    id: a.id,
    projectId: a.projectId,
    sectorId: a.sectorId,
    normalizedName: a.normalizedName,
    active: a.active,
    sectorName: a.sector.name,
  }));

  // Compute updates and detect conflicts
  const result = computeBackfill(rows);

  if (result.emptyNames.length > 0) {
    console.error("EMPTY NORMALIZED NAMES DETECTED — aborting:");
    console.error(`  ProjectSector IDs with empty/whitespace-only names: ${result.emptyNames.join(", ")}`);
    console.error("  These must be resolved manually before proceeding.");
    await prisma.$disconnect();
    process.exit(1);
  }

  if (result.conflicts.length > 0) {
    console.error("CONFLICTS DETECTED — aborting backfill:");
    for (const c of result.conflicts) {
      console.error(
        `  projectId=${c.projectId}, normalizedName="${c.normalizedName}", ProjectSector IDs: ${c.ids.join(", ")}`
      );
    }
    console.error("Resolve conflicts manually before rerunning.");
    await prisma.$disconnect();
    process.exit(1);
  }

  if (result.updates.length === 0) {
    console.log("No updates needed. All normalizedName values are already correct.");
    await prisma.$disconnect();
    return;
  }

  // Apply updates transactionally
  await prisma.$transaction(
    result.updates.map((u) =>
      prisma.projectSector.update({
        where: { id: u.id },
        data: { normalizedName: u.normalizedName },
      })
    )
  );

  console.log(`Updated ${result.updates.length} ProjectSector rows.`);

  // Verify
  const remaining = await prisma.projectSector.findMany({
    where: { normalizedName: "" },
  });
  if (remaining.length > 0) {
    console.error(`WARNING: ${remaining.length} rows still have empty normalizedName.`);
    process.exit(1);
  }

  console.log("Backfill complete. All normalizedName values are populated and normalized.");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
