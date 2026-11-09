-- EFMS — Sector-to-Projects Many-to-Many migration (PostgreSQL)
-- Phase B.1: PostgreSQL schema foundation
-- Generated manually following the project's migration convention.
-- This file has NOT been executed. Apply only to a verified disposable database.
-- Rollback: see the rollback section at the end of this file.

-- ============================================================
-- Step 1: Create ProjectSector junction table
-- NOTE: FKs use RESTRICT (not CASCADE) to preserve permanent
-- association history. Deleting a Project or Sector is blocked
-- if any ProjectSector row references it.
-- ============================================================
CREATE TABLE IF NOT EXISTS core."ProjectSector" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "sectorId" INTEGER NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectSector_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectSector_projectId_fkey" FOREIGN KEY ("projectId")
        REFERENCES core."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectSector_sectorId_fkey" FOREIGN KEY ("sectorId")
        REFERENCES core."Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectSector_projectId_sectorId_key"
    ON core."ProjectSector" ("projectId", "sectorId");

CREATE INDEX IF NOT EXISTS "ProjectSector_sectorId_idx"
    ON core."ProjectSector" ("sectorId");

-- CHECK: normalizedName must not be empty or whitespace-only
-- Uses regexp_replace to trim all Unicode whitespace (spaces, tabs, newlines, etc.)
ALTER TABLE core."ProjectSector" ADD CONSTRAINT "ProjectSector_normalizedName_check"
    CHECK (LENGTH(TRIM(BOTH E' \t\n\r\f\v' FROM "normalizedName")) > 0);

-- ============================================================
-- Step 2: Backfill ProjectSector from existing Sector.projectId
-- normalizedName is set to the raw sector name (placeholder).
-- Application-level normalization (normalizeArabic) must be run
-- before enforcing the unique constraint on normalizedName.
-- See: backend/scripts/normalize-project-sector-names.ts (to be created in B.2)
-- ============================================================
INSERT INTO core."ProjectSector" ("projectId", "sectorId", "normalizedName", "active", "createdAt", "updatedAt")
SELECT s."projectId", s."id", s."name", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM core."Sector" s
WHERE s."projectId" IS NOT NULL
ON CONFLICT ("projectId", "sectorId") DO NOTHING;

-- ============================================================
-- Step 3: Conflict detection for duplicate normalized names
-- Run this query AFTER application-level normalization.
-- If it returns any rows, resolve them manually before proceeding.
-- ============================================================
-- SELECT "projectId", "normalizedName", COUNT(*) AS cnt
-- FROM core."ProjectSector"
-- GROUP BY "projectId", "normalizedName"
-- HAVING COUNT(*) > 1;

-- ============================================================
-- Step 4: Create unique constraint on (projectId, normalizedName)
-- ONLY after all normalizedName values have been normalized
-- via the application-level normalizeArabic() function.
-- Uncomment and run after normalization is complete:
-- ============================================================
-- CREATE UNIQUE INDEX IF NOT EXISTS "ProjectSector_projectId_normalizedName_key"
--     ON core."ProjectSector" ("projectId", "normalizedName");

-- ============================================================
-- Step 5: Make Sector.projectId nullable (legacy origin field)
-- ============================================================
ALTER TABLE core."Sector" ALTER COLUMN "projectId" DROP NOT NULL;

-- ============================================================
-- Step 6: Add normalizedName to Sector (nullable, for legacy compatibility)
-- ============================================================
ALTER TABLE core."Sector" ADD COLUMN IF NOT EXISTS "normalizedName" TEXT;

-- ============================================================
-- Step 7: Add snapshot columns to DailyLog
-- ============================================================
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "projectId" INTEGER;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "sectorId" INTEGER;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "contextSource" TEXT;

