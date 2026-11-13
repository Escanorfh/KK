import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

const include = {
  equipment: { select: { id: true, code: true, name: true, project: { select: { id: true, name: true } }, sector: { select: { id: true, name: true } } } },
  fromProject: { select: { id: true, name: true } },
  fromSector: { select: { id: true, name: true } },
  toProject: { select: { id: true, name: true } },
  toSector: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
};

export async function stats() {
  const [total, pending, approved, completed, rejected] = await Promise.all([
    prisma.equipmentTransfer.count(),
    prisma.equipmentTransfer.count({ where: { status: "PENDING" } }),
    prisma.equipmentTransfer.count({ where: { status: "APPROVED" } }),
    prisma.equipmentTransfer.count({ where: { status: "COMPLETED" } }),
    prisma.equipmentTransfer.count({ where: { status: "REJECTED" } }),
  ]);
  return { total, pending, approved, completed, rejected };
}

export async function list(params: { q?: string; status?: string; projectId?: number; page: number; pageSize: number }) {
  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.projectId) where.OR = [{ fromProjectId: params.projectId }, { toProjectId: params.projectId }];
  if (params.q) {
    where.AND = [{ OR: [{ equipment: { code: { contains: params.q, mode: "insensitive" } } }, { equipment: { name: { contains: params.q, mode: "insensitive" } } }] }];
  }
  const [data, total] = await Promise.all([
    prisma.equipmentTransfer.findMany({ where, include, orderBy: [{ createdAt: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    prisma.equipmentTransfer.count({ where }),
  ]);
  return { data, total, page: params.page, pageSize: params.pageSize };
}

export async function get(id: number) {
  const r = await prisma.equipmentTransfer.findUnique({ where: { id }, include });
  if (!r) fail("عملية النقل غير موجودة", 404);
  return r;
}

export async function create(data: { equipmentId: number; transferDate: string; reason?: string | null; notes?: string | null }, userId: number) {
  const equipment = await prisma.equipment.findUnique({ where: { id: data.equipmentId } });
  if (!equipment) fail("المعدة غير موجودة", 404);

  // Prevent duplicate pending transfers for the same equipment
  const existing = await prisma.equipmentTransfer.findFirst({ where: { equipmentId: data.equipmentId, status: "PENDING" } });
  if (existing) fail("يوجد طلب نقل معلق لهذه المعدة بالفعل", 409);

  try {
    const record = await prisma.equipmentTransfer.create({
      data: {
        equipmentId: data.equipmentId,
        fromProjectId: equipment.projectId,
        fromSectorId: equipment.sectorId,
        toProjectId: null,
        toSectorId: null,
        // transferDate is the archival request date only; it never delays execution.
        transferDate: new Date(data.transferDate),
        // effectiveDate is set server-side at execution time (approval) — never by the client.
        effectiveDate: null,
        reason: data.reason ?? null,
        notes: data.notes ?? null,
        submittedById: userId,
        status: "PENDING",
      },
      include,
    });
    await logAudit(userId, "EquipmentTransfer", record.id, "CREATE", { equipmentId: data.equipmentId });
    return record;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      fail("يوجد طلب نقل معلق لهذه المعدة بالفعل", 409);
    }
    throw err;
  }
}

/**
 * ROOT approves → the transfer executes IMMEDIATELY.
 *
 * One atomic transaction: lock Equipment row → re-read → validate source,
 * destination project, destination ProjectSector link, and no conflicting
 * pending request → mark the request COMPLETED (claiming it atomically) →
 * update Equipment.projectId/sectorId → commit. Any failure rolls the whole
 * transaction back: Equipment is never updated without a recorded transfer,
 * and a transfer is never completed without updating Equipment.
 *
 * `effectiveDate` is set to the server-side execution date so the historical
 * resolver (`resolveEquipmentAssignmentAtDate`) places the transfer at the
 * moment it actually happened. It no longer schedules anything.
 */
export async function approve(id: number, userId: number, data: { toProjectId: number; toSectorId?: number | null }) {
  const executedAt = new Date(); // server-side execution timestamp

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.equipmentTransfer.findUnique({ where: { id } });
    if (!existing) fail("عملية النقل غير موجودة", 404);
    if (existing.status !== "PENDING") fail("العملية ليست في حالة مراجعة", 409);

    // 1. Equipment row lock — serializes concurrent approvals on the same equipment.
    await tx.$queryRaw`SELECT id FROM core."Equipment" WHERE id = ${existing.equipmentId} FOR UPDATE`;

    // 2. Re-read the equipment after acquiring the lock.
    const equipment = await tx.equipment.findUnique({ where: { id: existing.equipmentId } });
    if (!equipment) fail("المعدة غير موجودة", 404);

    // 3. The equipment must still be in the source project/sector recorded on the request.
    if (equipment.projectId !== existing.fromProjectId || equipment.sectorId !== existing.fromSectorId) {
      fail("تعارض: تغير تخصيص المعدة منذ تقديم الطلب. يرجى مراجعة ROOT.", 409);
    }

    // 4. Destination project must exist.
    const toProject = await tx.project.findUnique({ where: { id: data.toProjectId } });
    if (!toProject) fail("المشروع المستهدف غير موجود", 404);

    // 5. Destination sector must exist and be linked to the destination project
    //    through an ACTIVE ProjectSector. Never create/reactivate associations here.
    if (data.toSectorId != null) {
      const toSector = await tx.sector.findUnique({ where: { id: data.toSectorId } });
      if (!toSector) fail("القطاع المستهدف غير موجود", 404);
      const link = await tx.projectSector.findFirst({
        where: { projectId: data.toProjectId, sectorId: data.toSectorId, active: true },
        select: { id: true },
      });
      if (!link) fail("القطاع المستهدف غير مرتبط بالمشروع المستهدف", 409);
    }

    // 6. No other pending request for the same equipment (belt-and-braces on top
    //    of the partial unique index; two conflicting approvals cannot both pass).
    const otherPending = await tx.equipmentTransfer.findFirst({
      where: { equipmentId: existing.equipmentId, status: "PENDING", id: { not: id } },
      select: { id: true },
    });
    if (otherPending) fail("يوجد طلب نقل معلق آخر لنفس المعدة", 409);

    // 7+9. Atomic claim: only a PENDING request can be completed — a second
    //      concurrent approval fails here with count === 0.
    const claim = await tx.equipmentTransfer.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "COMPLETED",
        toProjectId: data.toProjectId,
        toSectorId: data.toSectorId ?? null,
        // Execution date (server time) — drives the historical resolver only.
        effectiveDate: executedAt,
        reviewedById: userId,
        reviewedAt: executedAt,
      },
    });
    if (claim.count === 0) fail("تمت مراجعة الطلب بالفعل", 409);

    // 8. Move the equipment NOW — same transaction, same lock.
    await tx.equipment.update({
      where: { id: existing.equipmentId },
      data: { projectId: data.toProjectId, sectorId: data.toSectorId ?? null },
    });

    return tx.equipmentTransfer.findUnique({ where: { id }, include });
  });

  // Assignment-history compatibility (post-commit, best-effort): an executed
  // transfer is an EFMS-observed assignment change at execution time. This
  // closes the previous open interval and opens a new one — idempotent, never
  // backdated. Uses the safe wrapper so an unmigrated history table cannot
  // break an already-committed transfer.
  try {
    const { recordAssignmentSafe, activeProjectSectorId, ASSIGNMENT_SOURCES } = await import("../../utils/assignmentHistory.js");
    await recordAssignmentSafe({
      equipmentId: record!.equipmentId,
      projectId: data.toProjectId,
      sectorId: data.toSectorId ?? null,
      projectSectorId: await activeProjectSectorId(data.toProjectId, data.toSectorId ?? null),
      sourceSystem: ASSIGNMENT_SOURCES.EFMS_TRANSFER,
      sourceReference: `transfer:${id}`,
      at: executedAt,
    });
  } catch {
    // history recording must never fail the transfer itself
  }

  await logAudit(userId, "EquipmentTransfer", id, "UPDATE", {
    action: "TRANSFER_EXECUTED",
    toProjectId: data.toProjectId,
    toSectorId: data.toSectorId ?? null,
    equipmentId: record!.equipmentId,
  });
  return record!;
}

