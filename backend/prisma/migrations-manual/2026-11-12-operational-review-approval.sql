-- EFMS — Operational Data Review & Approval (PostgreSQL)
-- Phase B.2.4.3: staging table for pending review of DailyLog and Maintenance.
-- NOT APPLIED. Apply only to a verified disposable database.
-- Rollback: see end of file.

CREATE TYPE ops."ReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

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

-- ROLLBACK:
-- DROP TABLE IF EXISTS ops."ReviewRequest";
-- DROP TYPE IF EXISTS ops."ReviewStatus";
