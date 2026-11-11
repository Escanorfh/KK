import crypto from "node:crypto";

const SECRET = (process.env.JWT_SECRET || "dev-secret") + ":snapshot-attestation";

export interface AttestationClaims {
  equipmentId: number;
  equipmentCode: string;
  projectId: number | null;
  projectCode: string | null;
  projectName: string | null;
  sectorId: number | null;
  sectorName: string | null;
  projectSectorId: number | null;
  issuedAt: string;
}

function canonical(claims: AttestationClaims): string {
  return JSON.stringify({
    equipmentId: claims.equipmentId,
    equipmentCode: claims.equipmentCode,
    projectId: claims.projectId,
    projectCode: claims.projectCode,
    projectName: claims.projectName,
    sectorId: claims.sectorId,
    sectorName: claims.sectorName,
    projectSectorId: claims.projectSectorId,
    issuedAt: claims.issuedAt,
  });
}

export function issueAttestation(claims: Omit<AttestationClaims, "issuedAt"> & { issuedAt?: string }): string {
  const full: AttestationClaims = {
    ...claims,
    issuedAt: claims.issuedAt ?? new Date().toISOString(),
  };
  const body = Buffer.from(canonical(full), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export interface VerifyResult {
  valid: boolean;
  claims: AttestationClaims | null;
  reason?: string;
}

export function verifyAttestation(token: string | null | undefined): VerifyResult {
  if (!token || typeof token !== "string") return { valid: false, claims: null, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, claims: null, reason: "malformed" };
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, claims: null, reason: "bad-signature" };
  let claims: AttestationClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AttestationClaims;
  } catch {
    return { valid: false, claims: null, reason: "bad-payload" };
  }
  if (typeof claims.equipmentId !== "number") return { valid: false, claims: null, reason: "bad-claims" };
  return { valid: true, claims };
}

export function attestationMatchesSnapshot(
  claims: AttestationClaims,
  snapshot: {
    projectId?: number | null;
    projectCode?: string | null;
    projectName?: string | null;
    sectorId?: number | null;
    sectorName?: string | null;
    projectSectorId?: number | null;
  },
  equipmentId: number,
): boolean {
  if (claims.equipmentId !== equipmentId) return false;
  if (claims.projectId !== (snapshot.projectId ?? null)) return false;
  if (claims.projectCode !== (snapshot.projectCode ?? null)) return false;
  if (claims.projectName !== (snapshot.projectName ?? null)) return false;
  if (claims.sectorId !== (snapshot.sectorId ?? null)) return false;
  if (claims.sectorName !== (snapshot.sectorName ?? null)) return false;
  // Association identity: when the snapshot requires an association (non-null),
  // the claim must carry the same non-null id. A null claim cannot authorize a
  // snapshot that requires an association.
  const snapshotAssoc = snapshot.projectSectorId ?? null;
  if (snapshotAssoc != null) {
    if (claims.projectSectorId !== snapshotAssoc) return false;
  } else {
    // snapshot has no association: claim must also be null (or absent).
    if (claims.projectSectorId != null) return false;
  }
  return true;
}