export async function reject(id: number, userId: number, reason: string) {
  const existing = await prisma.equipmentTransfer.findUnique({ where: { id } });
  if (!existing) fail("عملية النقل غير موجودة", 404);
  if (existing.status !== "PENDING") fail("العملية ليست في حالة مراجعة", 409);
  const updated = await prisma.equipmentTransfer.update({
    where: { id },
    data: { status: "REJECTED", reviewedById: userId, reviewedAt: new Date(), rejectionReason: reason },
    include,
  });
  await logAudit(userId, "EquipmentTransfer", id, "UPDATE", { action: "REJECT", reason });
  return updated;
}

export async function cancel(id: number, userId: number) {
  const existing = await prisma.equipmentTransfer.findUnique({ where: { id } });
  if (!existing) fail("عملية النقل غير موجودة", 404);
  if (existing.status !== "PENDING") fail("لا يمكن إلغاء عملية غير معلقة", 409);
  const updated = await prisma.equipmentTransfer.update({
    where: { id },
    data: { status: "CANCELLED" },
    include,
  });
  await logAudit(userId, "EquipmentTransfer", id, "UPDATE", { action: "CANCEL" });
  return updated;
}

// Pure selection core of the temporal resolver — shared by the DB-backed
// resolver below and by unit tests. `transfers` must be pre-sorted by
// (effectiveDate asc, id asc), containing only APPROVED/COMPLETED rows with a
// non-null effectiveDate (exactly what the resolver queries).
export interface TransferSlice {
  id: number;
  fromProjectId: number | null;
  fromSectorId: number | null;
  toProjectId: number | null;
  toSectorId: number | null;
  effectiveDate: Date | null;
}

