import prisma from "../config/prisma";
import { createReviewRequest, type ReviewInputContext } from "../modules/review/review.service";

/** كيانات الطلبات اللي بتتسجل في جداولها أولًا وبعدين بيتم إرسالها للمديرين. */
export type ManagerSendEntity = "repairorder" | "needrequest";

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export interface RecordReviewInput {
  /** نسخة مسطّحة من البيانات تُعرض وتُعدّل في صفحة المراجعة. */
  data: Record<string, unknown>;
  context: ReviewInputContext;
  /** صاحب الطلب الأصلي — بيبقى اسمه ظاهر على كارت المراجعة. */
  submittedById: number;
}

function clientRequestId(entity: ManagerSendEntity, recordId: number) {
  return `${entity}:record:${recordId}`;
}

/** ينشئ سجل مراجعة للطلب مرة واحدة فقط (مفتاح ثابت بيمنع التكرار). */
export async function ensureRecordReview(
  entity: ManagerSendEntity,
  recordId: number,
  input: RecordReviewInput,
) {
  const existing = await prisma.reviewRequest.findFirst({
    where: { entity, recordId },
    select: { id: true },
  });
  if (existing) return existing;
  const { review } = await createReviewRequest(
    {
      entity,
      data: input.data,
      recordId,
      clientRequestId: clientRequestId(entity, recordId),
      context: input.context,
    },
    input.submittedById,
  );
  return review;
}

/**
 * بوابة الإرسال لنظام المدرين.
 * الطلبات القديمة اللي ما كانلوش سجل مراجعة بياخدوا سجل معلّق هنا، فبيظهروا في
 * مراجعة البيانات بدل ما يتبعتوا من غير اعتماد. بعد الاعتماد بيسمح الإرسال.
 */
export async function assertManagerSendApproved(
  entity: ManagerSendEntity,
  recordId: number,
  input: RecordReviewInput,
) {
  const approved = await prisma.reviewRequest.findFirst({
    where: { entity, recordId, status: "APPROVED" },
    select: { id: true },
  });
  if (approved) return;

  const pending = await prisma.reviewRequest.findFirst({
    where: { entity, recordId, status: "PENDING_REVIEW" },
    select: { id: true },
  });
  if (!pending) await ensureRecordReview(entity, recordId, input);

  fail("لازم تعتمد الطلب أولًا من صفحة مراجعة البيانات قبل إرساله لنظام المدرين", 409);
}
