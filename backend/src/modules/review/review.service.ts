import type { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { verifyAttestation, attestationMatchesSnapshot } from "../../utils/attestation";
import * as dailylogService from "../dailylogs/dailylog.service";
import * as maintenanceService from "../maintenance/maintenance.service";
import type { ReviewEntity } from "./review.schemas";

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

interface ListParams {
  entity?: ReviewEntity;
  status?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  submittedBy?: number;
  page: number;
  pageSize: number;
}

export interface ReviewInputContext {
  projectId?: number | null;
  projectCode?: string | null;
  sectorId?: number | null;
  projectName?: string | null;
  sectorName?: string | null;
  equipmentCode?: string | null;
  equipmentName?: string | null;
  contextSource?: "SNAPSHOT" | "UNKNOWN";
  capturedAt?: string;
  /** يظهر في الطلبات اللي بتتسجل وهي أوفلاين. */
  capturedOffline?: boolean;
  attestation?: string;
}

export async function createReviewRequest(
  input: {
    entity: ReviewEntity;
    data: Record<string, unknown>;
    clientRequestId?: string;
    /** معرف سجل موجود فعلًا — أوامر الإصلاح وطلبات الاحتياج. */
    recordId?: number | null;
    context?: ReviewInputContext;
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
    finalCtx = ctx as Record<string, unknown>;
    contextSource = ctx.contextSource ?? (ctx.projectId != null || ctx.sectorId != null ? "SNAPSHOT" : "UNKNOWN");
  } else if (offlineTrusted) {
    finalCtx = ctx as Record<string, unknown>;
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
      recordId: input.recordId ?? null,
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

/** السجلات اللي اتعملت فعلًا قبل المراجعة — الاعتماد بيفتح الإرسال للمديرين بس. */
const PRE_EXISTING_ENTITIES: ReviewEntity[] = ["repairorder", "needrequest"];

const EDITABLE_REPAIR_FIELDS = [
  "entryDate", "exitDate", "hours", "km", "workshop", "faultDescription", "actionTaken",
  "itemName", "partModel", "itemCode", "technicalCode", "quantity", "unit", "itemCondition",
  "siteName", "requesterName", "technicianPhone", "estimatedCost", "actualCost", "notes",
] as const;
const EDITABLE_NEED_FIELDS = ["department", "requestDate"] as const;
const NUMERIC_FIELDS = new Set<string>([
  "hours", "km", "quantity", "estimatedCost", "actualCost",
]);

/** التعديل اللي اتسجّل في المراجعة لازم ينزل على السجل الأصلي قبل الإرسال. */
async function applyRecordEdits(
  tx: Prisma.TransactionClient,
  entity: ReviewEntity,
  recordId: number,
  data: Record<string, unknown>,
  userId: number,
) {
  const fields: readonly string[] = entity === "repairorder" ? EDITABLE_REPAIR_FIELDS : EDITABLE_NEED_FIELDS;
  const DATE_FIELDS = new Set<string>(["date", "entryDate", "exitDate", "requestDate"]);
  const patch: Record<string, unknown> = {};
  for (const key of fields) {
    if (!(key in data)) continue;
    let value = data[key];
    if (value === undefined) continue;
    if (value === null) {
      patch[key] = null;
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") {
        patch[key] = null;
        continue;
      }
      if (DATE_FIELDS.has(key)) {
        const d = new Date(`${trimmed}T00:00:00.000Z`);
        patch[key] = isNaN(d.getTime()) ? null : d;
        continue;
      }
      if (NUMERIC_FIELDS.has(key)) {
        const num = Number(trimmed);
        value = Number.isFinite(num) ? num : null;
      }
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return;
  if (entity === "repairorder") {
    await tx.repairOrder.update({ where: { id: recordId }, data: patch as any });
  } else {
    await tx.needRequest.update({ where: { id: recordId }, data: patch as any });
  }
  await logAudit(userId, entity === "repairorder" ? "RepairOrder" : "NeedRequest", recordId, "UPDATE", {
    source: "review-approve",
    fields: Object.keys(patch),
  });
}

async function assertSendableRecord(tx: Prisma.TransactionClient, review: { entity: string; recordId: number | null }) {
  const id = review.recordId;
  if (id == null) fail("السجل المرتبط بهذا الطلب غير موجود", 409);
  if (review.entity === "repairorder") {
    const row = await tx.repairOrder.findUnique({
      where: { id },
      select: { id: true, managersId: true, sentAt: true },
    });
    if (!row) fail("أمر الإصلاح المرتبط لم يعد موجودًا", 409);
    if (row.managersId || row.sentAt) fail("تم إرسال أمر الإصلاح لنظام المدرين بالفعل", 409);
  } else if (review.entity === "needrequest") {
    const row = await tx.needRequest.findUnique({
      where: { id },
      select: { id: true, managersId: true, status: true },
    });
    if (!row) fail("طلب الاحتياج المرتبط لم يعد موجودًا", 409);
    if (row.managersId || row.status === "SENT") fail("تم إرسال طلب الاحتياج لنظام المدرين بالفعل", 409);
  }
  return { id };
}

/** منطق الاعتماد داخل transaction واحدة — بيستخدمه الاعتماد الفردي والجماعي. */
async function approveInTx(tx: Prisma.TransactionClient, id: number, userId: number, strict: boolean, workOrderOverride?: number) {
  const existing = await tx.reviewRequest.findUnique({ where: { id } });
  if (!existing) {
    if (strict) fail("سجل المراجعة غير موجود", 404);
    return { approved: false, review: null, record: null, updated: false };
  }
  if (existing.status !== "PENDING_REVIEW") {
    if (strict) fail("السجل ليس في حالة مراجعة", 409);
    return { approved: false, review: existing, record: null, updated: false };
  }

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

  // نأخذ السجل أولًا (قفل optimistic) عشان طلبين متوازيين ما يكتبوش نفس السجل مرتين.
  const claim = await tx.reviewRequest.updateMany({
    where: { id, status: "PENDING_REVIEW" },
    data: { status: "APPROVED", reviewedById: userId, reviewedAt: new Date() },
  });
  if (claim.count === 0) fail("تم اعتماد السجل بالفعل", 409);

  let record: { id: number };
  let updated = false;
  if (PRE_EXISTING_ENTITIES.includes(existing.entity as ReviewEntity)) {
    // الطلبات دي متسجلة أصلًا في جداولها — الاعتماد ينزّل أي تعديل على السجل ويفتح الإرسال.
    record = await assertSendableRecord(tx, existing as { entity: string; recordId: number | null });
    if (existing.reviewedData != null) {
      await applyRecordEdits(
        tx,
        existing.entity as ReviewEntity,
        record.id,
        data,
        userId,
      );
    }
  } else if (existing.entity === "dailylog") {
    const r = await dailylogService.createApproved(data as any, userId, context, tx);
    record = r.record as any;
    updated = r.updated;
  } else {
    const maintenanceData =
      workOrderOverride != null ? { ...(data as any), workOrderNo: workOrderOverride } : data;
    const r = await maintenanceService.createApproved(maintenanceData as any, userId, context, tx);
    record = r.record as any;
    updated = r.updated;
  }

  await tx.reviewRequest.update({
    where: { id },
    data: { recordId: record.id },
  });

  await logAudit(userId, "ReviewRequest", id, "UPDATE", {
    action: "APPROVE",
    entity: existing.entity,
    recordId: record.id,
  }, tx);

  const review = await tx.reviewRequest.findUnique({ where: { id } });
  return { approved: true, review, record, updated };
}

// الاعتماد بيعمل عشرات الاستعلامات (قراءة المعدة، العدّادات، المشروع، القطاع، تدقيق...)
// والـ transaction الافتراضية في Prisma بتقفل بعد 5 ثواني — وده كان بيرجّع 500 على السجلات
// اللي فيها خطوات زيادة. النافذة هنا مفتوحة لحد 55 ثانية (سقف دالة Vercel = 60).
const APPROVE_TX = { timeout: 58_000, maxWait: 20_000 } as const;

export async function approve(id: number, userId: number) {
  const result = await prisma.$transaction((tx) => approveInTx(tx, id, userId, true), APPROVE_TX);
  // after approval of a repair order / need request, auto-send to managers system (best-effort)
  let sent: boolean | null = null;
  let sendError: string | null = null;
  if (result.approved && (result.review?.entity === "repairorder" || result.review?.entity === "needrequest")) {
    try {
      if (result.review.entity === "repairorder") {
        await (await import("../repair-orders/repairOrder.service.js")).send(result.record!.id, userId);
      } else {
        await (await import("../need-requests/needRequest.service.js")).send(result.record!.id, userId);
      }
      sent = true;
    } catch (err) {
      sent = false;
      sendError = err instanceof Error ? err.message : String(err);
    }
  }
  return { review: result.review, record: result.record, updated: result.updated, sent, sendError };
}

/** فحص مُسبق لكل طلبات المجموعة قبل أي كتابة: لو واحد منهم اترسل للمديرين،
 *  نرفض المجموعة كلها بدل ما نعتمد نصها. (الاعتماد نفسه بيتنفّذ سجل-سجل عشان مهل الوقت.) */
async function assertAllSendable(ids: number[]) {
  const pending = await prisma.reviewRequest.findMany({
    where: { id: { in: ids }, status: "PENDING_REVIEW" },
    select: { id: true, entity: true, recordId: true },
  });

  const repairIds = pending.filter((r) => r.entity === "repairorder" && r.recordId != null).map((r) => r.recordId!);
  const needIds = pending.filter((r) => r.entity === "needrequest" && r.recordId != null).map((r) => r.recordId!);

  const [repairs, needs] = await Promise.all([
    repairIds.length
      ? prisma.repairOrder.findMany({
          where: { id: { in: repairIds } },
          select: { id: true, managersId: true, sentAt: true },
        })
      : Promise.resolve([] as Array<{ id: number; managersId: number | null; sentAt: Date | null }>),
    needIds.length
      ? prisma.needRequest.findMany({
          where: { id: { in: needIds } },
          select: { id: true, managersId: true, status: true },
        })
      : Promise.resolve([] as Array<{ id: number; managersId: number | null; status: string }>),
  ]);

  const repairMap = new Map(repairs.map((r) => [r.id, r]));
  const needMap = new Map(needs.map((r) => [r.id, r]));

  for (const row of pending) {
    if (row.recordId == null) continue;
    if (row.entity === "repairorder") {
      const rec = repairMap.get(row.recordId);
      if (!rec) fail("أمر الإصلاح المرتبط لم يعد موجودًا", 409);
      if (rec.managersId || rec.sentAt) fail("تم إرسال أمر الإصلاح لنظام المدرين بالفعل", 409);
    } else if (row.entity === "needrequest") {
      const rec = needMap.get(row.recordId);
      if (!rec) fail("طلب الاحتياج المرتبط لم يعد موجودًا", 409);
      if (rec.managersId || rec.status === "SENT") fail("تم إرسال طلب الاحتياج لنظام المدرين بالفعل", 409);
    }
  }
}

/** اعتماد مجموعة كاملة — كل سجل في transaction قصيرة مستقلة، بمحدودية توازٍ.
 *  الاعتماد الجماعي كان بيفشل لأن 29 سجل في transaction واحدة بياخدوا أكتر من مهلة Vercel،
 *  فبنقسّم الشغل ده على 4 مسارات متوازية وبنجمّع اللي فشل بدل ما نرمي الكل. */
export async function bulkApprove(ids: number[], userId: number) {
  const unique = [...new Set(ids)];
  await assertAllSendable(unique);
  // توليد أرقام أوامر الشغل تسلسليًا (وليس بالتوازي) لمنع تكرار نفس الرقم
  // ضمن المجموعة.
  const workOrderMap = new Map<number, number>();
  await prisma.$transaction(async (tx) => {
    for (const id of unique) {
      const row = await tx.reviewRequest.findUnique({ where: { id } });
      if (!row || row.status !== "PENDING_REVIEW") continue;
      const data = ((row.reviewedData ?? row.submittedData) ?? {}) as Record<string, unknown>;
      const wo = data.workOrderNo;
      if (row.entity !== "maintenance" || (wo != null && wo !== "")) continue;
      const eqId = Number(data.equipmentId);
      if (!Number.isFinite(eqId)) continue;
      const next = await maintenanceService.nextWorkOrderNo(eqId, tx);
      if (next != null) workOrderMap.set(id, next);
    }
  }, { timeout: 55_000, maxWait: 15_000 });

  const results: Array<{ id: number; approved: boolean; error?: string; sendError?: string }> = new Array(unique.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= unique.length) return;
      const id = unique[i];
      try {
        const one = await prisma.$transaction(
          (tx) => approveInTx(tx, id, userId, false, workOrderMap.get(id)),
          { timeout: 25_000, maxWait: 10_000 },
        );
        // auto-send to managers system after approval (best-effort)
        let sendErr: string | null = null;
        if (one.approved && (one.review?.entity === "repairorder" || one.review?.entity === "needrequest")) {
          try {
            if (one.review.entity === "repairorder") {
              await (await import("../repair-orders/repairOrder.service.js")).send(one.record!.id, userId);
            } else {
              await (await import("../need-requests/needRequest.service.js")).send(one.record!.id, userId);
            }
          } catch (err) {
            sendErr = err instanceof Error ? err.message : String(err);
          }
        }
        results[i] = { id, approved: one.approved, sendError: sendErr ?? undefined };
      } catch (err) {
        results[i] = { id, approved: false, error: (err as Error).message };
      }
    }
  }

  const workers = Math.min(4, unique.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const approved = results.filter((r) => r?.approved).length;
  const skipped = results.filter((r) => r && !r.approved && !r.error).length;
  const failed = results.filter((r) => r?.error).map((r) => ({ id: r.id, message: r.error! }));
  const sendFailed = results.filter((r) => r?.approved && r?.sendError).map((r) => ({ id: r.id, message: r.sendError! }));

  await logAudit(userId, "ReviewRequest", 0, "UPDATE", {
    action: "BULK_APPROVE",
    count: approved,
    skipped,
    failed: failed.length,
    sendFailed: sendFailed.length,
    ids: unique,
  });
  return { approved, skipped, failed, sendFailed, total: unique.length };
}

/** حذف طلب معلّق فقط — السجل المرتبط بيتمسح معاه لو لسه مااترسلش. */
export async function remove(id: number, userId: number, role: string) {
  if (role !== "ROOT" && role !== "ADMIN") fail("غير مصرح", 403);
  const existing = await prisma.reviewRequest.findUnique({ where: { id } });
  if (!existing) fail("سجل المراجعة غير موجود", 404);
  if (existing.status !== "PENDING_REVIEW") fail("لا يمكن حذف سجل تمت مراجعته", 409);

  await prisma.$transaction(async (tx) => {
    const recordId = existing.recordId;
    if (existing.entity === "repairorder" && recordId != null) {
      await tx.repairOrder.deleteMany({ where: { id: recordId, managersId: null, sentAt: null } });
    } else if (existing.entity === "needrequest" && recordId != null) {
      await tx.needRequest.deleteMany({ where: { id: recordId, managersId: null, status: { not: "SENT" } } });
    }
    await tx.reviewRequest.delete({ where: { id } });
  });

  await logAudit(userId, "ReviewRequest", id, "DELETE", {
    entity: existing.entity,
    recordId: existing.recordId,
    action: "DELETE_PENDING",
  });
  return { message: "تم حذف الطلب المعلّق" };
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
