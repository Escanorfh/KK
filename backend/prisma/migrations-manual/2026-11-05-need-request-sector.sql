-- إضافة حقل القطاع إلى طلبات الاحتياج + ربط القطاع بقطاع نظام المدرين
-- مولّدة بـ `prisma migrate diff --from-schema-datamodel <HEAD> --to-schema-datamodel <current> --script`
-- لم تُنفَّذ على أي قاعدة. تنفيذها يدويًا على PostgreSQL الإنتاجي يحتاج تصريحًا منفصلًا.
-- SQLite (وضع Desktop) بيتولّد من prisma/desktop.prisma بنفس الحقول.

-- AlterTable
ALTER TABLE "core"."Sector" ADD COLUMN     "managersRoomId" INTEGER,
ADD COLUMN     "managersRoomTitle" TEXT;

-- AlterTable
ALTER TABLE "ops"."NeedRequest" ADD COLUMN     "sectorId" INTEGER;

-- AddForeignKey
ALTER TABLE "ops"."NeedRequest" ADD CONSTRAINT "NeedRequest_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "core"."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