ALTER TABLE ops."DailyLog" ADD CONSTRAINT "DailyLog_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES core."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE ops."DailyLog" ADD CONSTRAINT "DailyLog_sectorId_fkey"
    FOREIGN KEY ("sectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Step 8: Add snapshot columns to Maintenance
-- ============================================================
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "projectId" INTEGER;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "sectorId" INTEGER;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "contextSource" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "operationId" TEXT;

ALTER TABLE ops."Maintenance" ADD CONSTRAINT "Maintenance_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES core."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE ops."Maintenance" ADD CONSTRAINT "Maintenance_sectorId_fkey"
    FOREIGN KEY ("sectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "Maintenance_operationId_key"
    ON ops."Maintenance" ("operationId")
    WHERE "operationId" IS NOT NULL;

-- ============================================================
-- Step 9: Add projectSectorId to RepairOrder
-- ============================================================
ALTER TABLE ops."RepairOrder" ADD COLUMN IF NOT EXISTS "projectSectorId" INTEGER;

ALTER TABLE ops."RepairOrder" ADD CONSTRAINT "RepairOrder_projectSectorId_fkey"
    FOREIGN KEY ("projectSectorId") REFERENCES core."ProjectSector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Step 10: Add projectSectorId to NeedRequest
-- ============================================================
ALTER TABLE ops."NeedRequest" ADD COLUMN IF NOT EXISTS "projectSectorId" INTEGER;

ALTER TABLE ops."NeedRequest" ADD CONSTRAINT "NeedRequest_projectSectorId_fkey"
    FOREIGN KEY ("projectSectorId") REFERENCES core."ProjectSector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Step 11: Add projectSectorId to Fault
-- ============================================================
ALTER TABLE ops."Fault" ADD COLUMN IF NOT EXISTS "projectSectorId" INTEGER;

ALTER TABLE ops."Fault" ADD CONSTRAINT "Fault_projectSectorId_fkey"
    FOREIGN KEY ("projectSectorId") REFERENCES core."ProjectSector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Step 12: Change Sector.projectId FK from CASCADE to SET NULL
-- ============================================================
ALTER TABLE core."Sector" DROP CONSTRAINT IF EXISTS "Sector_projectId_fkey";
ALTER TABLE core."Sector" ADD CONSTRAINT "Sector_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES core."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Step 13: CHECK constraint for contextSource (PostgreSQL)
-- ============================================================
ALTER TABLE ops."DailyLog" ADD CONSTRAINT "DailyLog_contextSource_check"
    CHECK ("contextSource" IS NULL OR "contextSource" IN ('SNAPSHOT', 'LEGACY_DERIVED', 'UNKNOWN'));

ALTER TABLE ops."Maintenance" ADD CONSTRAINT "Maintenance_contextSource_check"
    CHECK ("contextSource" IS NULL OR "contextSource" IN ('SNAPSHOT', 'LEGACY_DERIVED', 'UNKNOWN'));

-- ============================================================
-- ROLLBACK (reverse order)
-- ============================================================
-- Note: Rollback limitations depend on the state:
--   State A (before new M:N associations): Rollback is lossless.
--   State B (after new ProjectSector associations): Rollback is lossy.
--   State C (after operational records reference ProjectSector): Forward-only repair is safer.
--
-- Step 13 rollback:
-- ALTER TABLE ops."DailyLog" DROP CONSTRAINT IF EXISTS "DailyLog_contextSource_check";
-- ALTER TABLE ops."Maintenance" DROP CONSTRAINT IF EXISTS "Maintenance_contextSource_check";

-- Step 12 rollback:
-- ALTER TABLE core."Sector" DROP CONSTRAINT IF EXISTS "Sector_projectId_fkey";
-- ALTER TABLE core."Sector" ADD CONSTRAINT "Sector_projectId_fkey"
--     FOREIGN KEY ("projectId") REFERENCES core."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 11 rollback:
-- ALTER TABLE ops."Fault" DROP CONSTRAINT IF EXISTS "Fault_projectSectorId_fkey";
-- ALTER TABLE ops."Fault" DROP COLUMN IF EXISTS "projectSectorId";

-- Step 10 rollback:
-- ALTER TABLE ops."NeedRequest" DROP CONSTRAINT IF EXISTS "NeedRequest_projectSectorId_fkey";
-- ALTER TABLE ops."NeedRequest" DROP COLUMN IF EXISTS "projectSectorId";

-- Step 9 rollback:
-- ALTER TABLE ops."RepairOrder" DROP CONSTRAINT IF EXISTS "RepairOrder_projectSectorId_fkey";
-- ALTER TABLE ops."RepairOrder" DROP COLUMN IF EXISTS "projectSectorId";

-- Step 8 rollback:
-- ALTER TABLE ops."Maintenance" DROP CONSTRAINT IF EXISTS "Maintenance_sectorId_fkey";
-- ALTER TABLE ops."Maintenance" DROP CONSTRAINT IF EXISTS "Maintenance_projectId_fkey";
-- DROP INDEX IF EXISTS ops."Maintenance_operationId_key";
-- ALTER TABLE ops."Maintenance" DROP COLUMN IF EXISTS "operationId";
-- ALTER TABLE ops."Maintenance" DROP COLUMN IF EXISTS "contextSource";
-- ALTER TABLE ops."Maintenance" DROP COLUMN IF EXISTS "sectorId";
-- ALTER TABLE ops."Maintenance" DROP COLUMN IF EXISTS "projectId";

-- Step 7 rollback:
-- ALTER TABLE ops."DailyLog" DROP CONSTRAINT IF EXISTS "DailyLog_sectorId_fkey";
-- ALTER TABLE ops."DailyLog" DROP CONSTRAINT IF EXISTS "DailyLog_projectId_fkey";
-- ALTER TABLE ops."DailyLog" DROP COLUMN IF EXISTS "contextSource";
-- ALTER TABLE ops."DailyLog" DROP COLUMN IF EXISTS "sectorId";
-- ALTER TABLE ops."DailyLog" DROP COLUMN IF EXISTS "projectId";

-- Step 5 rollback:
-- ALTER TABLE core."Sector" DROP COLUMN IF EXISTS "normalizedName";

-- Step 4 rollback:
-- ALTER TABLE core."Sector" ALTER COLUMN "projectId" SET NOT NULL;

-- Step 2 rollback:
-- DELETE FROM core."ProjectSector";

-- Step 1 rollback:
-- ALTER TABLE core."ProjectSector" DROP CONSTRAINT IF EXISTS "ProjectSector_normalizedName_check";
-- DROP TABLE IF EXISTS core."ProjectSector";
