import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { scopeOr } from "../../utils/scope";
import type { NeedRequestStatus } from "@prisma/client";
import {
  ManagersApiError,
  assertSectorSendable,
  createRequisition,
  deleteRequisition,
  getRequisition,
  managersDate,
  mapRequisitionDepartment,
  resolveAuthorizedRoom,
  resolveManagersProject,
  requisitionStatusLabel,
  updateRequisition,
  type ManagersProject,
  type ManagersRoom,
} from "../../utils/managers";

const recordInclude = {
  items: { orderBy: { rowNo: "asc" as const } },
  createdBy: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, code: true } },
  sector: {
    select: { id: true, name: true, managersRoomId: true, managersRoomTitle: true, projectId: true },
  },
} as const;

type NeedItemInput = {
  itemName: string;
  itemCode?: string | null;
  unit?: string | null;
  qty?: number | null;
  equipmentRef?: string | null;
  currentBalance?: number | null;
  localSupply?: number | null;
  foreignSupply?: number | null;
  notes?: string | null;
};

type NeedItemRecord = {
  rowNo: number;
  itemName: string;
  itemCode: string | null;
  unit: string | null;
  qty: number;
  equipmentRef: string | null;
  currentBalance: number | null;
  localSupply: number | null;
  foreignSupply: number | null;
  notes: string | null;
};

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export function formatNo(requestNo: number) {
  return String(requestNo).padStart(7, "0");
}

function isoDate(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : null;
}

function decorate<T extends { requestNo: number; managersStatus: string | null }>(record: T) {
  return {
    ...record,
    requestNoText: formatNo(record.requestNo),
    managersStatusLabel: requisitionStatusLabel(record.managersStatus),
  };
}

async function assertProject(projectId: number) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) fail("المشروع غير موجود", 404);
  return project;
}

// التحقق من القطاع وعلاقته بالمشروع المختار — في السيرفر مش الواجهة فقط
async function assertSector(sectorId: number, projectId: number | null | undefined) {
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true, name: true, projectId: true },
  });
  if (!sector) fail("القطاع غير موجود", 404);
  if (projectId == null) fail(`القطاع «${sector.name}» يحتاج مشروعًا محددًا أولًا`, 422);
  if (sector.projectId !== projectId) {
    fail(`القطاع «${sector.name}» لا يتبع المشروع المحدد — اختر قطاعًا من قطاعات المشروع`, 422);
  }
  return sector;
}

export async function create(
  data: {
    projectId?: number | null;
    sectorId?: number | null;
    department: string;
    requestDate: string;
    items: NeedItemInput[];
  },
  userId: number
) {
  if (data.projectId != null) await assertProject(data.projectId);
  if (data.sectorId != null) await assertSector(data.sectorId, data.projectId ?? null);

  const max = await prisma.needRequest.aggregate({ _max: { requestNo: true } });
  const requestNo = (max._max.requestNo ?? 0) + 1;

  const record = await prisma.needRequest.create({
    data: {
      requestNo,
      projectId: data.projectId ?? null,
      sectorId: data.sectorId ?? null,
      department: data.department,
      requestDate: new Date(data.requestDate),
      createdById: userId,
      items: {
        create: data.items.map((it, i) => ({
          rowNo: i + 1,
          itemName: it.itemName,
          itemCode: it.itemCode ?? null,
          unit: it.unit ?? null,
          qty: it.qty ?? 0,
          equipmentRef: it.equipmentRef ?? null,
          currentBalance: it.currentBalance ?? null,
          localSupply: it.localSupply ?? null,
          foreignSupply: it.foreignSupply ?? null,
          notes: it.notes ?? null,
        })),
      },
    },
    include: recordInclude,
  });

  await logAudit(userId, "NeedRequest", record.id, "CREATE", {
    requestNo,
    department: data.department,
    projectId: data.projectId ?? null,
    sectorId: data.sectorId ?? null,
  });
  return { record: decorate(record) };
}

