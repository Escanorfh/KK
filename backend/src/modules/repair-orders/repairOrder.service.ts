import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { scopeOr } from "../../utils/scope";
import type { Prisma, RepairOrderStatus } from "@prisma/client";
import {
  ManagersApiError,
  createRepairOrder,
  deleteRepairOrder,
  getRepairOrder,
  managersDate,
  matchManagersProject,
  repairOrderStatusLabel,
  updateRepairOrder,
  type ManagersProject,
} from "../../utils/managers";

const equipmentInclude = {
  equipment: {
    select: {
      id: true,
      code: true,
      name: true,
      project: { select: { id: true, name: true, code: true } },
      sector: { select: { id: true, name: true } },
    },
  },
  project: { select: { id: true, name: true } },
  sector: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

const recordInclude = {
  ...equipmentInclude,
  parts: { orderBy: { id: "asc" as const } },
  events: { include: { user: { select: { id: true, name: true } } }, orderBy: { id: "asc" as const } },
} as const;

const listSelect = {
  id: true,
  requestNo: true,
  type: true,
  projectId: true,
  sectorId: true,
  equipmentId: true,
  entryDate: true,
  exitDate: true,
  hours: true,
  km: true,
  workshop: true,
  faultDescription: true,
  actionTaken: true,
  itemName: true,
  partModel: true,
  itemCode: true,
  technicalCode: true,
  quantity: true,
  unit: true,
  itemCondition: true,
  siteName: true,
  requesterName: true,
  sourceWarehouseId: true,
  destinationWarehouseId: true,
  technicianPhone: true,
  imageUrl: true,
  estimatedCost: true,
  actualCost: true,
  notes: true,
  status: true,
  sentAt: true,
  sendError: true,
  managersRef: true,
  managersId: true,
  managersStatus: true,
  managersSyncedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  ...equipmentInclude,
} as const;

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function isoDate(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : null;
}

const REQUEST_NO_SEQUENCE = "RepairOrder_requestNo_seq";

async function nextRequestNo(): Promise<number> {
  const [{ present }] = await prisma.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT to_regclass('"${REQUEST_NO_SEQUENCE}"') IS NOT NULL AS present`
  );

  if (!present) {
    const max = await prisma.repairOrder.aggregate({ _max: { requestNo: true } });
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${REQUEST_NO_SEQUENCE}"`);
    await prisma.$queryRawUnsafe(
      `SELECT setval('"${REQUEST_NO_SEQUENCE}"', $1, true)`,
      Math.max(max._max.requestNo ?? 100000, 100000)
    );
  }

  const rows = await prisma.$queryRawUnsafe<{ value: number }[]>(
    `SELECT nextval('"${REQUEST_NO_SEQUENCE}"')::int AS value`
  );
  return rows[0].value;
}

function decorate<T extends { managersStatus: string | null }>(record: T) {
  return { ...record, managersStatusLabel: repairOrderStatusLabel(record.managersStatus) };
}

type RepairPartRecord = {
  name: string;
  code: string | null;
  qty: number | null;
  notes: string | null;
};

type RepairItemFields = {
  itemName: string | null;
  partModel: string | null;
  itemCode: string | null;
  technicalCode: string | null;
  quantity: number;
  unit: string;
  itemCondition: string;
  siteName: string | null;
  requesterName: string | null;
  sourceWarehouseId: number | null;
  destinationWarehouseId: number | null;
  technicianPhone: string | null;
  imageUrl: string | null;
  imageBase64: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  notes: string | null;
};

type RepairForManagers = RepairItemFields & {
  requestNo: number;
  type: string;
  entryDate: Date | null;
  exitDate: Date | null;
  hours: number | null;
  km: number | null;
  workshop: string | null;
  faultDescription: string;
  actionTaken: string | null;
  project: { id: number; name: string } | null;
  sector: { name: string } | null;
  equipment: {
    code: string;
    name: string;
    project: { id: number; name: string } | null;
    sector: { name: string } | null;
  };
  parts: RepairPartRecord[];
  createdBy: { name: string } | null;
};

