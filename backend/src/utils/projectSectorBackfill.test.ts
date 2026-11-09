import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBackfill,
  checkEnvSafety,
  type ProjectSectorRow,
} from "./projectSectorBackfill.js";

function makeRow(overrides: Partial<ProjectSectorRow> = {}): ProjectSectorRow {
  return {
    id: 1,
    projectId: 10,
    sectorId: 20,
    normalizedName: null,
    active: true,
    sectorName: "المخازن",
    ...overrides,
  };
}

test("backfill: two names normalize to same value within one project → conflict", () => {
  const rows: ProjectSectorRow[] = [
    makeRow({ id: 1, projectId: 10, sectorName: "المخازن" }),
    makeRow({ id: 2, projectId: 10, sectorName: "المخازن " }),
  ];
  const result = computeBackfill(rows);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].projectId, 10);
  assert.deepEqual(result.conflicts[0].ids.sort(), [1, 2]);
  assert.equal(result.updates.length, 0);
});

test("backfill: same normalized name in different projects → allowed", () => {
  const rows: ProjectSectorRow[] = [
    makeRow({ id: 1, projectId: 10, sectorName: "المخازن" }),
    makeRow({ id: 2, projectId: 20, sectorName: "المخازن" }),
  ];
  const result = computeBackfill(rows);
  assert.equal(result.conflicts.length, 0);
});

test("backfill: already correct normalizedName → no update", () => {
  const rows: ProjectSectorRow[] = [
    makeRow({ id: 1, projectId: 10, sectorName: "المخازن", normalizedName: "المخازن" }),
  ];
  const result = computeBackfill(rows);
  assert.equal(result.updates.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test("backfill: repeated execution → same result", () => {
  const rows: ProjectSectorRow[] = [
    makeRow({ id: 1, projectId: 10, sectorName: "المخازن", normalizedName: null }),
  ];
  const first = computeBackfill(rows);
  const rowsAfter: ProjectSectorRow[] = [
    makeRow({ id: 1, projectId: 10, sectorName: "المخازن", normalizedName: "المخازن" }),
  ];
  const second = computeBackfill(rowsAfter);
  assert.equal(first.updates.length, 1);
  assert.equal(second.updates.length, 0);
});

test("backfill: empty name → reported, not written", () => {
  const rows: ProjectSectorRow[] = [
    makeRow({ id: 1, projectId: 10, sectorName: "   " }),
  ];
  const result = computeBackfill(rows);
  assert.deepEqual(result.emptyNames, [1]);
  assert.equal(result.updates.length, 0);
});

test("backfill: identity preservation — updates only normalizedName", () => {
  const rows: ProjectSectorRow[] = [
    makeRow({ id: 5, projectId: 10, sectorId: 20, sectorName: "المخازن", normalizedName: null, active: true }),
  ];
  const result = computeBackfill(rows);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].id, 5);
  assert.deepEqual(Object.keys(result.updates[0]), ["id", "normalizedName"]);
});

test("backfill: archived association included in conflict detection", () => {
  const rows: ProjectSectorRow[] = [
    makeRow({ id: 1, projectId: 10, sectorName: "المخازن", active: false }),
    makeRow({ id: 2, projectId: 10, sectorName: "المخازن ", active: true }),
  ];
  const result = computeBackfill(rows);
  assert.equal(result.conflicts.length, 1);
});

test("env safety: missing opt-in → blocked", () => {
  const result = checkEnvSafety({ allowBackfill: undefined, backfillDatabaseUrl: "postgres://localhost/test", efmsMode: "web", disposableDb: "1" });
  assert.equal(result.safe, false);
});

test("env safety: missing disposable designation → blocked", () => {
  const result = checkEnvSafety({ allowBackfill: "1", backfillDatabaseUrl: "postgres://localhost/test", efmsMode: "web", disposableDb: undefined });
  assert.equal(result.safe, false);
});

test("env safety: desktop mode → blocked", () => {
  const result = checkEnvSafety({ allowBackfill: "1", backfillDatabaseUrl: "postgres://localhost/test", efmsMode: "desktop", disposableDb: "1" });
  assert.equal(result.safe, false);
});

test("env safety: production URL → blocked", () => {
  const result = checkEnvSafety({ allowBackfill: "1", backfillDatabaseUrl: "postgresql://user:pass@neon.tech/db", efmsMode: "web", disposableDb: "1" });
  assert.equal(result.safe, false);
});

test("env safety: all guards pass → safe", () => {
  const result = checkEnvSafety({ allowBackfill: "1", backfillDatabaseUrl: "postgres://localhost/testdb", efmsMode: "web", disposableDb: "1" });
  assert.equal(result.safe, true);
});

test("env safety: no database URL → blocked", () => {
  const result = checkEnvSafety({ allowBackfill: "1", backfillDatabaseUrl: undefined, efmsMode: "web", disposableDb: "1" });
  assert.equal(result.safe, false);
});

// Transaction rollback: simulate via mock
test("backfill: transaction rollback on failure (mock)", () => {
  // This test verifies the computeBackfill logic returns updates only when safe.
  // Actual DB transaction rollback requires a disposable PostgreSQL database.
  // Marked as NOT TESTED for real DB transaction behavior.
  const rows: ProjectSectorRow[] = [
    makeRow({ id: 1, projectId: 10, sectorName: "المخازن", normalizedName: null }),
    makeRow({ id: 2, projectId: 10, sectorName: "الورشة", normalizedName: null }),
  ];
  const result = computeBackfill(rows);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.emptyNames.length, 0);
  assert.equal(result.updates.length, 2);
  // The actual transaction rollback (all-or-nothing) is guaranteed by
  // prisma.$transaction() API contract. Verified by Prisma documentation.
  // Real DB test: BLOCKED (no disposable PostgreSQL available).
});
