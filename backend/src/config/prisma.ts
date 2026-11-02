import { PrismaClient } from "@prisma/client";

// Serverless بيجمّد الوحدة ويعيد استخدامها بين الطلبات: كل `new PrismaClient()` جديد
// بيفتح مجموعة اتصالات على Neon، وسقف الاتصالات هناك صغير — فالكلاينت بيتخزين مرة واحدة
const cached = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = cached.prisma ?? new PrismaClient();

cached.prisma = prisma;

export default prisma;
