// Pure unit tests for the temporal transfer-chain selection core.
//
// These tests exercise `selectTransferAssignmentAtDate` — the exact function
// used by `resolveEquipmentAssignmentAtDate` — with pre-sorted transfer
// slices shaped exactly like the resolver's DB query result.
//
// Runtime DB scenarios (concurrent approvals, cron transactions, FK checks)
// still require an isolated PostgreSQL database and remain pending.
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_transfer_temporal";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";
import { selectTransferAssignmentAtDate, type TransferSlice } from "./transfer.service.js";

const A = { projectId: 1, sectorId: 10 };
const B = { projectId: 2, sectorId: 20 };
const C = { projectId: 3, sectorId: 30 };
const D = { projectId: 4, sectorId: 40 };

function t(
  id: number,
  from: { projectId: number | null; sectorId: number | null },
  to: { projectId: number | null; sectorId: number | null },
  effectiveDate: string
): TransferSlice {
  return {
    id,
    fromProjectId: from.projectId,
    fromSectorId: from.sectorId,
    toProjectId: to.projectId,
    toSectorId: to.sectorId,
    effectiveDate: new Date(effectiveDate),
  };
}

function pick(transfers: TransferSlice[], current: { projectId: number | null; sectorId: number | null }, at: string) {
  return selectTransferAssignmentAtDate(transfers, current, new Date(at));
}

test("before the first transfer: uses the first transfer's source, not the current row", () => {
  const transfers = [t(1, A, B, "2026-11-20")];
  // Equipment row already moved elsewhere, but the record date precedes it.
  const r = pick(transfers, C, "2026-11-15");
  assert.deepEqual(r, A);
});

test("exactly on the effectiveDate: destination applies", () => {
  const transfers = [t(1, A, B, "2026-11-20")];
  assert.deepEqual(pick(transfers, A, "2026-11-20"), B);
});

test("the day before the effectiveDate: still the source", () => {
  const transfers = [t(1, A, B, "2026-11-20")];
  assert.deepEqual(pick(transfers, A, "2026-11-19"), A);
});

test("between two transfers: latest applicable destination", () => {
  const transfers = [t(1, A, B, "2026-11-15"), t(2, B, C, "2026-11-20")];
  assert.deepEqual(pick(transfers, A, "2026-11-17"), B);
});

test("after multiple transfers: latest destination wins", () => {
  const transfers = [t(1, A, B, "2026-11-15"), t(2, B, C, "2026-11-20")];
  assert.deepEqual(pick(transfers, A, "2026-12-01"), C);
});

test("A→B then B→C chain is allowed and resolves chronologically", () => {
  const transfers = [t(1, A, B, "2026-11-20"), t(2, B, C, "2026-11-25")];
  assert.deepEqual(pick(transfers, A, "2026-11-19"), A);
  assert.deepEqual(pick(transfers, A, "2026-11-20"), B);
  assert.deepEqual(pick(transfers, A, "2026-11-24"), B);
  assert.deepEqual(pick(transfers, A, "2026-11-25"), C);
});

test("approved-but-not-completed transfers still apply by effectiveDate", () => {
  // Status is not part of the slice: APPROVED and COMPLETED behave identically.
  const transfers = [t(1, A, B, "2026-11-20")];
  assert.deepEqual(pick(transfers, A, "2026-11-21"), B);
});

test("same-date conflicting destinations throw 409", () => {
  const transfers = [t(1, A, B, "2026-11-20"), t(2, A, C, "2026-11-20")];
  assert.throws(() => pick(transfers, A, "2026-11-21"), (err: { status?: number }) => err.status === 409);
});

test("same-date identical destinations are treated as one logical transfer", () => {
  const transfers = [t(1, A, B, "2026-11-20"), t(2, A, B, "2026-11-20")];
  assert.deepEqual(pick(transfers, A, "2026-11-21"), B);
});

test("no transfers: falls back to the current equipment assignment", () => {
  assert.deepEqual(pick([], C, "2026-11-15"), C);
});

test("null destination sector resolves with null sectorId", () => {
  const transfers = [t(1, A, { projectId: 2, sectorId: null }, "2026-11-20")];
  assert.deepEqual(pick(transfers, A, "2026-11-21"), { projectId: 2, sectorId: null });
});

test("UTC date boundaries: an effectiveDate stored as UTC midnight applies all day", () => {
  // effectiveDate parsed from "YYYY-MM-DD" is UTC midnight; a record date
  // later the same UTC day must resolve to the destination.
  const transfers = [t(1, A, B, "2026-11-20")];
  const lateSameDay = new Date("2026-11-20T23:59:59.000Z");
  assert.deepEqual(
    selectTransferAssignmentAtDate(transfers, A, lateSameDay),
    B
  );
});