function buildRepairNotes(record: {
  requestNo: number;
  type: string;
  entryDate: Date | null;
  exitDate: Date | null;
  hours: number | null;
  km: number | null;
  notes?: string | null;
  parts: RepairPartRecord[];
}) {
  const lines: string[] = [];
  if (record.notes?.trim()) lines.push(record.notes.trim());
  lines.push(`أمر إصلاح EFMS رقم ${record.requestNo}`);
  if (record.type === "EXTERNAL") lines.push("نوع العمل: خارجي");
  if (record.entryDate) lines.push(`تاريخ الدخول: ${isoDate(record.entryDate)}`);
  if (record.exitDate) lines.push(`تاريخ الخروج: ${isoDate(record.exitDate)}`);
  if (record.hours != null) lines.push(`ساعات التشغيل: ${record.hours}`);
  if (record.km != null) lines.push(`قراءة الكيلومترات: ${record.km}`);

  if (record.parts.length > 1) {
    lines.push("قطع مطلوبة:");
    record.parts.forEach((part, index) => {
      const details = [
        part.code ? `كود ${part.code}` : null,
        part.qty != null ? `كمية ${part.qty}` : null,
        part.notes ?? null,
      ].filter(Boolean);
      lines.push(`${index + 1}) ${part.name}${details.length ? ` — ${details.join(" — ")}` : ""}`);
    });
  } else if (record.parts[0]?.notes) {
    lines.push(`ملاحظات القطعة: ${record.parts[0].notes}`);
  }

  return lines.join("\n");
}

function repairItem(record: {
  itemName?: string | null;
  itemCode?: string | null;
  quantity?: number | null;
  equipment: { name: string };
  parts: RepairPartRecord[];
}) {
  const firstPart = record.parts[0] ?? null;
  return {
    name: record.itemName?.trim() || firstPart?.name?.trim() || record.equipment.name,
    code: record.itemCode?.trim() || firstPart?.code || null,
    quantity:
      record.quantity != null
        ? Math.max(1, Math.round(record.quantity))
        : Math.max(1, Math.round(firstPart?.qty ?? 1)),
  };
}

function buildCreatePayload(record: RepairForManagers, remoteProject: ManagersProject | null) {
  const item = repairItem(record);
  const localProject = record.project ?? record.equipment.project;
  const siteName = record.siteName?.trim() || record.sector?.name || null;
  const requesterName = record.requesterName?.trim() || record.createdBy?.name || null;
  const technicalCode = record.technicalCode?.trim() || record.equipment.code;

  return {
    item_name: item.name,
    ...(record.partModel?.trim() ? { part_model: record.partModel.trim() } : {}),
    ...(item.code ? { item_code: item.code } : {}),
    equipment_code: record.equipment.code,
    equipment_model: record.equipment.name,
    ...(technicalCode ? { technical_code: technicalCode } : {}),
    quantity: item.quantity,
    unit: record.unit?.trim() || "عدد",
    item_condition: record.itemCondition || "عاطلة",
    ...(remoteProject ? { project_id: remoteProject.id } : {}),
    ...(localProject ? { project_name: localProject.name } : {}),
    ...(siteName ? { site_name: siteName } : {}),
    ...(requesterName ? { requester_name: requesterName } : {}),
    ...(record.sourceWarehouseId != null ? { source_warehouse_id: record.sourceWarehouseId } : {}),
    ...(record.destinationWarehouseId != null ? { destination_warehouse_id: record.destinationWarehouseId } : {}),
    ...(record.workshop?.trim() ? { workshop_name: record.workshop.trim() } : {}),
    ...(record.technicianPhone?.trim() ? { technician_phone: record.technicianPhone.trim() } : {}),
    problem_description: record.faultDescription,
    ...(record.actionTaken ? { action_taken: record.actionTaken } : {}),
    ...(record.imageUrl?.trim() ? { image_url: record.imageUrl.trim() } : {}),
    ...(record.imageBase64 ? { image_base64: record.imageBase64 } : {}),
    ...(record.estimatedCost != null ? { estimated_cost: record.estimatedCost } : {}),
    ...(record.actualCost != null ? { actual_cost: record.actualCost } : {}),
    sent_date: managersDate(new Date()),
    ...(record.entryDate ? { delivery_date: managersDate(record.entryDate) } : {}),
    ...(record.exitDate ? { completion_date: managersDate(record.exitDate) } : {}),
    notes: buildRepairNotes(record),
  };
}