export async function list(params: {
  q?: string;
  status?: NeedRequestStatus;
  projectId?: number;
  page: number;
  pageSize: number;
  scope?: number[] | null;
}) {
  const digits = params.q && /^\d+$/.test(params.q) ? Number(params.q) : null;
  const own = scopeOr(params.scope);
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.q
      ? {
          OR: [
            { department: { contains: params.q, mode: "insensitive" as const } },
            { project: { name: { contains: params.q, mode: "insensitive" as const } } },
            { items: { some: { itemName: { contains: params.q, mode: "insensitive" as const } } } },
            ...(digits !== null ? [{ requestNo: digits }] : []),
          ],
        }
      : {}),
    ...(own ? { AND: [{ OR: own }] } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.needRequest.count({ where }),
    prisma.needRequest.findMany({
      where,
      include: { ...recordInclude, _count: { select: { items: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return {
    data: data.map((r) => decorate(r)),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function get(id: number) {
  const record = await prisma.needRequest.findUnique({ where: { id }, include: recordInclude });
  if (!record) fail("طلب الاحتياج غير موجود", 404);
  return { record: decorate(record) };
}

function buildRemoteItems(items: NeedItemRecord[]) {
  return items.map((it) => {
    const requestedQuantity = Math.round(it.qty);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      fail(`الكمية في السطر ${it.rowNo} يجب أن تكون رقمًا أكبر من صفر`, 422);
    }
    return {
      item_name_model: it.itemName,
      ...(it.itemCode ? { item_code: it.itemCode } : {}),
      unit: it.unit?.trim() || "عدد",
      requested_quantity: requestedQuantity,
      ...(it.equipmentRef ? { equipment_code_name: it.equipmentRef } : {}),
      current_balance: Math.max(0, Math.round(it.currentBalance ?? 0)),
      local_supply: (it.localSupply ?? 0) > 0 ? 1 : 0,
      external_supply: (it.foreignSupply ?? 0) > 0 ? 1 : 0,
      ...(it.notes ? { notes: it.notes } : {}),
    };
  });
}

function buildRemoteNotes(record: { requestNo: number; department: string }) {
  return `طلب احتياج EFMS رقم ${formatNo(record.requestNo)} — الجهة: ${record.department}`;
}

export function buildCreatePayload(
  record: {
    requestNo: number;
    department: string;
    requestDate: Date;
    createdBy?: { name: string } | null;
    items: NeedItemRecord[];
  },
  remoteProject: ManagersProject,
  room: ManagersRoom
) {
  const department = mapRequisitionDepartment(record.department);
  const date = managersDate(record.requestDate);
  return {
    project_id: remoteProject.id,
    // اسم الحقل وقيمتهما من مواصفات المدرين: RequisitionCreateInput.room_id = معرّف قطاع النظام
    room_id: room.id,
    department,
    notes: buildRemoteNotes(record),
    header: {
      ...(record.createdBy?.name ? { requester_name: record.createdBy.name } : {}),
      requesting_entity: record.department,
      department,
      ...(date ? { date } : {}),
    },
    items: buildRemoteItems(record.items),
  };
}

function buildUpdatePayload(record: {
  requestNo: number;
  department: string;
  items: NeedItemRecord[];
}) {
  return {
    department: mapRequisitionDepartment(record.department),
    notes: buildRemoteNotes(record),
    items: buildRemoteItems(record.items),
  };
}

async function refreshRemoteStatus(
  managersId: number,
  fallbackRef: string | null = null
): Promise<{ managersStatus?: string | null; managersRef?: string | null; managersSyncedAt: Date }> {
  try {
    const remote = await getRequisition(managersId);
    return {
      managersStatus: remote.status || null,
      managersRef: remote.requisition_number || fallbackRef,
      managersSyncedAt: new Date(),
    };
  } catch {
    return { managersSyncedAt: new Date() };
  }
}

export async function update(
  id: number,
  data: {
    projectId?: number | null;
    sectorId?: number | null;
    department?: string;
    requestDate?: string;
    items?: NeedItemInput[];
  },
  userId: number
) {
  const existing = await prisma.needRequest.findUnique({
    where: { id },
    include: { ...recordInclude, createdBy: { select: { name: true } } },
  });
  if (!existing) fail("طلب الاحتياج غير موجود", 404);
  if (!existing.managersId && existing.status === "SENT") {
    fail("هذا الطلب مسجل كمرسل لكنه غير مربوط بنظام المدرين — أعد إرساله أولًا", 409);
  }

  const nextProjectId = data.projectId !== undefined ? data.projectId : existing.projectId;
  let nextProject = existing.project;

  if (nextProjectId !== existing.projectId) {
    if (existing.managersId) fail("لا يمكن تغيير المشروع بعد ربط الطلب بنظام المدرين", 409);
    nextProject = nextProjectId != null ? await assertProject(nextProjectId) : null;
  }

  // القطاع الصريح غير التابع للمشروع يُرفض؛ أما القطاع القديم فيلغى نفسه لما المشروع يتغيّر من غيره
  const sectorProvided = data.sectorId !== undefined;
  let nextSectorId = sectorProvided ? data.sectorId : existing.sectorId;
  let sectorCleared = false;

  if (nextSectorId != null) {
    if (sectorProvided) {
      if (existing.managersId && nextSectorId !== existing.sectorId) {
        fail("لا يمكن تغيير القطاع بعد ربط الطلب بنظام المدرين — نظام المدرين بيقبل القطاع عند الإنشاء فقط", 409);
      }
      await assertSector(nextSectorId, nextProjectId);
    } else if (existing.sector?.projectId !== nextProjectId) {
      nextSectorId = null;
      sectorCleared = true;
    }
  }

  const nextItems: NeedItemRecord[] = data.items
    ? data.items.map((it, i) => ({
        rowNo: i + 1,
        itemName: it.itemName,
        itemCode: it.itemCode ?? null,
        unit: it.unit ?? null,
        qty: it.qty ?? 0,
        equipmentRef: it.equipmentRef ?? null,
        currentBalance: it.currentBalance ?? null,
        localSupply: it.localSupply ?? null,
        foreignSupply: it.foreignSupply ?? null,
        notes: it.notes ?? null,
      }))
    : existing.items;

  const nextDepartment = data.department ?? existing.department;
  const nextDate = data.requestDate ? new Date(data.requestDate) : existing.requestDate;

  let syncData: {
    managersStatus?: string | null;
    managersRef?: string | null;
    managersSyncedAt?: Date;
  } = {};

  if (existing.managersId) {
    if (!nextProject) fail("الطلب مربوط بنظام المدرين لكن بدون مشروع — أضف المشروع أولًا", 422);
    const payload = buildUpdatePayload({
      requestNo: existing.requestNo,
      department: nextDepartment,
      items: nextItems,
    });
    await updateRequisition(existing.managersId, payload);
    syncData = await refreshRemoteStatus(existing.managersId, existing.managersRef);
  }

  const record = await prisma.needRequest.update({
    where: { id },
    data: {
      ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
      ...(sectorProvided || sectorCleared ? { sectorId: nextSectorId } : {}),
      department: nextDepartment,
      requestDate: nextDate,
      ...(data.items !== undefined
        ? {
            items: {
              deleteMany: {},
              create: nextItems.map((it) => ({
                rowNo: it.rowNo,
                itemName: it.itemName,
                itemCode: it.itemCode,
                unit: it.unit,
                qty: it.qty,
                equipmentRef: it.equipmentRef,
                currentBalance: it.currentBalance,
                localSupply: it.localSupply,
                foreignSupply: it.foreignSupply,
                notes: it.notes,
              })),
            },
          }
        : {}),
      ...(!existing.managersId && existing.status === "FAILED" ? { status: "DRAFT", sendError: null } : {}),
      ...syncData,
    },
    include: recordInclude,
  });

  await logAudit(userId, "NeedRequest", id, "UPDATE", {
    requestNo: existing.requestNo,
    ...(existing.managersId ? { managersId: existing.managersId } : {}),
  });
  return { record: decorate(record) };
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.needRequest.findUnique({
    where: { id },
    select: { id: true, requestNo: true, status: true, managersId: true },
  });
  if (!existing) fail("طلب الاحتياج غير موجود", 404);
  if (!existing.managersId && existing.status === "SENT") {
    fail("هذا الطلب مسجل كمرسل لكنه غير مربوط بنظام المدرين — لا يمكن حذفه بأمان", 409);
  }

  let remoteResult: "deleted" | "missing" | null = null;
  if (existing.managersId) {
    remoteResult = await deleteRequisition(existing.managersId);
  }

  await prisma.needRequest.delete({ where: { id } });
  await logAudit(userId, "NeedRequest", id, "DELETE", {
    requestNo: existing.requestNo,
    ...(existing.managersId ? { managersId: existing.managersId, remoteResult } : {}),
  });
  return { message: "تم حذف طلب الاحتياج" };
}

export async function send(id: number, userId: number) {
  const existing = await prisma.needRequest.findUnique({
    where: { id },
    include: { ...recordInclude, createdBy: { select: { name: true } } },
  });
  if (!existing) fail("طلب الاحتياج غير موجود", 404);
  if (existing.managersId || existing.status === "SENT") {
    fail("تم إرسال هذا الطلب لنظام المدرين بالفعل", 409);
  }
  if (!existing.project) {
    fail("اختر المشروع قبل إرسال الطلب لنظام المدرين", 422);
  }
  // محلي فقط: بلا قطاع أو بلا ربط خارجي — تمنع الإرسال برسالة مفهومة بدل 403 من المدرين
  const sector = assertSectorSendable(existing.sector);

  let remoteCreated: { id: number; number: string | null } | null = null;

  try {
    const remoteProject = await resolveManagersProject(existing.project);
    const room = resolveAuthorizedRoom(remoteProject, sector);
    const payload = buildCreatePayload(existing, remoteProject, room);
    remoteCreated = await createRequisition(payload);

    const remote = await refreshRemoteStatus(remoteCreated.id, remoteCreated.number);

    const record = await prisma.needRequest.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        sendError: null,
        managersId: remoteCreated.id,
        managersRef: remote.managersRef ?? remoteCreated.number,
        ...remote,
      },
      include: recordInclude,
    });

    await logAudit(userId, "NeedRequest", id, "UPDATE", {
      requestNo: existing.requestNo,
      managersId: remoteCreated.id,
      managersRef: remoteCreated.number,
      action: "SEND",
    });

    return { record: decorate(record) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status ?? 502;

    await prisma.needRequest.update({
      where: { id },
      data: {
        status: "FAILED",
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

    await logAudit(userId, "NeedRequest", id, "UPDATE", {
      requestNo: existing.requestNo,
      action: "SEND_FAILED",
      error: message,
      ...(remoteCreated ? { managersId: remoteCreated.id } : {}),
    });

    throw Object.assign(new Error(message), { status });
  }
}

export async function sync(id: number, userId: number) {
  const existing = await prisma.needRequest.findUnique({
    where: { id },
    select: { id: true, requestNo: true, managersId: true },
  });
  if (!existing) fail("طلب الاحتياج غير موجود", 404);
  if (!existing.managersId) fail("لم يتم ربط هذا الطلب بنظام المدرين بعد", 409);

  let remote;
  try {
    remote = await getRequisition(existing.managersId);
  } catch (err) {
    if (err instanceof ManagersApiError && err.upstreamStatus === 404) {
      fail("طلب الاحتياج غير موجود في نظام المدرين — ربما تم حذفه هناك", 404);
    }
    throw err;
  }

  const record = await prisma.needRequest.update({
    where: { id },
    data: {
      managersStatus: remote.status || null,
      managersRef: remote.requisition_number || null,
      managersSyncedAt: new Date(),
    },
    include: recordInclude,
  });

  await logAudit(userId, "NeedRequest", id, "UPDATE", {
    requestNo: existing.requestNo,
    action: "SYNC",
    managersStatus: remote.status,
  });

  return { record: decorate(record) };
}

export const statusLabels: Record<NeedRequestStatus, string> = {
  DRAFT: "مسودة",
  SENT: "تم الإرسال",
  FAILED: "فشل الإرسال",
};

export { isoDate };
