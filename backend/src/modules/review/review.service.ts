import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { verifyAttestation, attestationMatchesSnapshot } from "../../utils/attestation";
import * as dailylogService from "../dailylogs/dailylog.service";
import * as maintenanceService from "../maintenance/maintenance.service";

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

interface ListParams {
  entity?: "dailylog" | "maintenance";
  status?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  submittedBy?: number;
  page: number;
  pageSize: number;
}

export async function createReviewRequest(
  input: {
    entity: "dailylog" | "maintenance";
    data: Record<string, unknown>;
    clientRequestId?: string;
    context?: {
      projectId?: number | null;
      sectorId?: number | null;
      projectName?: string | null;
      sectorName?: string | null;
      equipmentCode?: string | null;
      equipmentName?: string | null;
      contextSource?: "SNAPSHOT" | "UNKNOWN";
      capturedAt?: string;
    };
  },
  userId: number,
) {
  // Derive a deterministic fallback idempotency key when the caller did not
  // provide one (e.g. legacy queued operations), so retries cannot create
  // duplicate review submissions.
  const resolvedClientRequestId =
    input.clientRequestId && input.clientRequestId.trim()
      ? input.clientRequestId.trim()
      : `review:${input.entity}:${userId}:${String(input.data.date ?? "")}:${String(input.data.equipmentId ?? "")}:${String(input.data.workOrderNo ?? "")}`;

  if (resolvedClientRequestId) {
    const existing = await prisma.reviewRequest.findUnique({
      where: { clientRequestId: resolvedClientRequestId },
    });
    if (existing) {
      return { review: existing, duplicate: true };
    }
  }

  const rawEq = input.data.equipmentId;
  const equipmentId = typeof rawEq === "number" ? rawEq : Number(rawEq);
  const ctx = input.context ?? {};
  const isOffline = (ctx as { capturedOffline?: boolean }).capturedOffline === true;

  let offlineTrusted = false;
  if (isOffline) {
    const v = verifyAttestation((ctx as { attestation?: string }).attestation);
    if (v.valid && v.claims && attestationMatchesSnapshot(v.claims, ctx, equipmentId)) {
      offlineTrusted = true;
    }
  }

  // Online: context was captured server-side (authoritative) — trust it.
  // Offline trusted: preserve attested snapshot.
  // Offline untrusted: UNKNOWN.
  let finalCtx: Record<string, unknown>;
  let contextSource: string;
  if (!isOffline) {
    finalCtx = ctx;
    contextSource = ctx.contextSource ?? (ctx.projectId != null || ctx.sectorId != null ? "SNAPSHOT" : "UNKNOWN");
  } else if (offlineTrusted) {
    finalCtx = ctx;
    contextSource = ctx.contextSource ?? (ctx.projectId != null || ctx.sectorId != null ? "SNAPSHOT" : "UNKNOWN");
  } else {
    finalCtx = {};
    contextSource = "UNKNOWN";
  }

  const review = await prisma.reviewRequest.create({
    data: {
      entity: input.entity,
      status: "PENDING_REVIEW",
      clientRequestId: resolvedClientRequestId ?? null,
      submittedById: userId,
      submittedData: input.data as any,
      equipmentId: Number.isFinite(equipmentId) ? equipmentId : null,
      projectId: (finalCtx as { projectId?: number | null }).projectId ?? null,
      projectCode: (finalCtx as { projectCode?: string | null }).projectCode ?? null,
      sectorId: (finalCtx as { sectorId?: number | null }).sectorId ?? null,
      projectName: (finalCtx as { projectName?: string | null }).projectName ?? null,
      sectorName: (finalCtx as { sectorName?: string | null }).sectorName ?? null,
      equipmentCode: (finalCtx as { equipmentCode?: string | null }).equipmentCode ?? null,
      equipmentName: (finalCtx as { equipmentName?: string | null }).equipmentName ?? null,
      contextSource,
      capturedAt: ctx.capturedAt ? new Date(ctx.capturedAt) : new Date(),
    },
  });

  await logAudit(userId, "ReviewRequest", review.id, "CREATE", { entity: input.entity });
  return { review, duplicate: false };
}

