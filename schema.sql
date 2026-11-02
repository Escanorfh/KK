-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "log";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ops";

-- CreateEnum
CREATE TYPE "core"."Role" AS ENUM ('ROOT', 'ADMIN', 'MANAGER', 'USER');

-- CreateEnum
CREATE TYPE "core"."WorkType" AS ENUM ('MAINTENANCE', 'REPAIR');

-- CreateEnum
CREATE TYPE "core"."WorkStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'WAITING_PARTS');

-- CreateEnum
CREATE TYPE "core"."RepairOrderStatus" AS ENUM ('PENDING', 'RECEIVED', 'IN_REPAIR', 'REPAIRED', 'LOADED', 'RETURNED');

-- CreateEnum
CREATE TYPE "core"."Condition" AS ENUM ('GOOD', 'BROKEN', 'STOPPED');

-- CreateEnum
CREATE TYPE "core"."TrackingMode" AS ENUM ('HOURS', 'KM', 'BOTH');

-- CreateEnum
CREATE TYPE "core"."NeedRequestStatus" AS ENUM ('DRAFT', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "core"."OilType" AS ENUM ('ENGINE', 'HYDRAULIC', 'STEERING', 'GEARBOX', 'OTHER');

-- CreateEnum
CREATE TYPE "core"."OilSource" AS ENUM ('MANUAL', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "core"."User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "core"."Role" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Project" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."UserProject" (
    "userId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProject_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateTable
CREATE TABLE "core"."Sector" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."EquipmentCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "codePrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultTrackingMode" "core"."TrackingMode" NOT NULL DEFAULT 'BOTH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."Equipment" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" INTEGER,
    "sectorId" INTEGER,
    "categoryId" INTEGER,
    "trackingMode" "core"."TrackingMode" NOT NULL DEFAULT 'BOTH',
    "trackingModeOverridden" BOOLEAN NOT NULL DEFAULT false,
    "trackingModeConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "hasOdometer" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."MeterReset" (
    "id" SERIAL NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "hours" DOUBLE PRECISION,
    "km" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."RepairOrder" (
    "id" SERIAL NOT NULL,
    "requestNo" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INTERNAL',
    "projectId" INTEGER,
    "sectorId" INTEGER,
    "equipmentId" INTEGER NOT NULL,
    "entryDate" DATE,
    "exitDate" DATE,
    "hours" DOUBLE PRECISION,
    "km" DOUBLE PRECISION,
    "workshop" TEXT,
    "faultDescription" TEXT NOT NULL,
    "actionTaken" TEXT,
    "itemName" TEXT,
    "partModel" TEXT,
    "itemCode" TEXT,
    "technicalCode" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'عدد',
    "itemCondition" TEXT NOT NULL DEFAULT 'عاطلة',
    "siteName" TEXT,
    "requesterName" TEXT,
    "sourceWarehouseId" INTEGER,
    "destinationWarehouseId" INTEGER,
    "technicianPhone" TEXT,
    "imageUrl" TEXT,
    "imageBase64" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION,
    "notes" TEXT,
    "status" "core"."RepairOrderStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "sendError" TEXT,
    "managersRef" TEXT,
    "managersId" INTEGER,
    "managersStatus" TEXT,
    "managersSyncedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."RepairPart" (
    "id" SERIAL NOT NULL,
    "repairOrderId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "qty" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."RepairOrderEvent" (
    "id" SERIAL NOT NULL,
    "repairOrderId" INTEGER NOT NULL,
    "status" "core"."RepairOrderStatus" NOT NULL,
    "userId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."NeedRequest" (
    "id" SERIAL NOT NULL,
    "requestNo" INTEGER NOT NULL,
    "projectId" INTEGER,
    "department" TEXT NOT NULL,
    "requestDate" DATE NOT NULL,
    "status" "core"."NeedRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "sendError" TEXT,
    "managersRef" TEXT,
    "managersId" INTEGER,
    "managersStatus" TEXT,
    "managersSyncedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeedRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."NeedRequestItem" (
    "id" SERIAL NOT NULL,
    "needRequestId" INTEGER NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemCode" TEXT,
    "unit" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "equipmentRef" TEXT,
    "currentBalance" DOUBLE PRECISION,
    "localSupply" DOUBLE PRECISION,
    "foreignSupply" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeedRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."DailyLog" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "startMeter" DOUBLE PRECISION,
    "endMeter" DOUBLE PRECISION,
    "operatingHours" DOUBLE PRECISION,
    "diesel" DOUBLE PRECISION,
    "productivity" TEXT,
    "productivityType" TEXT,
    "productivityCount" DOUBLE PRECISION,
    "condition" "core"."Condition",
    "conditionNote" TEXT,
    "notes" TEXT,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."Maintenance" (
    "id" SERIAL NOT NULL,
    "workOrderNo" INTEGER,
    "date" DATE NOT NULL,
    "endDate" DATE,
    "equipmentId" INTEGER NOT NULL,
    "workType" "core"."WorkType" NOT NULL,
    "orderType" TEXT,
    "maintenanceType" TEXT,
    "workshop" TEXT,
    "description" TEXT,
    "action" TEXT,
    "parts" TEXT,
    "meterReading" DOUBLE PRECISION,
    "kmMeter" DOUBLE PRECISION,
    "downtime" DOUBLE PRECISION,
    "status" "core"."WorkStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."WorkPart" (
    "id" SERIAL NOT NULL,
    "maintenanceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "qty" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."OilConsumption" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "oilType" "core"."OilType" NOT NULL,
    "oilName" TEXT,
    "liters" DOUBLE PRECISION NOT NULL,
    "pricePerLiter" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION,
    "source" "core"."OilSource" NOT NULL DEFAULT 'MANUAL',
    "maintenanceId" INTEGER,
    "notes" TEXT,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OilConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."OilSchedule" (
    "id" SERIAL NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "oilType" TEXT NOT NULL,
    "lastChangeMeter" DOUBLE PRECISION NOT NULL,
    "intervalHours" DOUBLE PRECISION NOT NULL,
    "warningBeforeHours" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "nextDueMeter" DOUBLE PRECISION NOT NULL,
    "lastServiceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OilSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."PartSchedule" (
    "id" SERIAL NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "partName" TEXT NOT NULL,
    "interval" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ساعة',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops"."Fault" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "projectId" INTEGER,
    "sectorId" INTEGER,
    "equipmentId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "cause" TEXT,
    "faultType" TEXT,
    "downtimeHours" DOUBLE PRECISION,
    "actionTaken" TEXT,
    "status" "core"."WorkStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log"."AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "entity" TEXT NOT NULL,
    "recordId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log"."ImportLog" (
    "id" SERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "createdIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "core"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "core"."Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_projectId_name_key" ON "core"."Sector"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentCategory_name_key" ON "core"."EquipmentCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_code_key" ON "core"."Equipment"("code");

-- CreateIndex
CREATE INDEX "MeterReset_equipmentId_date_idx" ON "ops"."MeterReset"("equipmentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RepairOrder_requestNo_key" ON "ops"."RepairOrder"("requestNo");

-- CreateIndex
CREATE UNIQUE INDEX "RepairOrder_managersId_key" ON "ops"."RepairOrder"("managersId");

-- CreateIndex
CREATE UNIQUE INDEX "NeedRequest_requestNo_key" ON "ops"."NeedRequest"("requestNo");

-- CreateIndex
CREATE UNIQUE INDEX "NeedRequest_managersId_key" ON "ops"."NeedRequest"("managersId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_date_equipmentId_key" ON "ops"."DailyLog"("date", "equipmentId");

-- CreateIndex
CREATE INDEX "OilConsumption_equipmentId_date_idx" ON "ops"."OilConsumption"("equipmentId", "date");

-- CreateIndex
CREATE INDEX "OilConsumption_oilType_idx" ON "ops"."OilConsumption"("oilType");

-- CreateIndex
CREATE INDEX "OilConsumption_source_idx" ON "ops"."OilConsumption"("source");

-- CreateIndex
CREATE UNIQUE INDEX "OilSchedule_equipmentId_oilType_key" ON "ops"."OilSchedule"("equipmentId", "oilType");

-- CreateIndex
CREATE UNIQUE INDEX "PartSchedule_equipmentId_partName_key" ON "ops"."PartSchedule"("equipmentId", "partName");

-- CreateIndex
CREATE INDEX "ImportLog_entity_idx" ON "log"."ImportLog"("entity");

-- AddForeignKey
ALTER TABLE "core"."UserProject" ADD CONSTRAINT "UserProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."UserProject" ADD CONSTRAINT "UserProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "core"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Sector" ADD CONSTRAINT "Sector_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "core"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Equipment" ADD CONSTRAINT "Equipment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "core"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Equipment" ADD CONSTRAINT "Equipment_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "core"."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."Equipment" ADD CONSTRAINT "Equipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "core"."EquipmentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."MeterReset" ADD CONSTRAINT "MeterReset_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "core"."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."RepairOrder" ADD CONSTRAINT "RepairOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "core"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."RepairOrder" ADD CONSTRAINT "RepairOrder_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "core"."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."RepairOrder" ADD CONSTRAINT "RepairOrder_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "core"."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."RepairOrder" ADD CONSTRAINT "RepairOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "core"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."RepairPart" ADD CONSTRAINT "RepairPart_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "ops"."RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."RepairOrderEvent" ADD CONSTRAINT "RepairOrderEvent_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "ops"."RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."RepairOrderEvent" ADD CONSTRAINT "RepairOrderEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."NeedRequest" ADD CONSTRAINT "NeedRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "core"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."NeedRequest" ADD CONSTRAINT "NeedRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "core"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."NeedRequestItem" ADD CONSTRAINT "NeedRequestItem_needRequestId_fkey" FOREIGN KEY ("needRequestId") REFERENCES "ops"."NeedRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."DailyLog" ADD CONSTRAINT "DailyLog_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "core"."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."DailyLog" ADD CONSTRAINT "DailyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."Maintenance" ADD CONSTRAINT "Maintenance_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "core"."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."Maintenance" ADD CONSTRAINT "Maintenance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."WorkPart" ADD CONSTRAINT "WorkPart_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "ops"."Maintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."OilConsumption" ADD CONSTRAINT "OilConsumption_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "core"."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."OilConsumption" ADD CONSTRAINT "OilConsumption_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "ops"."Maintenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."OilConsumption" ADD CONSTRAINT "OilConsumption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."OilSchedule" ADD CONSTRAINT "OilSchedule_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "core"."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."PartSchedule" ADD CONSTRAINT "PartSchedule_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "core"."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."Fault" ADD CONSTRAINT "Fault_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "core"."Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."Fault" ADD CONSTRAINT "Fault_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "core"."Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops"."Fault" ADD CONSTRAINT "Fault_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "core"."Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

