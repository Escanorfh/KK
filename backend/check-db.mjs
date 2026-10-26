import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const out = {
  users: await p.user.count(),
  projects: await p.project.count(),
  equipment: await p.equipment.count(),
  sectors: await p.sector.count(),
  dailyLogs: await p.dailyLog.count(),
  maintenances: await p.maintenance.count(),
  faults: await p.fault.count(),
  repairOrders: await p.repairOrder.count(),
  needRequests: await p.needRequest.count(),
  partSchedules: await p.partSchedule.count(),
  oilSchedules: await p.oilSchedule.count(),
  workParts: await p.workPart.count(),
  auditLogs: await p.auditLog.count(),
};
console.log(JSON.stringify(out, null, 1));
const projects = await p.project.findMany({
  select: { id: true, name: true, code: true, _count: { select: { equipment: true } } },
  orderBy: { id: "asc" },
});
console.log("projects:", projects.map((x) => `${x.id}:${x.code ?? "-"}:${x.name}(${x._count.equipment})`).join(" | ") || "(none)");
await p.$disconnect();