export function selectTransferAssignmentAtDate(
  transfers: TransferSlice[],
  current: { projectId: number | null; sectorId: number | null },
  recordDate: Date
): { projectId: number | null; sectorId: number | null } {
  if (transfers.length === 0) {
    return { projectId: current.projectId, sectorId: current.sectorId };
  }

  // Detect conflicting same-effective-date transfers
  for (let i = 1; i < transfers.length; i++) {
    const prev = transfers[i - 1];
    const cur = transfers[i];
    if (prev.effectiveDate && cur.effectiveDate && prev.effectiveDate.getTime() === cur.effectiveDate.getTime()) {
      // Same date: require identical destination to be considered one logical transfer
      if (prev.toProjectId !== cur.toProjectId || prev.toSectorId !== cur.toSectorId) {
        throw Object.assign(new Error("تعارض في طلبات النقل: نفس تاريخ السريان لوجهات مختلفة"), { status: 409 });
      }
    }
  }

  // Find the latest transfer with effectiveDate <= recordDate
  let applicable: TransferSlice | null = null;
  for (const t of transfers) {
    if (t.effectiveDate && t.effectiveDate <= recordDate) applicable = t;
    else break;
  }

  if (applicable) {
    return { projectId: applicable.toProjectId, sectorId: applicable.toSectorId };
  }
  // Before the first transfer's effective date: use the first transfer's "from" assignment.
  return { projectId: transfers[0].fromProjectId, sectorId: transfers[0].fromSectorId };
}

// Complete transfers whose effective date has arrived: update Equipment assignment.
export async function resolveEquipmentAssignmentAtDate(equipmentId: number, recordDate: Date): Promise<{ projectId: number | null; sectorId: number | null }> {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { projectId: true, sectorId: true } });
  if (!equipment) return { projectId: null, sectorId: null };

  // Consider both APPROVED and COMPLETED transfers whose effectiveDate has arrived.
  const transfers = await prisma.equipmentTransfer.findMany({
    where: {
      equipmentId,
      status: { in: ["APPROVED", "COMPLETED"] },
      effectiveDate: { not: null },
    },
    orderBy: [{ effectiveDate: "asc" }, { id: "asc" }],
    select: { id: true, fromProjectId: true, fromSectorId: true, toProjectId: true, toSectorId: true, effectiveDate: true },
  });

  return selectTransferAssignmentAtDate(transfers, equipment, recordDate);
}