export async function list(
  params: ListParams,
  user: { id: number; role: string },
) {
  const where: Record<string, unknown> = {};
  if (params.entity) where.entity = params.entity;
  if (params.status) where.status = params.status;
  if (params.submittedBy) where.submittedById = params.submittedBy;
  if (user.role !== "ROOT" && user.role !== "ADMIN") {
    where.submittedById = user.id;
  }

  const [data, total] = await Promise.all([
    prisma.reviewRequest.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        submittedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
      },
    }),
    prisma.reviewRequest.count({ where }),
  ]);

  return { data, total, page: params.page, pageSize: params.pageSize };
}

export async function get(id: number, user: { id: number; role: string }) {
  const review = await prisma.reviewRequest.findUnique({
    where: { id },
    include: {
      submittedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
  });
  if (!review) fail("سجل المراجعة غير موجود", 404);
  if (user.role !== "ROOT" && user.role !== "ADMIN" && review.submittedById !== user.id) {
    fail("غير مصرح بالوصول", 403);
  }
  return review;
}

export async function update(
  id: number,
  input: { data?: Record<string, unknown> },
  userId: number,
  role: string,
) {
  if (role !== "ROOT" && role !== "ADMIN") fail("غير مصرح", 403);
  const existing = await prisma.reviewRequest.findUnique({ where: { id } });
  if (!existing) fail("سجل المراجعة غير موجود", 404);
  if (existing.status !== "PENDING_REVIEW") fail("لا يمكن تعديل سجل غير معلق", 409);

  const updated = await prisma.reviewRequest.update({
    where: { id },
    data: {
      reviewedData: (input.data ?? existing.submittedData) as any,
      updatedAt: new Date(),
    },
  });

  await logAudit(userId, "ReviewRequest", id, "UPDATE", { entity: existing.entity });
  return updated;
}

export async function approve(id: number, userId: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.reviewRequest.findUnique({ where: { id } });
    if (!existing) fail("سجل المراجعة غير موجود", 404);
    if (existing.status !== "PENDING_REVIEW") fail("السجل ليس في حالة مراجعة", 409);

    const data = ((existing.reviewedData ?? existing.submittedData) ?? {}) as Record<string, unknown>;
    const context = {
      projectId: existing.projectId,
      projectCode: (existing as { projectCode?: string | null }).projectCode ?? null,
      projectName: existing.projectName,
      sectorId: existing.sectorId,
      sectorName: existing.sectorName,
      equipmentCode: existing.equipmentCode,
      equipmentName: existing.equipmentName,
      contextSource: existing.contextSource ?? "UNKNOWN",
    };

    const claim = await tx.reviewRequest.updateMany({
      where: { id, status: "PENDING_REVIEW" },
      data: { status: "APPROVED", reviewedById: userId, reviewedAt: new Date() },
    });
    if (claim.count === 0) fail("تم اعتماد السجل بالفعل", 409);

    let record: { id: number } & Record<string, unknown>;
    let updated = false;
    try {
      if (existing.entity === "dailylog") {
        const r = await dailylogService.createApproved(data as any, userId, context, tx);
        record = r.record as any;
        updated = r.updated;
      } else {
        const r = await maintenanceService.createApproved(data as any, userId, context, tx);
        record = r.record as any;
        updated = r.updated;
      }
    } catch (err) {
      throw err;
    }

    await tx.reviewRequest.update({
      where: { id },
      data: { recordId: record.id },
    });

    await logAudit(userId, "ReviewRequest", id, "UPDATE", {
      action: "APPROVE",
      entity: existing.entity,
      recordId: record.id,
    });

    const review = await tx.reviewRequest.findUnique({ where: { id } });
    return { review, record, updated };
  });
}

export async function reject(id: number, userId: number, reason: string) {
  if (!reason || !reason.trim()) fail("سبب الرفض مطلوب", 400);
  const existing = await prisma.reviewRequest.findUnique({ where: { id } });
  if (!existing) fail("سجل المراجعة غير موجود", 404);
  if (existing.status !== "PENDING_REVIEW") fail("السجل ليس في حالة مراجعة", 409);

  const guard = await prisma.reviewRequest.updateMany({
    where: { id, status: "PENDING_REVIEW" },
    data: {
      status: "REJECTED",
      reviewedById: userId,
      reviewedAt: new Date(),
      rejectionReason: reason.trim(),
    },
  });
  if (guard.count === 0) fail("تمت مراجعة السجل بالفعل", 409);

  await logAudit(userId, "ReviewRequest", id, "UPDATE", { action: "REJECT", entity: existing.entity, reason });

  const review = await prisma.reviewRequest.findUnique({ where: { id } });
  return review;
}
