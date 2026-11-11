-- EFMS — Review workflow hardening (PostgreSQL)
-- Adds immutable snapshot columns + clientRequestId idempotency key to operational tables.
-- NOT APPLIED.

ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "projectCode" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "projectName" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "sectorName" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "equipmentCode" TEXT;
ALTER TABLE ops."DailyLog" ADD COLUMN IF NOT EXISTS "equipmentName" TEXT;

ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "projectCode" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "projectName" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "sectorName" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "equipmentCode" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "equipmentName" TEXT;
ALTER TABLE ops."Maintenance" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Maintenance_clientRequestId_key"
    ON ops."Maintenance" ("clientRequestId")
    WHERE "clientRequestId" IS NOT NULL;

ALTER TABLE ops."ReviewRequest" ADD COLUMN IF NOT EXISTS "projectCode" TEXT;

-- ROLLBACK:
-- ALTER TABLE ops."DailyLog" DROP COLUMN IF EXISTS "equipmentName";
-- ALTER TABLE ops."DailyLog" DROP COLUMN IF EXISTS "equipmentCode";
-- ALTER TABLE ops."DailyLog" DROP COLUMN IF EXISTS "sectorName";
-- ALTER TABLE ops."DailyLog" DROP COLUMN IF EXISTS "projectName";
-- ALTER TABLE ops."DailyLog" DROP COLUMN IF EXISTS "projectCode";
-- (repeat for Maintenance and ReviewRequest)
-- DROP INDEX IF EXISTS ops."Maintenance_clientRequestId_key";
-- ALTER TABLE ops."Maintenance" DROP COLUMN IF EXISTS "clientRequestId";
