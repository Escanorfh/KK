-- Equipment assignment history
--
-- MANUAL MIGRATION - do NOT apply automatically and do NOT run on production
-- from the application. Review, back up, then apply deliberately.
--
-- Why: System Managers exposes only the CURRENT project/sector for equipment,
-- so EFMS records an interval only when it observes a change. Intervals are
-- half-open [effectiveFrom, effectiveTo); effectiveTo = NULL means "current".
-- Rows are never backdated and existing operational snapshots are not touched.
--
-- Note: Equipment/Project/Sector/ProjectSector live in schema "core";
-- this new table lives in "ops", matching the Prisma @@schema declaration.

BEGIN;

CREATE TABLE IF NOT EXISTS ops."EquipmentAssignment" (
  "id"              SERIAL PRIMARY KEY,
  "equipmentId"     INTEGER NOT NULL,
  "projectId"       INTEGER,
  "sectorId"        INTEGER,
  "projectSectorId" INTEGER,
  "effectiveFrom"   TIMESTAMP(3) NOT NULL,
  "effectiveTo"     TIMESTAMP(3),
  "sourceSystem"    TEXT NOT NULL,
  "sourceReference" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "EquipmentAssignment_equipmentId_effectiveFrom_idx"
  ON ops."EquipmentAssignment" ("equipmentId", "effectiveFrom");

CREATE INDEX IF NOT EXISTS "EquipmentAssignment_equipmentId_effectiveTo_idx"
  ON ops."EquipmentAssignment" ("equipmentId", "effectiveTo");

-- At most one open (current) interval per equipment.
CREATE UNIQUE INDEX IF NOT EXISTS "EquipmentAssignment_one_open_per_equipment_idx"
  ON ops."EquipmentAssignment" ("equipmentId")
  WHERE "effectiveTo" IS NULL;

ALTER TABLE ops."EquipmentAssignment"
  ADD CONSTRAINT "EquipmentAssignment_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES core."Equipment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE ops."EquipmentAssignment"
  ADD CONSTRAINT "EquipmentAssignment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES core."Project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE ops."EquipmentAssignment"
  ADD CONSTRAINT "EquipmentAssignment_sectorId_fkey"
  FOREIGN KEY ("sectorId") REFERENCES core."Sector"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE ops."EquipmentAssignment"
  ADD CONSTRAINT "EquipmentAssignment_projectSectorId_fkey"
  FOREIGN KEY ("projectSectorId") REFERENCES core."ProjectSector"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
