# Wasmer Migration Report — 2026-11-14

## 1. Files inspected
- `backend/prisma/schema.prisma` (full)
- `backend/prisma/migrations-manual/*.sql` (all 5 prior files)
- `backend/src/app.ts` (REQUIRED_COLUMNS, SCHEMA_MIGRATION_FILE)
- `backend/src/modules/*` (services using Prisma models)

## 2. Current Prisma models and required changes
All models in schema.prisma (core/ops/log schemas) are represented. New tables: ProjectSector, ReviewRequest. New columns: Sector.managersRoomId/Title, NeedRequest.sectorId/projectSectorId, snapshot columns on DailyLog/Maintenance, projectSectorId on RepairOrder/Fault, Maintenance.operationId/clientRequestId, ReviewRequest full set.

## 3. Mapping of old migration files
- 2026-11-05-need-request-sector.sql → Sector managersRoom* + NeedRequest.sectorId
- 2026-11-10-project-sector-m2m.sql → ProjectSector + snapshot columns + FKs + contextSource CHECK
- 2026-11-11-...normalizedName-unique.sql → unique index (commented, needs normalization first)
- 2026-11-12-operational-review-approval.sql → ReviewRequest + ReviewStatus enum
- 2026-11-13-review-hardening.sql → snapshot columns + Maintenance.clientRequestId

## 4. Changes added beyond the five prior migrations
- Consolidated all into one idempotent file.
- Added missing `projectCode`/`projectName`/`sectorName`/`equipmentCode`/`equipmentName` to DailyLog/Maintenance (were in schema but not in prior migrations).
- Added `Maintenance.clientRequestId` unique index.
- Added `ProjectSector.normalizedName` check constraint guard.

## 5. Execution order
1. Enum ReviewStatus
2. Sector columns
3. ProjectSector table + indexes + check
4. NeedRequest columns + FKs
5. DailyLog snapshot columns + FKs + check
6. Maintenance snapshot columns + FKs + check + unique indexes
7. RepairOrder/Fault projectSectorId + FKs
8. ReviewRequest table + indexes
9. Sector.projectId FK SET NULL
10. (Post) normalizedName unique index after normalization

## 6. Preflight checks that must pass
Run `2026-11-14-wasmer-preflight.sql`. All duplicate/invalid-FK queries must return 0.

## 7. Manual normalization required
Run `backend/prisma/normalize-project-sector-names.ts` (if exists) or manually normalize `ProjectSector.normalizedName` via `normalizeArabic` before uncommenting the unique index.

## 8. Operations that cannot be safely automated
- normalizedName unique index (requires app-level normalization).
- Data backfill of historical snapshots (forbidden by policy).

## 9. Exact commands (psql)
```bash
psql "$DATABASE_URL" -f backend/prisma/migrations-manual/2026-11-14-wasmer-preflight.sql
psql "$DATABASE_URL" -f backend/prisma/migrations-manual/2026-11-14-wasmer-schema-update.sql
```

## 10. Post-migration verification
```sql
SELECT COUNT(*) FROM information_schema.columns WHERE table_name='DailyLog' AND column_name='projectCode';
SELECT COUNT(*) FROM pg_type WHERE typname='ReviewStatus';
```

## Confirmation
No database was accessed or modified. No Git commit/push/deployment occurred.
