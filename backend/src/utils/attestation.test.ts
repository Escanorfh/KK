process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_attestation_test";
process.env.JWT_SECRET = "test-secret";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";
import { issueAttestation, verifyAttestation, attestationMatchesSnapshot } from "./attestation.js";

const base = {
  equipmentId: 7,
  equipmentCode: "EQ-007",
  projectId: 12,
  projectCode: "P-12",
  projectName: "Project A",
  sectorId: 88,
  sectorName: "Sector X",
  projectSectorId: 301,
};

test("valid attestation verifies and matches snapshot", () => {
  const token = issueAttestation(base);
  const v = verifyAttestation(token);
  assert.equal(v.valid, true);
  assert.ok(v.claims);
  assert.equal(attestationMatchesSnapshot(v.claims!, base, base.equipmentId), true);
});

test("tampered signature is rejected", () => {
  const token = issueAttestation(base);
  const [body] = token.split(".");
  const forged = `${body}.AAAA`;
  const v = verifyAttestation(forged);
  assert.equal(v.valid, false);
});

test("modified projectId is rejected", () => {
  const token = issueAttestation(base);
  const v = verifyAttestation(token);
  assert.equal(v.valid, true);
  const modified = { ...base, projectId: 999 };
  assert.equal(attestationMatchesSnapshot(v.claims!, modified, base.equipmentId), false);
});

test("modified sectorId is rejected", () => {
  const token = issueAttestation(base);
  const v = verifyAttestation(token);
  assert.equal(v.valid, true);
  const modified = { ...base, sectorId: 777 };
  assert.equal(attestationMatchesSnapshot(v.claims!, modified, base.equipmentId), false);
});

test("modified names are rejected", () => {
  const token = issueAttestation(base);
  const v = verifyAttestation(token);
  assert.equal(v.valid, true);
  assert.equal(attestationMatchesSnapshot({ ...v.claims!, projectName: "Renamed" }, base, base.equipmentId), false);
});

test("modified projectSectorId is rejected", () => {
  const token = issueAttestation(base);
  const v = verifyAttestation(token);
  assert.equal(v.valid, true);
  const modified = { ...base, projectSectorId: 999 };
  assert.equal(attestationMatchesSnapshot(v.claims!, modified, base.equipmentId), false);
});

test("null projectSectorId attestation cannot authorize a snapshot requiring an association", () => {
  const nullAssoc = { ...base, projectSectorId: null };
  const token = issueAttestation(nullAssoc);
  const v = verifyAttestation(token);
  assert.equal(v.valid, true);
  // A snapshot that requires an association (non-null) must not match a null claim.
  const requiresAssoc = { ...base, projectSectorId: 301 };
  assert.equal(attestationMatchesSnapshot(v.claims!, requiresAssoc, base.equipmentId), false);
});

test("attestation for another equipment is rejected", () => {
  const token = issueAttestation(base);
  const v = verifyAttestation(token);
  assert.equal(v.valid, true);
  assert.equal(attestationMatchesSnapshot(v.claims!, base, 999), false);
});

test("missing attestation is rejected", () => {
  const v = verifyAttestation(null);
  assert.equal(v.valid, false);
  const v2 = verifyAttestation("");
  assert.equal(v2.valid, false);
});

test("malformed token is rejected", () => {
  const v = verifyAttestation("not.a.valid.token.extra");
  assert.equal(v.valid, false);
});
