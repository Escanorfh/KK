import prisma from "../../config/prisma";
import { alerts } from "../part-schedules/partSchedule.service";
import type { OverallStatus } from "../part-schedules/partSchedule.service";

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function last12Months(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(monthKey(d));
  }
  return out;
}

const MONTH_LABELS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function monthLabel(key: string) {
  const m = Number(key.slice(5, 7)) - 1;
  return `${MONTH_LABELS[m] ?? key} ${key.slice(0, 4)}`;
}

export async function summary(scope?: number[] | null) {
  const months = last12Months();
  const monthsFrom = new Date();
  monthsFrom.setMonth(monthsFrom.getMonth() - 11, 1);
  monthsFrom.setHours(0, 0, 0, 0);

  const eqScope = scope ? { projectId: { in: scope } } : {};
  const logScope = scope ? { equipment: { projectId: { in: scope } } } : {};
  const faultScope = scope
    ? { OR: [{ projectId: { in: scope } }, { equipment: { projectId: { in: scope } } }] }
    : {};
  const projScope = scope ? { id: { in: scope } } : {};
  const sectorScope = scope ? { projectId: { in: scope } } : {};

  const [
    totals,
    logs12,
    maint12,
    faultsByStatus,
    faults12,
    projects,
    conditions,
    topEquipmentRaw,
    recentFaults,
    recentMaint,
    recentLogs,
  ] = await Promise.all([
    Promise.all([
      prisma.equipment.count({ where: eqScope }),
      prisma.dailyLog.count({ where: logScope }),
      prisma.maintenance.count({ where: logScope }),
      prisma.fault.count({ where: faultScope }),
      prisma.project.count({ where: projScope }),
      prisma.sector.count({ where: sectorScope }),
    ]),
    prisma.dailyLog.findMany({
      where: { date: { gte: monthsFrom }, ...logScope },
      select: { date: true, operatingHours: true, diesel: true },
    }),
    prisma.maintenance.findMany({
      where: { date: { gte: monthsFrom }, ...logScope },
      select: { date: true, downtime: true },
    }),
    prisma.fault.groupBy({ by: ["status"], _count: { _all: true }, where: faultScope }),
    prisma.fault.findMany({
      where: { date: { gte: monthsFrom }, ...faultScope },
      select: { date: true, downtimeHours: true },
    }),
    prisma.equipment.groupBy({
      by: ["projectId"],
      _count: { _all: true },
      where: eqScope,
    }),
    prisma.dailyLog.groupBy({
      by: ["condition"],
      _count: { _all: true },
      where: logScope,
    }),
    prisma.dailyLog.findMany({
      where: { date: { gte: monthsFrom }, ...logScope },
      select: {
        operatingHours: true,
        diesel: true,
        equipment: { select: { id: true, code: true, name: true, project: { select: { name: true } } } },
      },
    }),
    prisma.fault.findMany({
      where: faultScope,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        date: true,
        description: true,
        status: true,
        downtimeHours: true,
        equipment: { select: { code: true, name: true } },
      },
    }),
    prisma.maintenance.findMany({
      where: logScope,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        date: true,
        workOrderNo: true,
        description: true,
        status: true,
        workType: true,
        equipment: { select: { code: true, name: true } },
      },
    }),
    prisma.dailyLog.findMany({
      where: logScope,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        date: true,
        operatingHours: true,
        diesel: true,
        condition: true,
        equipment: { select: { code: true, name: true } },
      },
    }),
  ]);

  // تنبيهات الزيت والفلتر (نفس حسابات شاشة تنبيهات الزيوت)
  let alertsSummary: Record<OverallStatus, number> = {
    OIL_AND_FILTER: 0,
    OIL: 0,
    FILTER: 0,
    DUE_SOON: 0,
    SAFE: 0,
    UNKNOWN: 0,
  };
  try {
    const res = await alerts({ scope });
    const summary = (res as { summary?: Record<string, number> }).summary;
    if (summary) {
      alertsSummary = {
        OIL_AND_FILTER: summary.oilAndFilter ?? 0,
        OIL: summary.oil ?? 0,
        FILTER: summary.filter ?? 0,
        DUE_SOON: summary.dueSoon ?? 0,
        SAFE: summary.safe ?? 0,
        UNKNOWN: summary.unknown ?? 0,
      };
    }
  } catch {
    alertsSummary = {
      OIL_AND_FILTER: 0,
      OIL: 0,
      FILTER: 0,
      DUE_SOON: 0,
      SAFE: 0,
      UNKNOWN: 0,
    };
  }

  // سلسلة شهرية: السراكي
  const logMap = new Map(months.map((m) => [m, { month: m, logs: 0, hours: 0, diesel: 0 }]));
  for (const l of logs12) {
    const row = logMap.get(monthKey(l.date));
    if (!row) continue;
    row.logs += 1;
    row.hours += l.operatingHours ?? 0;
    row.diesel += l.diesel ?? 0;
  }

  // سلسلة شهرية: الصيانة
  const maintMap = new Map(months.map((m) => [m, { month: m, count: 0, downtime: 0 }]));
  for (const m of maint12) {
    const row = maintMap.get(monthKey(m.date));
    if (!row) continue;
    row.count += 1;
    row.downtime += m.downtime ?? 0;
  }

  // سلسلة شهرية: الأعطال
  const faultMap = new Map(months.map((m) => [m, { month: m, count: 0, downtimeHours: 0 }]));
  for (const f of faults12) {
    const row = faultMap.get(monthKey(f.date));
    if (!row) continue;
    row.count += 1;
    row.downtimeHours += f.downtimeHours ?? 0;
  }

  // أعلى المعدات ساعات تشغيل (آخر 12 شهر)
  const eqAgg = new Map<number, { code: string; name: string; project: string | null; hours: number; diesel: number }>();
  for (const l of topEquipmentRaw) {
    const e = l.equipment;
    const cur = eqAgg.get(e.id) ?? { code: e.code, name: e.name, project: e.project?.name ?? null, hours: 0, diesel: 0 };
    cur.hours += l.operatingHours ?? 0;
    cur.diesel += l.diesel ?? 0;
    eqAgg.set(e.id, cur);
  }
  const topEquipment = [...eqAgg.values()]
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10)
    .map((e) => ({ ...e, hours: Math.round(e.hours * 10) / 10, diesel: Math.round(e.diesel * 10) / 10 }));

  // المعدات حسب المشروع
  const projectRows = await prisma.project.findMany({
    where: projScope,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const projCount = new Map(projects.map((p) => [p.projectId, p._count._all]));
  const equipmentByProject = [
    ...projectRows.map((p) => ({ name: p.name, count: projCount.get(p.id) ?? 0 })),
    { name: "بدون مشروع", count: projCount.get(null) ?? 0 },
  ].filter((r) => r.count > 0);

  const conditionMap = new Map(conditions.map((c) => [c.condition ?? "UNSET", c._count._all]));

  return {
    totals: {
      equipment: totals[0],
      dailyLogs: totals[1],
      maintenance: totals[2],
      faults: totals[3],
      projects: totals[4],
      sectors: totals[5],
    },
    alertsSummary,
    monthly: months.map((m) => ({
      month: m,
      label: monthLabel(m),
      logs: logMap.get(m)!.logs,
      hours: Math.round(logMap.get(m)!.hours * 10) / 10,
      diesel: Math.round(logMap.get(m)!.diesel * 10) / 10,
      maintenance: maintMap.get(m)!.count,
      maintDowntime: Math.round(maintMap.get(m)!.downtime * 10) / 10,
      faults: faultMap.get(m)!.count,
      faultDowntime: Math.round(faultMap.get(m)!.downtimeHours * 10) / 10,
    })),
    faultsByStatus: faultsByStatus.map((f) => ({ status: f.status, count: f._count._all })),
    equipmentByProject,
    conditions: {
      GOOD: conditionMap.get("GOOD") ?? 0,
      BROKEN: conditionMap.get("BROKEN") ?? 0,
      STOPPED: conditionMap.get("STOPPED") ?? 0,
    },
    topEquipment,
    recentFaults: recentFaults.map((f) => ({
      ...f,
      date: f.date.toISOString().slice(0, 10),
    })),
    recentMaintenance: recentMaint.map((m) => ({
      ...m,
      date: m.date.toISOString().slice(0, 10),
    })),
    recentLogs: recentLogs.map((l) => ({
      ...l,
      date: l.date.toISOString().slice(0, 10),
    })),
  };
}
