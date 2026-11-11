import test from "node:test";
import assert from "node:assert/strict";
import {
  findOverlaps,
  isSameAssignment,
  resolveAssignmentAt,
  sortAssignments,
  type AssignmentLike,
} from "./assignmentHistory";

const A = { projectId: 1, sectorId: 10, projectSectorId: 100 };
const B = { projectId: 2, sectorId: 20, projectSectorId: 200 };

function row(
  base: { projectId: number | null; sectorId: number | null; projectSectorId: number | null },
  from: string,
  to: string | null
): AssignmentLike {
  return { ...base, effectiveFrom: new Date(from), effectiveTo: to ? new Date(to) : null };
}

test("no assignments means UNKNOWN, never the current equipment assignment", () => {
  assert.equal(resolveAssignmentAt([], new Date("2024-01-01")), null);
});

test("equipment that never moved resolves to the same project for any date inside the interval", () => {
  const list = [row(A, "2024-01-01", null)];
  assert.equal(resolveAssignmentAt(list, new Date("2024-03-01"))?.projectId, 1);
  assert.equal(resolveAssignmentAt(list, new Date("2030-01-01"))?.projectId, 1);
});

test("record before a transfer resolves to project A", () => {
  const list = [row(A, "2024-01-01", "2024-06-01"), row(B, "2024-06-01", null)];
  assert.equal(resolveAssignmentAt(list, new Date("2024-03-15"))?.projectId, 1);
});

test("record after a transfer resolves to project B", () => {
  const list = [row(A, "2024-01-01", "2024-06-01"), row(B, "2024-06-01", null)];
  assert.equal(resolveAssignmentAt(list, new Date("2024-07-15"))?.projectId, 2);
});

test("sector follows the transfer together with project", () => {
  const list = [row(A, "2024-01-01", "2024-06-01"), row(B, "2024-06-01", null)];
  const after = resolveAssignmentAt(list, new Date("2024-08-01"));
  assert.equal(after?.sectorId, 20);
  assert.equal(after?.projectSectorId, 200);
});

test("record earlier than the first known interval stays UNKNOWN", () => {
  const list = [row(B, "2024-06-01", null)];
  assert.equal(resolveAssignmentAt(list, new Date("2024-01-01")), null);
});

test("a current assignment must not be used as evidence for a past record", () => {
  // Observation started today; yesterday's record has no trusted context.
  const list = [row(A, "2026-11-11", null)];
  assert.equal(resolveAssignmentAt(list, new Date("2026-11-10")), null);
});

test("gaps between intervals are UNKNOWN", () => {
  const list = [row(A, "2024-01-01", "2024-02-01"), row(B, "2024-05-01", null)];
  assert.equal(resolveAssignmentAt(list, new Date("2024-03-01")), null);
});

test("boundaries are half-open: effectiveTo is exclusive", () => {
  const list = [row(A, "2024-01-01", "2024-06-01"), row(B, "2024-06-01", null)];
  assert.equal(resolveAssignmentAt(list, new Date("2024-06-01"))?.projectId, 2);
  assert.equal(resolveAssignmentAt(list, new Date("2024-05-31T23:59:59Z"))?.projectId, 1);
});

test("overlapping intervals are detected", () => {
  const overlaps = findOverlaps([row(A, "2024-01-01", "2024-09-01"), row(B, "2024-06-01", null)]);
  assert.equal(overlaps.length, 1);
});

test("sequential intervals produce no overlap", () => {
  assert.equal(findOverlaps([row(A, "2024-01-01", "2024-06-01"), row(B, "2024-06-01", null)]).length, 0);
});

test("sorting is chronological", () => {
  const sorted = sortAssignments([row(B, "2024-06-01", null), row(A, "2024-01-01", "2024-06-01")]);
  assert.equal(sorted[0].projectId, 1);
  assert.equal(sorted[1].projectId, 2);
});

test("idempotency: same project/sector/projectSector compares equal", () => {
  assert.equal(isSameAssignment(row(A, "2024-01-01", null), row(A, "2024-01-01", null)), true);
  assert.equal(isSameAssignment(row(A, "2024-01-01", null), row(B, "2024-01-01", null)), false);
});

test("null sector is a distinct assignment from a sector", () => {
  const noSector = { projectId: 1, sectorId: null, projectSectorId: null };
  assert.equal(isSameAssignment(row(A, "2024-01-01", null), row(noSector, "2024-01-01", null)), false);
});