export async function create(
  data: {
    type: "INTERNAL" | "EXTERNAL";
    equipmentId: number;
    projectId?: number | null;
    sectorId?: number | null;
    entryDate?: string | null;
    exitDate?: string | null;
    hours?: number | null;
    km?: number | null;
    workshop?: string | null;
    faultDescription: string;
    actionTaken?: string | null;
    itemName: string;
    partModel?: string | null;
    itemCode?: string | null;
    technicalCode?: string | null;
    quantity?: number | null;
    unit?: string | null;
    itemCondition?: string | null;
    siteName?: string | null;
    requesterName?: string | null;
    sourceWarehouseId?: number | null;
    destinationWarehouseId?: number | null;
    technicianPhone?: string | null;
    imageUrl?: string | null;
    imageBase64?: string | null;
    estimatedCost?: number | null;
    actualCost?: number | null;
    notes?: string | null;
    parts?: { name: string; code?: string | null; qty?: number | null; notes?: string | null }[];
  },
  userId: number
) {
  const equipment = await prisma.equipment.findUnique({
    where: { id: data.equipmentId },
    select: { id: true, projectId: true, sectorId: true, sector: { select: { name: true } } },
  });
  if (!equipment) fail("المعدة غير موجودة", 404);

  const requestNo = await nextRequestNo();

  const record = await prisma.repairOrder.create({
    data: {
      requestNo,
      type: data.type,
      equipmentId: data.equipmentId,
      projectId: data.projectId ?? equipment.projectId,
      sectorId: data.sectorId ?? equipment.sectorId,
      entryDate: data.entryDate ? new Date(data.entryDate) : null,
      exitDate: data.exitDate ? new Date(data.exitDate) : null,
      hours: data.hours ?? null,
      km: data.km ?? null,
      workshop: data.workshop ?? null,
      faultDescription: data.faultDescription,
      actionTaken: data.actionTaken ?? null,
      itemName: data.itemName,
      partModel: data.partModel ?? null,
      itemCode: data.itemCode ?? null,
      technicalCode: data.technicalCode ?? null,
      quantity: data.quantity ?? 1,
      unit: data.unit ?? "عدد",
      itemCondition: data.itemCondition ?? "عاطلة",
      siteName: data.siteName ?? equipment.sector?.name ?? null,
      requesterName: data.requesterName ?? null,
      sourceWarehouseId: data.sourceWarehouseId ?? null,
      destinationWarehouseId: data.destinationWarehouseId ?? null,
      technicianPhone: data.technicianPhone ?? null,
      imageUrl: data.imageUrl ?? null,
      imageBase64: data.imageBase64 ?? null,
      estimatedCost: data.estimatedCost ?? null,
      actualCost: data.actualCost ?? null,
      notes: data.notes ?? null,
      createdById: userId,
      parts: data.parts?.length
        ? { create: data.parts.map((p) => ({ name: p.name, code: p.code ?? null, qty: p.qty ?? null, notes: p.notes ?? null })) }
        : undefined,
      events: { create: { status: "PENDING", userId, note: "إنشاء الطلب وإرساله للمدير" } },
    },
    include: recordInclude,
  });

  await logAudit(userId, "RepairOrder", record.id, "CREATE", { requestNo, equipmentId: data.equipmentId });
  return { record: decorate(record) };
}

