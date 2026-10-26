import * as XLSX from "xlsx";
import { PrismaClient, type WorkType, type WorkStatus } from "@prisma/client";

const prisma = new PrismaClient();
const FILE = "F:\\SYSTEM APP\\SOUTH MED.xlsm";
const PROJECT_CODE = "SOUTH-MED";

function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][];
}

function serialToDate(n: number): Date {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(new Date(ms).toISOString().slice(0, 10) + "T00:00:00.000Z");
}

function parseDate(v: unknown): Date | null {
  if (typeof v === "number" && v > 40000 && v < 60000) return serialToDate(v);
  if (typeof v === "string") {
    const s = v.trim();
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (us) {
      const [, a, b, y] = us;
      const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
      const month = Number(a);
      const day = Number(b);
      if (month <= 12 && day <= 31) return new Date(Date.UTC(year, month - 1, day));
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return null;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function numOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface Part {
  name: string;
  code: string | null;
  qty: number | null;
  notes: string | null;
}

interface Order {
  workOrderNo: number | null;
  date: Date;
  endDate: Date | null;
  equipmentCode: string;
  orderType: string | null;
  maintenanceType: string | null;
  workshop: string | null;
  description: string | null;
  action: string | null;
  meterReading: number | null;
  kmMeter: number | null;
  status: WorkStatus;
  workType: WorkType;
  notes: string | null;
  parts: Part[];
}

const workTypeOf = (v: string): WorkType =>
  v.includes("طارةئ") || v.includes("طارئة") ? "REPAIR" : "MAINTENANCE";

const statusOf = (v: string): WorkStatus => {
  if (v.includes("تم الصيانة")) return "DONE";
  if (v.includes("جاري")) return "IN_PROGRESS";
  if (v.includes("متوقف") || v.includes("انتظار")) return "WAITING_PARTS";
  return "NEW";
};

async function main() {
  console.log("Reading", FILE);
  const wb = XLSX.readFile(FILE, { cellDates: false });

  const project = await prisma.project.findUnique({ where: { code: PROJECT_CODE } });
  if (!project) {
    throw new Error("مشروع SOUTH-MED غير موجود — شغّل import:southmed الأول");
  }
  const sector =
    (await prisma.sector.findFirst({ where: { projectId: project.id, name: "المعدات" } })) ??
    (await prisma.sector.create({ data: { projectId: project.id, name: "المعدات" } }));

  const equipmentMap = new Map<string, number>();
  for (const eq of await prisma.equipment.findMany({ where: { projectId: project.id } })) {
    equipmentMap.set(eq.code, eq.id);
  }

  const rows = sheetRows(wb, "Sheet3").slice(1);
  const orders = new Map<number, Order>();
  let read = 0;
  let createdEq = 0;

  for (const r of rows) {
    const woNo = numOrNull(r[0]);
    const date = parseDate(r[1]);
    const code = str(r[4]);
    if (!date || !code) continue;
    read++;

    if (!equipmentMap.has(code)) {
      const eq = await prisma.equipment.create({
        data: { code, name: code, projectId: project.id, sectorId: sector.id },
      });
      equipmentMap.set(code, eq.id);
      createdEq++;
    }

    const key = woNo ?? -1;
    const existing = orders.get(key);

    const partName = str(r[19]);
    if (partName) {
      const part: Part = {
        name: partName,
        code: str(r[22]) || null,
        qty: numOrNull(r[23]),
        notes: str(r[26]) || null,
      };
      if (existing) {
        existing.parts.push(part);
        continue;
      }
    } else if (existing) {
      continue;
    }

    const maintType = str(r[10]) || null;
    orders.set(key, {
      workOrderNo: woNo,
      date,
      endDate: parseDate(r[9]),
      equipmentCode: code,
      orderType: str(r[2]) || null,
      maintenanceType: maintType,
      workshop: str(r[8]) || null,
      description: str(r[11]) || null,
      action: str(r[12]) || null,
      meterReading: numOrNull(r[6]),
      kmMeter: numOrNull(r[7]),
      status: statusOf(str(r[13])),
      workType: workTypeOf(str(r[10])),
      notes: str(r[16]) || null,
      parts: partName
        ? [
            {
              name: partName,
              code: str(r[22]) || null,
              qty: numOrNull(r[23]),
              notes: str(r[26]) || null,
            },
          ]
        : [],
    });
  }

  console.log(`Rows read: ${read}, orders grouped: ${orders.size}, new equipment: ${createdEq}`);

  const southEquipIds = [...equipmentMap.values()];
  const deleted = await prisma.maintenance.deleteMany({
    where: { equipmentId: { in: southEquipIds } },
  });
  console.log(`Deleted previous work orders: ${deleted.count}`);

  let inserted = 0;
  for (const order of orders.values()) {
    const eqId = equipmentMap.get(order.equipmentCode);
    if (!eqId) continue;
    await prisma.maintenance.create({
      data: {
        workOrderNo: order.workOrderNo,
        date: order.date,
        endDate: order.endDate,
        equipmentId: eqId,
        workType: order.workType,
        orderType: order.orderType,
        maintenanceType: order.maintenanceType,
        workshop: order.workshop,
        description: order.description,
        action: order.action,
        meterReading: order.meterReading,
        kmMeter: order.kmMeter,
        status: order.status,
        notes: order.notes,
        workParts: { create: order.parts },
      },
    });
    inserted++;
    process.stdout.write(`\rWork orders inserted: ${inserted}/${orders.size}`);
  }

  const withParts = await prisma.maintenance.count({
    where: { equipmentId: { in: southEquipIds }, workParts: { some: {} } },
  });
  const partsCount = await prisma.workPart.count({
    where: { maintenance: { equipmentId: { in: southEquipIds } } },
  });
  console.log(`\nWork orders done: ${inserted} inserted, ${withParts} with parts, ${partsCount} parts total`);

  const byStatus = await prisma.maintenance.groupBy({
    by: ["status"],
    where: { equipmentId: { in: southEquipIds } },
    _count: true,
  });
  console.log("Status distribution:", byStatus.map((s) => `${s.status}=${s._count}`).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
