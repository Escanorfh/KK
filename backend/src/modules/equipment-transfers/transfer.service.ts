import type { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";

export interface CreateTransferRequestInput {
  equipmentId: number;
  destinationProjectId: number;
  destinationSectorId: number;
  transferDate: string;
  reason?: string | null;
  notes?: string | null;
}

export async function createTransferRequest(input: CreateTransferRequestInput, userId: number) {
  const equipment = await prisma.equipment.findUnique({
    where: { id: input.equipmentId },
    select: { id: true, code: true, projectId: true, sectorId: true, name: true },
  });
  if (!equipment) throw Object.assign(new Error("المعدة غير موجودة"), { status: 404 });

  const destProject = await prisma.project.findUnique({ where: { id: input.destinationProjectId }, select: { id: true } });
  if (!destProject) throw Object.assign(new Error("المشروع المستهدف غير موجود"), { status: 400 });

  const link = await prisma.projectSector.findFirst({
    where: { projectId: input.destinationProjectId, sectorId: input.destinationSectorId, active: true },
    select: { id: true },
  });
  if (!link) throw Object.assign(new Error("القطاع لا ينتمي للمشروع المستهدف أو غير نشط"), { status: 400 });

  // Prevent a no-op "transfer" to the current assignment.
  if (
    equipment.projectId === input.destinationProjectId &&
    equipment.sectorId === input.destinationSectorId
  ) {
    throw Object.assign(new Error("التخصيص المستهدف هو نفسه التخصيص الحالي"), { status: 400 });
  }

  // Prevent concurrent/duplicate pending requests for the same equipment.
  const pending = await prisma.equipmentTransferRequest.findFirst({
    where: { equipmentId: input.equipmentId, status: "PENDING" },
    select: { id: true },
  });
  if (pending) throw Object.assign(new Error("يوجد طلب نقل قيد الانتظار لهذه المعدة"), { status: 409 });

  const transferDate = new Date(input.transferDate);
  if (Number.isNaN(transferDate.getTime())) {
    throw Object.assign(new Error("تاريخ النقل غير صالح"), { status: 400 });
  }

  const created = await prisma.equipmentTransferRequest.create({
    data: {
      equipmentId: input.equipmentId,
      sourceProjectId: equipment.projectId,
      sourceSectorId: equipment.sectorId,
      destinationProjectId: input.destinationProjectId,
      destinationSectorId: input.destinationSectorId,
      transferDate,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      requestedBy: userId,
      status: "PENDING",
      sourceSystem: "EFMS",
    },
  });

  await logAudit(userId, "EquipmentTransferRequest", created.id, "CREATE", {
    equipmentId: input.equipmentId,
    from: { projectId: equipment.projectId, sectorId: equipment.sectorId },
    to: { projectId: input.destinationProjectId, sectorId: input.destinationSectorId },
  });

  return created;
}

export async function listTransferRequests(params: { equipmentId?: number; status?: string; page?: number; pageSize?: number }) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const where: any = {};
  if (params.equipmentId) where.equipmentId = params.equipmentId;
  if (params.status) where.status = params.status as any;

  const [total, rows] = await Promise.all([
    prisma.equipmentTransferRequest.count({ where }),
    prisma.equipmentTransferRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        equipment: { select: { id: true, code: true, name: true } },
        sourceProject: { select: { id: true, name: true } },
        sourceSector: { select: { id: true, name: true } },
        destinationProject: { select: { id: true, name: true } },
        destinationSector: { select: { id: true, name: true } },
        requester: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { data: rows, total, page, pageSize };
}

export async function getTransferRequest(id: number) {
  const row = await prisma.equipmentTransferRequest.findUnique({
    where: { id },
    include: {
      equipment: { select: { id: true, code: true, name: true } },
      sourceProject: { select: { id: true, name: true } },
      sourceSector: { select: { id: true, name: true } },
      destinationProject: { select: { id: true, name: true } },
      destinationSector: { select: { id: true, name: true } },
      requester: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
    },
  });
  if (!row) throw Object.assign(new Error("طلب النقل غير موجود"), { status: 404 });
  return row;
}

export async function cancelTransferRequest(id: number, userId: number, isAdmin: boolean) {
  const row = await prisma.equipmentTransferRequest.findUnique({ where: { id }, select: { id: true, status: true, requestedBy: true } });
  if (!row) throw Object.assign(new Error("طلب النقل غير موجود"), { status: 404 });
  if (row.status !== "PENDING") throw Object.assign(new Error("لا يمكن إلغاء طلب غير قيد الانتظار"), { status: 400 });
  if (!isAdmin && row.requestedBy !== userId) throw Object.assign(new Error("غير مصرح"), { status: 403 });
  const updated = await prisma.equipmentTransferRequest.update({
    where: { id },
    data: { status: "CANCELLED", reviewedBy: userId, reviewedAt: new Date() },
  });
  await logAudit(userId, "EquipmentTransferRequest", id, "UPDATE", { action: "CANCEL" });
  return updated;
}

export async function reviewTransferRequest(id: number, status: "COMPLETED" | "REJECTED", userId: number, notes?: string | null) {
  const row = await prisma.equipmentTransferRequest.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!row) throw Object.assign(new Error("طلب النقل غير موجود"), { status: 404 });
  if (row.status !== "PENDING") throw Object.assign(new Error("الطلب ليس قيد الانتظار"), { status: 400 });
  const updated = await prisma.equipmentTransferRequest.update({
    where: { id },
    data: { status, reviewedBy: userId, reviewedAt: new Date(), ...(notes ? { notes } : {}) },
  });
  await logAudit(userId, "EquipmentTransferRequest", id, "UPDATE", { action: status, notes });
  return updated;
}