export async function list(params: {
  q?: string;
  status?: RepairOrderStatus;
  projectId?: number;
  equipmentId?: number;
  type?: "INTERNAL" | "EXTERNAL";
  scope?: number[] | null;
  page: number;
  pageSize: number;
}) {
  const own = scopeOr(params.scope);
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.type ? { type: params.type } : {}),
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.equipmentId ? { equipmentId: params.equipmentId } : {}),
    ...(params.q
      ? {
          OR: [
            { equipment: { code: { contains: params.q, mode: "insensitive" as const } } },
            { equipment: { name: { contains: params.q, mode: "insensitive" as const } } },
            { faultDescription: { contains: params.q, mode: "insensitive" as const } },
            { itemName: { contains: params.q, mode: "insensitive" as const } },
            { partModel: { contains: params.q, mode: "insensitive" as const } },
            { itemCode: { contains: params.q, mode: "insensitive" as const } },
            { technicalCode: { contains: params.q, mode: "insensitive" as const } },
            { workshop: { contains: params.q, mode: "insensitive" as const } },
            { managersRef: { contains: params.q, mode: "insensitive" as const } },
            ...(Number.isInteger(Number(params.q)) ? [{ requestNo: Number(params.q) }] : []),
          ],
        }
      : {}),
    ...(own
      ? {
          AND: [{ OR: [...own, { equipment: { OR: own } }] }],
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.repairOrder.count({ where }),
    prisma.repairOrder.findMany({
      where,
      select: listSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return { data: data.map((record) => decorate(record)), total, page: params.page, pageSize: params.pageSize };
}

export async function get(id: number) {
  const record = await prisma.repairOrder.findUnique({ where: { id }, include: recordInclude });
  if (!record) fail("طلب الإصلاح غير موجود", 404);
  return { record: decorate(record) };
}

export async function update(
  id: number,
  data: {
    type?: "INTERNAL" | "EXTERNAL";
    equipmentId?: number;
    projectId?: number | null;
    sectorId?: number | null;
    entryDate?: string | null;
    exitDate?: string | null;
    hours?: number | null;
    km?: number | null;
    workshop?: string | null;
    faultDescription?: string;
    actionTaken?: string | null;
    itemName?: string;
    partModel?: string | null;
    itemCode?: string | null;
    technicalCode?: string | null;
    quantity?: number | null;
    unit?: string | null;
    itemCondition?: string | null;
    siteName?: string | null;
    requesterName?: string | null;
    sourceWarehouseId?: number | null;
    destinationWarehouseId?: number | null;
    technicianPhone?: string | null;
    imageUrl?: string | null;
    imageBase64?: string | null;
    estimatedCost?: number | null;
    actualCost?: number | null;
    notes?: string | null;
    parts?: { name: string; code?: string | null; qty?: number | null; notes?: string | null }[];
  },
  userId: number
) {
  const existing = await prisma.repairOrder.findUnique({ where: { id }, include: recordInclude });
  if (!existing) fail("طلب الإصلاح غير موجود", 404);
  if (existing.status !== "PENDING") fail("لا يمكن تعديل الطلب بعد تجاوز مرحلة الانتظار", 409);

  if (existing.managersId && data.projectId !== undefined && data.projectId !== existing.projectId) {
    fail("لا يمكن تغيير المشروع بعد ربط الطلب بنظام المدرين", 409);
  }

  let nextEquipment: { code: string; name: string } = existing.equipment;
  if (data.equipmentId !== undefined && data.equipmentId !== existing.equipmentId) {
    if (existing.managersId) {
      fail("لا يمكن تغيير المعدة بعد ربط الطلب بنظام المدرين", 409);
    }
    const equipment = await prisma.equipment.findUnique({
      where: { id: data.equipmentId },
      select: { code: true, name: true },
    });
    if (!equipment) fail("المعدة غير موجودة", 404);
    nextEquipment = equipment;
  }

  const nextParts: RepairPartRecord[] = data.parts
    ? data.parts.map((p) => ({ name: p.name, code: p.code ?? null, qty: p.qty ?? null, notes: p.notes ?? null }))
    : existing.parts;
  const nextFault = data.faultDescription ?? existing.faultDescription;
  const nextAction = data.actionTaken !== undefined ? data.actionTaken : existing.actionTaken;
  const nextWorkshop = data.workshop !== undefined ? data.workshop : existing.workshop;
  const nextEntryDate = data.entryDate !== undefined ? (data.entryDate ? new Date(data.entryDate) : null) : existing.entryDate;
  const nextExitDate = data.exitDate !== undefined ? (data.exitDate ? new Date(data.exitDate) : null) : existing.exitDate;
  const nextHours = data.hours !== undefined ? data.hours : existing.hours;
  const nextKm = data.km !== undefined ? data.km : existing.km;
  const nextItemName = data.itemName !== undefined ? data.itemName : existing.itemName;
  const nextPartModel = data.partModel !== undefined ? data.partModel : existing.partModel;
  const nextItemCode = data.itemCode !== undefined ? data.itemCode : existing.itemCode;
  const nextQuantity = data.quantity !== undefined ? (data.quantity ?? 1) : existing.quantity;
  const nextItemCondition =
    data.itemCondition !== undefined ? (data.itemCondition ?? "عاطلة") : existing.itemCondition;
  const nextTechnicianPhone = data.technicianPhone !== undefined ? data.technicianPhone : existing.technicianPhone;
  const nextImageUrl = data.imageUrl !== undefined ? data.imageUrl : existing.imageUrl;
  const nextImageBase64 = data.imageBase64 !== undefined ? data.imageBase64 : existing.imageBase64;
  const nextActualCost = data.actualCost !== undefined ? data.actualCost : existing.actualCost;
  const nextNotes = data.notes !== undefined ? data.notes : existing.notes;

  if (existing.managersId) {
    const nextItem = repairItem({
      itemName: nextItemName,
      itemCode: nextItemCode,
      quantity: nextQuantity,
      equipment: nextEquipment,
      parts: nextParts,
    });
    const nextExit = managersDate(nextExitDate);
    await updateRepairOrder(existing.managersId, {
      item_name: nextItem.name,
      ...(nextPartModel?.trim() ? { part_model: nextPartModel.trim() } : {}),
      equipment_code: nextEquipment.code,
      item_condition: nextItemCondition,
      ...(nextWorkshop?.trim() ? { workshop_name: nextWorkshop.trim() } : {}),
      ...(nextTechnicianPhone?.trim() ? { technician_phone: nextTechnicianPhone.trim() } : {}),
      problem_description: nextFault,
      ...(nextAction ? { action_taken: nextAction } : {}),
      ...(nextActualCost != null ? { actual_cost: nextActualCost } : {}),
      ...(nextImageUrl?.trim() ? { image_url: nextImageUrl.trim() } : {}),
      ...(nextImageBase64 ? { image_base64: nextImageBase64 } : {}),
      ...(nextExit ? { completion_date: nextExit } : {}),
      notes: buildRepairNotes({
        requestNo: existing.requestNo,
        type: data.type ?? existing.type,
        entryDate: nextEntryDate,
        exitDate: nextExitDate,
        hours: nextHours,
        km: nextKm,
        notes: nextNotes,
        parts: nextParts,
      }),
    });
  }

  const { parts, ...rest } = data;
  const record = await prisma.repairOrder.update({
    where: { id },
    data: {
      ...rest,
      ...(rest.quantity !== undefined && { quantity: rest.quantity ?? 1 }),
      ...(rest.unit !== undefined && { unit: rest.unit ?? "عدد" }),
      ...(rest.itemCondition !== undefined && { itemCondition: rest.itemCondition ?? "عاطلة" }),
      ...(rest.entryDate !== undefined && { entryDate: rest.entryDate ? new Date(rest.entryDate) : null }),
      ...(rest.exitDate !== undefined && { exitDate: rest.exitDate ? new Date(rest.exitDate) : null }),
      ...(parts !== undefined
        ? {
            parts: {
              deleteMany: {},
              create: parts.map((p) => ({ name: p.name, code: p.code ?? null, qty: p.qty ?? null, notes: p.notes ?? null })),
            },
          }
        : {}),
      ...(existing.managersId ? { managersSyncedAt: new Date() } : {}),
    } as Prisma.RepairOrderUncheckedUpdateInput,
    include: recordInclude,
  });

  await logAudit(userId, "RepairOrder", id, "UPDATE", {
    requestNo: record.requestNo,
    ...(existing.managersId ? { managersId: existing.managersId } : {}),
  });
  return { record: decorate(record) };
}

const TRANSITIONS: Record<RepairOrderStatus, RepairOrderStatus[]> = {
  PENDING: ["RECEIVED"],
  RECEIVED: ["IN_REPAIR"],
  IN_REPAIR: ["REPAIRED"],
  REPAIRED: ["LOADED"],
  LOADED: ["RETURNED"],
  RETURNED: [],
};

export async function changeStatus(id: number, status: RepairOrderStatus, note: string | null, userId: number) {
  const existing = await prisma.repairOrder.findUnique({ where: { id }, select: { id: true, status: true, requestNo: true } });
  if (!existing) fail("طلب الإصلاح غير موجود", 404);
  if (!TRANSITIONS[existing.status].includes(status)) {
    fail(`لا يمكن الانتقال من «${existing.status}» إلى «${status}»`, 409);
  }

  const record = await prisma.repairOrder.update({
    where: { id },
    data: {
      status,
      events: { create: { status, userId, note } },
    },
    include: recordInclude,
  });

  await logAudit(userId, "RepairOrder", id, "UPDATE", { requestNo: existing.requestNo, status });
  return { record: decorate(record) };
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.repairOrder.findUnique({
    where: { id },
    select: { id: true, requestNo: true, status: true, managersId: true, sentAt: true },
  });
  if (!existing) fail("طلب الإصلاح غير موجود", 404);
  if (existing.status !== "PENDING") fail("لا يمكن حذف طلب تجاوز مرحلة الانتظار", 409);
  if (!existing.managersId && existing.sentAt) {
    fail("هذا الطلب مسجل كمرسل لكنه غير مربوط بنظام المدرين — لا يمكن حذفه بأمان", 409);
  }

  let remoteResult: "deleted" | "missing" | null = null;
  if (existing.managersId) {
    remoteResult = await deleteRepairOrder(existing.managersId);
  }

  await prisma.repairOrder.delete({ where: { id } });
  await logAudit(userId, "RepairOrder", id, "DELETE", {
    requestNo: existing.requestNo,
    ...(existing.managersId ? { managersId: existing.managersId, remoteResult } : {}),
  });
  return { message: "تم حذف طلب الإصلاح" };
}

export async function send(id: number, userId: number) {
  const existing = await prisma.repairOrder.findUnique({ where: { id }, include: recordInclude });
  if (!existing) fail("طلب الإصلاح غير موجود", 404);
  if (existing.managersId || existing.sentAt) fail("تم إرسال هذا الطلب لنظام المدرين بالفعل", 409);

  let remoteCreated: { id: number; number: string | null } | null = null;

  try {
    const localProject = existing.project ?? existing.equipment.project;
    const match = localProject ? await matchManagersProject(localProject) : { project: null };
    const payload = buildCreatePayload(existing, match.project);
    remoteCreated = await createRepairOrder(payload);

    let managersStatus: string | null = null;
    let managersRef = remoteCreated.number;
    try {
      const remote = await getRepairOrder(remoteCreated.id);
      managersStatus = remote.status || null;
      managersRef = remote.order_number || managersRef;
    } catch {
      /* الطلب اتسجل فعلًا — هنزامن الحالة لاحقًا */
    }

    const record = await prisma.repairOrder.update({
      where: { id },
      data: {
        sentAt: new Date(),
        sendError: null,
        managersId: remoteCreated.id,
        managersRef,
        managersStatus,
        managersSyncedAt: new Date(),
      },
      include: recordInclude,
    });

    await logAudit(userId, "RepairOrder", id, "UPDATE", {
      requestNo: existing.requestNo,
      action: "SEND",
      managersId: remoteCreated.id,
      managersRef,
    });

    return { record: decorate(record) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status ?? 502;

    await prisma.repairOrder.update({
      where: { id },
      data: {
        sentAt: null,
        sendError: message,
        ...(remoteCreated
          ? {
              managersId: remoteCreated.id,
              managersRef: remoteCreated.number,
            }
          : {}),
      },
    });

    await logAudit(userId, "RepairOrder", id, "UPDATE", {
      requestNo: existing.requestNo,
      action: "SEND_FAILED",
      error: message,
      ...(remoteCreated ? { managersId: remoteCreated.id } : {}),
    });

    throw Object.assign(new Error(message), { status });
  }
}

export async function sync(id: number, userId: number) {
  const existing = await prisma.repairOrder.findUnique({
    where: { id },
    select: { id: true, requestNo: true, managersId: true },
  });
  if (!existing) fail("طلب الإصلاح غير موجود", 404);
  if (!existing.managersId) fail("لم يتم ربط هذا الطلب بنظام المدرين بعد", 409);

  let remote;
  try {
    remote = await getRepairOrder(existing.managersId);
  } catch (err) {
    if (err instanceof ManagersApiError && err.upstreamStatus === 404) {
      fail("أمر الإصلاح غير موجود في نظام المدرين — ربما تم حذفه هناك", 404);
    }
    throw err;
  }

  const record = await prisma.repairOrder.update({
    where: { id },
    data: {
      managersStatus: remote.status || null,
      managersRef: remote.order_number || null,
      managersSyncedAt: new Date(),
    },
    include: recordInclude,
  });

  await logAudit(userId, "RepairOrder", id, "UPDATE", {
    requestNo: existing.requestNo,
    action: "SYNC",
    managersStatus: remote.status,
  });

  return { record: decorate(record) };
}

export const statusLabels: Record<RepairOrderStatus, string> = {
  PENDING: "بانتظار المدير",
  RECEIVED: "تم الاستلام",
  IN_REPAIR: "قيد الإصلاح",
  REPAIRED: "تم الإصلاح",
  LOADED: "تم التحميل",
  RETURNED: "تم الاستلام بالموقع",
};

export { isoDate };
