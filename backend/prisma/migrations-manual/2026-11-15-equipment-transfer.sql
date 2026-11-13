-- EFMS — Equipment Transfer (PostgreSQL) — NOT APPLIED
DO $$ BEGIN
  CREATE TYPE ops."TransferStatus" AS ENUM ('PENDING','APPROVED','REJECTED','COMPLETED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops."EquipmentTransfer" (
    "id" SERIAL NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "fromProjectId" INTEGER,
    "fromSectorId" INTEGER,
    "toProjectId" INTEGER,
    "toSectorId" INTEGER,
    "transferDate" DATE NOT NULL,
    "effectiveDate" DATE,
    "reason" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedById" INTEGER NOT NULL,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EquipmentTransfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EquipmentTransfer_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES core."Equipment"("id") ON DELETE CASCADE,
    CONSTRAINT "EquipmentTransfer_fromProjectId_fkey" FOREIGN KEY ("fromProjectId") REFERENCES core."Project"("id") ON DELETE SET NULL,
    CONSTRAINT "EquipmentTransfer_fromSectorId_fkey" FOREIGN KEY ("fromSectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL,
    CONSTRAINT "EquipmentTransfer_toProjectId_fkey" FOREIGN KEY ("toProjectId") REFERENCES core."Project"("id") ON DELETE SET NULL,
    CONSTRAINT "EquipmentTransfer_toSectorId_fkey" FOREIGN KEY ("toSectorId") REFERENCES core."Sector"("id") ON DELETE SET NULL,
    CONSTRAINT "EquipmentTransfer_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES core."User"("id") ON DELETE RESTRICT,
    CONSTRAINT "EquipmentTransfer_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES core."User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "EquipmentTransfer_status_idx" ON ops."EquipmentTransfer" ("status");
CREATE INDEX IF NOT EXISTS "EquipmentTransfer_equipmentId_idx" ON ops."EquipmentTransfer" ("equipmentId");
CREATE INDEX IF NOT EXISTS "EquipmentTransfer_effectiveDate_idx" ON ops."EquipmentTransfer" ("effectiveDate");
CREATE UNIQUE INDEX IF NOT EXISTS "EquipmentTransfer_one_pending_per_equipment"
    ON ops."EquipmentTransfer" ("equipmentId") WHERE "status" = 'PENDING';
