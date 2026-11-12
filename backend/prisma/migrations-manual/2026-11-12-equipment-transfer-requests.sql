-- Equipment transfer requests (PENDING workflow)
-- MANUAL MIGRATION - do NOT apply automatically. Review, back up, then apply.
-- Source of truth for assignments remains System Managers; EFMS only records
-- requests and their status. Equipment assignment is NOT changed by this table.

BEGIN;

DO $$ BEGIN
  CREATE TYPE ops."TransferRequestStatus" AS ENUM ('PENDING','COMPLETED','REJECTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops."EquipmentTransferRequest" (
  "id" SERIAL PRIMARY KEY,
  "equipmentId" INTEGER NOT NULL,
  "sourceProjectId" INTEGER,
  "sourceSectorId" INTEGER,
  "destinationProjectId" INTEGER NOT NULL,
  "destinationSectorId" INTEGER,
  "transferDate" DATE NOT NULL,
  "reason" TEXT,
  "notes" TEXT,
  "status" ops."TransferRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedBy" INTEGER NOT NULL,
  "reviewedBy" INTEGER,
  "reviewedAt" TIMESTAMP(3),
  "sourceSystem" TEXT NOT NULL DEFAULT 'EFMS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "EquipmentTransferRequest_equipmentId_createdAt_idx"
  ON ops."EquipmentTransferRequest" ("equipmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "EquipmentTransferRequest_status_idx"
  ON ops."EquipmentTransferRequest" ("status");

ALTER TABLE ops."EquipmentTransferRequest"
  ADD CONSTRAINT "EquipmentTransferRequest_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES core."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ops."EquipmentTransferRequest"
  ADD CONSTRAINT "EquipmentTransferRequest_sourceProjectId_fkey"
  FOREIGN KEY ("sourceProjectId") REFERENCES core."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE ops."EquipmentTransferRequest"
  ADD CONSTRAINT "EquipmentTransferRequest_sourceSectorId_fkey"
  FOREIGN KEY ("sourceSectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE ops."EquipmentTransferRequest"
  ADD CONSTRAINT "EquipmentTransferRequest_destinationProjectId_fkey"
  FOREIGN KEY ("destinationProjectId") REFERENCES core."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE ops."EquipmentTransferRequest"
  ADD CONSTRAINT "EquipmentTransferRequest_destinationSectorId_fkey"
  FOREIGN KEY ("destinationSectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE ops."EquipmentTransferRequest"
  ADD CONSTRAINT "EquipmentTransferRequest_requestedBy_fkey"
  FOREIGN KEY ("requestedBy") REFERENCES core."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE ops."EquipmentTransferRequest"
  ADD CONSTRAINT "EquipmentTransferRequest_reviewedBy_fkey"
  FOREIGN KEY ("reviewedBy") REFERENCES core."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
