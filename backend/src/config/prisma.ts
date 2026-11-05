import { PrismaClient } from "@prisma/client";
import { EFMS_MODE, assertWebDatasourceConfigured, desktopSqliteUrl, isDesktopMode } from "./runtimeMode";
import { withDesktopCompat } from "./desktopCompat";

// Serverless بيجمّد الوحدة ويعيد استخدامها بين الطلبات: كل `new PrismaClient()` جديد
// بيفتح مجموعة اتصالات على القاعدة، وسقف الاتصالات هناك صغير — فالكلاينت بيتخزين مرة واحدة.
const cached = globalThis as unknown as { prisma?: PrismaClient };

// عميل Desktop بيتحمّل وقت التشغيل فقط: استيراد ثابت كان هيخلّي `npm run build`
// على Vercel يفشل لو عميل SQLite ما اتولّدتش (npm ci + postinstall بيولّد الإنتاجي بس)
function createDesktopClient(): PrismaClient {
  let mod: { PrismaClient: new (options: Record<string, unknown>) => unknown };
  try {
    mod = require("@efms/desktop-prisma") as {
      PrismaClient: new (options: Record<string, unknown>) => unknown;
    };
  } catch {
    throw new Error(
      'عميل SQLite غير موجود — شغّل «npm run desktop:generate» قبل الإقلاع بوضع EFMS_MODE=desktop'
    );
  }
  const client = new mod.PrismaClient({
    datasources: { db: { url: desktopSqliteUrl() } },
    log: ["warn", "error"],
  });
  return withDesktopCompat(client as object) as PrismaClient;
}

// المصدر الوحيد لاختيار العميل: EFMS_MODE — مافيش استنتاج من اسم المضيف ولا fallback
function createClient(): PrismaClient {
  if (isDesktopMode()) return createDesktopClient();
  assertWebDatasourceConfigured();
  return new PrismaClient();
}

function getClient(): PrismaClient {
  return (cached.prisma ??= createClient());
}

// الإنشاء بيتأجل لأول استخدام فعلًا: لو الـquery engine مش موجود على المنصة،
// `new PrismaClient()` بيفشل أثناء تحميل الوحدة فيوقّع كل مسارات /api (حتى /api/health)
// بـFUNCTION_INVOCATION_FAILED. بالتأجيل ده الخطأ يظهر في الطلب اللي بيلمس القاعدة بس،
// و/api/health/db يقدر يرجّع التشخيص (probe) بدل ما السيرفر يقع كله.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { EFMS_MODE };
export default prisma;
