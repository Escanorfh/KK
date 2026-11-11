-- =========================================================================
-- EFMS — Consolidated Wasmer PostgreSQL Schema Update (INCREMENTAL)
-- Target: EXISTING Wasmer production database (core/ops/log schemas, 21 tables)
-- Source: backend/prisma/schema.prisma (current)
-- Generated: 2026-11-14
-- Status: NOT APPLIED. Review and run manually via psql.
-- Safe to re-run (idempotent where PostgreSQL supports IF NOT EXISTS).
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. ENUM: ReviewStatus (ops schema)
-- -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE ops."ReviewStatus" AS ENUM ('PENDING_REVIEW','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 2. Sector: Master Data identifier columns (legacy-compatible)
-- -------------------------------------------------------------------------
ALTER TABLE core."Sector" ADD COLUMN IF NOT EXISTS "managersRoomId" INTEGER;
ALTER TABLE core."Sector" ADD COLUMN IF NOT EXISTS "managersRoomTitle" TEXT;
ALTER TABLE core."Sector" ALTER COLUMN "projectId" DROP NOT NULL;

-- -------------------------------------------------------------------------
-- 3. ProjectSector junction table (M:N) + indexes + constraints
-- -------------------------------------------------------------------------
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

-- normalizedName check (idempotent guard)
DO $$ BEGIN
  ALTER TABLE core."ProjectSector" ADD CONSTRAINT "ProjectSector_normalizedName_check"
    CHECK (LENGTH(TRIM(BOTH E' \t\n\r\f\v' FROM "normalizedName")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NOTE: unique index on (projectId, normalizedName) must be created ONLY after
-- application-level normalization via normalize-project-sector-names.ts.
-- Uncomment after normalization is verified:
-- CREATE UNIQUE INDEX IF NOT EXISTS "ProjectSector_projectId_normalizedName_key"
--     ON core."ProjectSector" ("projectId", "normalizedName");

-- -------------------------------------------------------------------------
-- 4. NeedRequest: sector link
-- -------------------------------------------------------------------------
ALTER TABLE ops."NeedRequest" ADD COLUMN IF NOT EXISTS "sectorId" INTEGER;
ALTER TABLE ops."NeedRequest" ADD COLUMN IF NOT EXISTS "projectSectorId" INTEGER;
DO $$ BEGIN
  ALTER TABLE ops."NeedRequest" ADD CONSTRAINT "NeedRequest_sectorId_fkey"
    FOREIGN KEY ("sectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ops."NeedRequest" ADD CONSTRAINT "NeedRequest_projectSectorId_fkey"
    FOREIGN KEY ("projectSectorId") REFERENCES core."ProjectSector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 5. Operational snapshot columns: DailyLog
-- -------------------------------------------------------------------------
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "projectId" INTEGER;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "sectorId" INTEGER;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "contextSource" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "projectCode" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "projectName" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "sectorName" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "equipmentCode" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "equipmentName" TEXT;
DO $$ BEGIN
  ALTER TABLE ops."DailyLog" ADD CONSTRAINT "DailyLog_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES core."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ops."DailyLog" ADD CONSTRAINT "DailyLog_sectorId_fkey"
    FOREIGN KEY ("sectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ops."DailyLog" ADD CONSTRAINT "DailyLog_contextSource_check"
    CHECK ("contextSource" IS NULL OR "contextSource" IN ('SNAPSHOT','LEGACY_DERIVED','UNKNOWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 6. Operational snapshot columns: Maintenance
-- -------------------------------------------------------------------------
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "projectId" INTEGER;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "sectorId" INTEGER;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "contextSource" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "projectCode" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "projectName" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "sectorName" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "equipmentCode" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "equipmentName" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "operationId" TEXT;
DO $$ BEGIN
  ALTER TABLE ops."Maintenance" ADD CONSTRAINT "Maintenance_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES core."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ops."Maintenance" ADD CONSTRAINT "Maintenance_sectorId_fkey"
    FOREIGN KEY ("sectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ops."Maintenance" ADD CONSTRAINT "Maintenance_contextSource_check"
    CHECK ("contextSource" IS NULL OR "contextSource" IN ('SNAPSHOT','LEGACY_DERIVED','UNKNOWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Maintenance_operationId_key"
    ON ops."Maintenance" ("operationId") WHERE "operationId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Maintenance_clientRequestId_key"
    ON ops."Maintenance" ("clientRequestId") WHERE "clientRequestId" IS NOT NULL;

-- -------------------------------------------------------------------------
-- 7. Operational snapshot columns: RepairOrder
-- -------------------------------------------------------------------------
ALTER TABLE ops."RepairOrder" ADD COLUMN IF NOT EXISTS "projectSectorId" INTEGER;
DO $$ BEGIN
  ALTER TABLE ops."RepairOrder" ADD CONSTRAINT "RepairOrder_projectSectorId_fkey"
    FOREIGN KEY ("projectSectorId") REFERENCES core."ProjectSector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 8. Operational snapshot columns: Fault
-- -------------------------------------------------------------------------
ALTER TABLE ops."Fault" ADD COLUMN IF NOT EXISTS "projectSectorId" INTEGER;
DO $$ BEGIN
  ALTER TABLE ops."Fault" ADD CONSTRAINT "Fault_projectSectorId_fkey"
    FOREIGN KEY ("projectSectorId") REFERENCES core."ProjectSector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 9. ReviewRequest table (approval workflow)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops."ReviewRequest" (
    "id" SERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "status" ops."ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "clientRequestId" TEXT,
    "submittedById" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "submittedData" JSONB NOT NULL,
    "reviewedData" JSONB,
    "equipmentId" INTEGER,
    "projectId" INTEGER,
    "sectorId" INTEGER,
    "projectName" TEXT,
    "projectCode" TEXT,
    "sectorName" TEXT,
    "equipmentCode" TEXT,
    "equipmentName" TEXT,
    "contextSource" TEXT,
    "capturedAt" TIMESTAMP(3),
    "recordId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReviewRequest_submittedById_fkey" FOREIGN KEY ("submittedById")
        REFERENCES core."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById")
        REFERENCES core."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewRequest_clientRequestId_key" UNIQUE ("clientRequestId")
);
CREATE INDEX IF NOT EXISTS "ReviewRequest_status_entity_idx"
    ON ops."ReviewRequest" ("status", "entity");
CREATE INDEX IF NOT EXISTS "ReviewRequest_submittedById_idx"
    ON ops."ReviewRequest" ("submittedById");

-- -------------------------------------------------------------------------
-- 10. Sector.projectId FK: CASCADE -> SET NULL (legacy compatibility)
-- -------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE core."Sector" DROP CONSTRAINT IF EXISTS "Sector_projectId_fkey";
  ALTER TABLE core."Sector" ADD CONSTRAINT "Sector_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES core."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN others THEN NULL; END $$;

COMMIT;

-- =========================================================================
-- POST-NORMALIZATION (run AFTER normalize-project-sector-names.ts):
-- CREATE UNIQUE INDEX IF NOT EXISTS "ProjectSector_projectId_normalizedName_key"
--     ON core."ProjectSector" ("projectId", "normalizedName");
-- =========================================================================
