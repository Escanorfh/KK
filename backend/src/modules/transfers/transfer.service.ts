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
        transferDate: new Date(data.transferDate),
        effectiveDate: new Date(data.transferDate),
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

export async function approve(id: number, userId: number, data: { toProjectId: number; toSectorId?: number | null; effectiveDate?: string }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.equipmentTransfer.findUnique({ where: { id } });
    if (!existing) fail("عملية النقل غير موجودة", 404);
    if (existing.status !== "PENDING") fail("العملية ليست في حالة مراجعة", 409);

    // Shared row-level lock (same as completeDue) to serialize with Cron.
    await tx.$queryRaw`SELECT id FROM core."Equipment" WHERE id = ${existing.equipmentId} FOR UPDATE`;

    // Re-read equipment after lock.
    const equipment = await tx.equipment.findUnique({ where: { id: existing.equipmentId } });
    if (!equipment) fail("المعدة غير موجودة", 404);
    if (equipment.projectId !== existing.fromProjectId || equipment.sectorId !== existing.fromSectorId) {
      fail("تعارض: تغير تخصيص المعدة منذ تقديم الطلب. يرجى مراجعة ROOT.", 409);
    }

    // Chain validation: the expected assignment immediately before this transfer's effective date
    // must match the request's source (fromProjectId/fromSectorId).
    const effDate = data.effectiveDate ? new Date(data.effectiveDate) : existing.transferDate;
    const prior = await resolveEquipmentAssignmentAtDate(existing.equipmentId, new Date(effDate.getTime() - 86400000));
    if (prior.projectId !== existing.fromProjectId || prior.sectorId !== existing.fromSectorId) {
      fail("تعارض: التخصيص المتوقع قبل تاريخ السريان لا يطابق مصدر الطلب.", 409);
    }

    // Conflict check: no other approved transfer with overlapping effective date for same equipment
    const conflicting = await tx.equipmentTransfer.findFirst({
      where: {
        equipmentId: existing.equipmentId,
        id: { not: id },
        status: { in: ["APPROVED", "COMPLETED"] },
        effectiveDate: effDate,
      },
    });
    if (conflicting) fail("يوجد طلب نقل معتمد آخر بنفس تاريخ السريان", 409);

    const toProject = await tx.project.findUnique({ where: { id: data.toProjectId } });
    if (!toProject) fail("المشروع المستهدف غير موجود", 404);

    // Atomic claim
    const claim = await tx.equipmentTransfer.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "APPROVED",
        toProjectId: data.toProjectId,
        toSectorId: data.toSectorId ?? null,
        effectiveDate: effDate,
        reviewedById: userId,
        reviewedAt: new Date(),
      },
    });
    if (claim.count === 0) fail("تمت مراجعة الطلب بالفعل", 409);

    const updated = await tx.equipmentTransfer.findUnique({ where: { id }, include });
    await logAudit(userId, "EquipmentTransfer", id, "UPDATE", { action: "APPROVE", toProjectId: data.toProjectId });
    return updated!;
  });
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

export async function completeDue() {
  const due = await prisma.equipmentTransfer.findMany({
    where: { status: "APPROVED", effectiveDate: { lte: new Date() } },
    orderBy: [{ effectiveDate: "asc" }, { id: "asc" }],
  });

  // Group by equipment for per-equipment serialization
  const byEquipment = new Map<number, typeof due>();
  for (const t of due) {
    if (!byEquipment.has(t.equipmentId)) byEquipment.set(t.equipmentId, []);
    byEquipment.get(t.equipmentId)!.push(t);
  }

  let completed = 0;
  for (const [equipmentId, transfers] of byEquipment) {
    // Sort chronologically within equipment
    transfers.sort((a, b) => {
      const da = a.effectiveDate?.getTime() ?? 0;
      const db = b.effectiveDate?.getTime() ?? 0;
      if (da !== db) return da - db;
      return a.id - b.id;
    });

    try {
      await prisma.$transaction(async (tx) => {
        // Row-level lock on Equipment to serialize concurrent Cron instances
        await tx.$queryRaw`SELECT id FROM core."Equipment" WHERE id = ${equipmentId} FOR UPDATE`;

        // Re-read due transfers inside the lock
        const currentDue = await tx.equipmentTransfer.findMany({
          where: { equipmentId, status: "APPROVED", effectiveDate: { lte: new Date() } },
          orderBy: [{ effectiveDate: "asc" }, { id: "asc" }],
        });

        for (const t of currentDue) {
          // Atomic claim
          const claim = await tx.equipmentTransfer.updateMany({
            where: { id: t.id, status: "APPROVED" },
            data: { status: "COMPLETED" },
          });
          if (claim.count === 0) continue; // already processed
          await tx.equipment.update({
            where: { id: equipmentId },
            data: { projectId: t.toProjectId, sectorId: t.toSectorId },
          });
          completed++;
        }
      });
    } catch (err) {
      // Transaction rolled back; transfers remain APPROVED for retry
    }
  }
  return completed;
}
