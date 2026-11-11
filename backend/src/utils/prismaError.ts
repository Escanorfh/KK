import { Prisma } from "@prisma/client";

export interface PrismaErrorMapping {
  status: number;
  message: string;
}

type ErrorLike = {
  name?: string;
  code?: string;
  meta?: Record<string, unknown> | null;
};

/**
 * أخطاء Prisma المعروفة بتوصل أحيانًا ككائنات من عميل مختلف (Desktop SQLite)،
 * فبنطابق بالاسم بدل `instanceof` وحده — نفس أسلوب `isDbConnectionError`.
 */
export function isKnownPrismaError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return true;
  return (err as ErrorLike | null)?.name === "PrismaClientKnownRequestError";
}

/** استخراج target من meta بأمان: مصفوفة نصوص، نص واحد، أو field_name */
function targetsOf(meta: Record<string, unknown> | null | undefined): string[] {
  if (!meta || typeof meta !== "object") return [];
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) out.push(value.trim());
  };
  const target = (meta as { target?: unknown }).target;
  if (Array.isArray(target)) target.forEach(push);
  else push(target);
  push((meta as { field_name?: unknown }).field_name);
  return out.map((value) => value.toLowerCase());
}

function duplicateMessage(meta: Record<string, unknown> | null | undefined): string {
  const targets = targetsOf(meta);
  const joined = targets.join(" ");

  // ProjectSector @@unique([projectId, sectorId])
  if (
    (joined.includes("projectid") && joined.includes("sectorid")) ||
    joined.includes("projectid_sectorid")
  ) {
    return "القطاع مرتبط بالمشروع ده من قبل";
  }

  // ProjectSector @@unique([projectId, normalizedName])
  if (joined.includes("normalizedname")) {
    return "يوجد قطاع آخر بنفس الاسم داخل المشروع — اختر اسمًا مختلفًا";
  }

  // Sector @@unique([projectId, name])
  if (joined.includes("projectid") && joined.includes("name")) {
    return "القطاع موجود بالفعل في هذا المشروع بنفس الاسم";
  }

  if (joined.includes("code")) {
    return "هذه القيمة مستخدمة من قبل — تحقق من عدم تكرار البيانات";
  }

  return "البيانات مكرّرة — القيمة مستخدمة من قبل";
}

/**
 * تحويل أكواد Prisma المعروفة لاستجابة HTTP عربية.
 * P2022 مقصود إنه يرجع null هنا لأن `app.ts` بيعطي رسالة تشخيصية أدق بخصوص الترحيل.
 */
export function mapPrismaError(err: unknown): PrismaErrorMapping | null {
  if (!isKnownPrismaError(err)) return null;
  const e = err as ErrorLike;
  switch (e.code) {
    case "P2002":
      return { status: 409, message: duplicateMessage(e.meta) };
    case "P2003":
      return {
        status: 409,
        message: "لا يمكن تنفيذ العملية — السجل مرتبط ببيانات أخرى ولا يمكن حذفه أو تعديله",
      };
    case "P2014":
      return {
        status: 409,
        message: "لا يمكن تنفيذ العملية — تغيير العلاقة سيسبب تعارضًا في البيانات المرتبطة",
      };
    case "P2025":
      return { status: 404, message: "السجل المطلوب غير موجود" };
    default:
      // P2022 وكل الأكواد الأخرى: سلوكها الحالي في app.ts / الخطأ العام
      return null;
  }
}
