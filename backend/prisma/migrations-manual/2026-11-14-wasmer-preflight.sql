-- =========================================================================
-- EFMS — Wasmer Preflight Diagnostic (READ-ONLY)
-- =========================================================================

-- Tables present
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('core','ops','log') AND table_type='BASE TABLE'
ORDER BY table_schema, table_name;

-- Columns for key tables
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema IN ('core','ops','log')
  AND table_name IN ('Sector','ProjectSector','NeedRequest','DailyLog','Maintenance','RepairOrder','Fault','ReviewRequest')
ORDER BY table_name, ordinal_position;

-- Enum types
SELECT t.typname, e.enumlabel
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('Role','WorkType','WorkStatus','RepairOrderStatus','Condition','TrackingMode','NeedRequestStatus','ReviewStatus')
ORDER BY t.typname, e.enumsortorder;

-- Duplicate ProjectSector pairs
SELECT "projectId","sectorId",COUNT(*) c
FROM core."ProjectSector" GROUP BY "projectId","sectorId" HAVING COUNT(*)>1;

-- Duplicate (projectId, normalizedName)
SELECT "projectId","normalizedName",COUNT(*) c
FROM core."ProjectSector" GROUP BY "projectId","normalizedName" HAVING COUNT(*)>1;

-- Invalid FK references (DailyLog.projectId)
SELECT COUNT(*) AS bad_dailylog_project
FROM ops."DailyLog" d LEFT JOIN core."Project" p ON p.id=d."projectId"
WHERE d."projectId" IS NOT NULL AND p.id IS NULL;

-- Invalid FK references (Maintenance.projectId)
SELECT COUNT(*) AS bad_maintenance_project
FROM ops."Maintenance" m LEFT JOIN core."Project" p ON p.id=m."projectId"
WHERE m."projectId" IS NOT NULL AND p.id IS NULL;

-- Duplicate Maintenance.clientRequestId
SELECT "clientRequestId",COUNT(*) c
FROM ops."Maintenance" WHERE "clientRequestId" IS NOT NULL
GROUP BY "clientRequestId" HAVING COUNT(*)>1;

-- Existing constraints/indexes
SELECT conname, contype, conrelid::regclass
FROM pg_constraint
WHERE conrelid::regclass::text IN ('core."Sector"','core."ProjectSector"','ops."DailyLog"','ops."Maintenance"','ops."ReviewRequest"')
ORDER BY conrelid::regclass::text, conname;
