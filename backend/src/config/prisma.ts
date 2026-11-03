import { PrismaClient } from "@prisma/client";

// Serverless بيجمّد الوحدة ويعيد استخدامها بين الطلبات: كل `new PrismaClient()` جديد
// بيفتح مجموعة اتصالات على القاعدة، وسقف الاتصالات هناك صغير — فالكلاينت بيتخزين مرة واحدة.
const cached = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  return (cached.prisma ??= new PrismaClient());
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

export default prisma;
