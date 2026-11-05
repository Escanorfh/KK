// طبقة توافق واحدة في وضع desktop: تشيل `mode` من فلاتر النصوص.
// السبب مقيس، مش تخمين: Prisma 5.22 على SQLite بيرفض `mode` بخطأ PrismaClientValidationError
// («Unknown argument `mode`»)، وفي نفس الوقت LIKE بتاع SQLite غير حساس للحالة للأحرف اللاتينية،
// فمسح المفتاح بيحافظ على نتيجة البحث. لتساوي الحالة (تسجيل الدخول) المطلوب COLLATE NOCASE
// على مستوى DDL — ده شغل TASK 02 مش هنا.

const FILTER_OPS = new Set([
  "equals",
  "in",
  "notIn",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "startsWith",
  "endsWith",
  "not",
  "mode",
]);

const DELEGATE_METHODS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

let strippedCount = 0;

function isFilterObject(node: Record<string, unknown>): boolean {
  if (!("mode" in node)) return false;
  return Object.keys(node).some((k) => k !== "mode" && FILTER_OPS.has(k));
}

// بيشايل تركيبيًا: ما بيعدّيش على كائنات غير عادية (Date, Buffer, أصناف Prisma) فبيفضل نوعها زي ما هو
function transform(node: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(node)) return node.map((item) => transform(item, seen));
  if (node === null || typeof node !== "object") return node;
  if (node instanceof Date) return node;
  if (seen.has(node)) return node;
  const proto = Object.getPrototypeOf(node) as unknown;
  if (proto !== Object.prototype && proto !== null) return node;

  const source = node as Record<string, unknown>;
  seen.add(source);
  const filter = isFilterObject(source);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (filter && key === "mode") {
      strippedCount++;
      continue;
    }
    out[key] = transform(value, seen);
  }
  return out;
}

function looksLikeDelegate(value: object): boolean {
  for (const method of DELEGATE_METHODS) {
    try {
      if (typeof Reflect.get(value, method, value) === "function") return true;
    } catch {
      /* بعض الخصائص على عملاء Prisma بترمي لو اتقريت بدري */
    }
  }
  return false;
}

function wrap(target: object): object {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj) as unknown;
      if (typeof prop === "symbol") return value;

      if (prop === "$transaction" && typeof value === "function") {
        const run = value as (arg: unknown, options?: unknown) => unknown;
        return (arg: unknown, options?: unknown) =>
          typeof arg === "function"
            ? run.call(obj, (rawTx: object) => (arg as (tx: object) => unknown)(wrap(rawTx)), options)
            : run.call(obj, arg, options);
      }

      if (typeof value === "function") {
        const fn = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => fn.apply(obj, args.map((a) => transform(a, new WeakSet())));
      }

      // الأقسام (delegates) هي اللي محتاجة التغليف، وبنعرفها من دوالها لا من اسمها:
      // `prop` هنا اسم الموديل («user»)، فمقارنته بقائمة الدوال ما كانتش بتطابق أبدًا
      if (value && typeof value === "object" && looksLikeDelegate(value as object)) return wrap(value as object);
      return value;
    },
  });
}

export function withDesktopCompat<R extends object>(client: R): R {
  return wrap(client) as R;
}

// للـ health endpoint في TASK 03: عدد مرات التجريد من بداية العملية
export function desktopCompatStats(): { strippedModeFilters: number } {
  return { strippedModeFilters: strippedCount };
}
