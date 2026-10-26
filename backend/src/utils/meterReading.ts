import prisma from "../config/prisma";

export type MeterKind = "hours" | "km";

interface ReadingSource {
  date: Date;
  value: number;
}

function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function toDateOnly(date: string) {
  return new Date(date + "T00:00:00.000Z");
}

export function isDecreasingReading(
  value: number,
  latest: number | null,
  resetBetween: boolean
): boolean {
  return latest !== null && value < latest && !resetBetween;
}

async function latestReadingBefore(
  equipmentId: number,
  before: Date,
  kind: MeterKind,
  exclude?: { dailyLogId?: number; maintenanceId?: number }
): Promise<ReadingSource | null> {
  const candidates: ReadingSource[] = [];

  if (kind === "hours") {
    const [log, maintenance, reset] = await Promise.all([
      prisma.dailyLog.findFirst({
        where: {
          equipmentId,
          date: { lt: before },
          endMeter: { not: null },
          ...(exclude?.dailyLogId ? { NOT: { id: exclude.dailyLogId } } : {}),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { date: true, endMeter: true },
      }),
      prisma.maintenance.findFirst({
        where: {
          equipmentId,
          date: { lt: before },
          meterReading: { not: null },
          ...(exclude?.maintenanceId ? { NOT: { id: exclude.maintenanceId } } : {}),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { date: true, meterReading: true },
      }),
      prisma.meterReset.findFirst({
        where: { equipmentId, date: { lt: before }, hours: { not: null } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { date: true, hours: true },
      }),
    ]);
    if (log?.endMeter != null) candidates.push({ date: log.date, value: log.endMeter });
    if (maintenance?.meterReading != null) {
      candidates.push({ date: maintenance.date, value: maintenance.meterReading });
    }
    if (reset?.hours != null) candidates.push({ date: reset.date, value: reset.hours });
  } else {
    const [maintenance, reset] = await Promise.all([
      prisma.maintenance.findFirst({
        where: {
          equipmentId,
          date: { lt: before },
          kmMeter: { not: null },
          ...(exclude?.maintenanceId ? { NOT: { id: exclude.maintenanceId } } : {}),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { date: true, kmMeter: true },
      }),
      prisma.meterReset.findFirst({
        where: { equipmentId, date: { lt: before }, km: { not: null } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { date: true, km: true },
      }),
    ]);
    if (maintenance?.kmMeter != null) {
      candidates.push({ date: maintenance.date, value: maintenance.kmMeter });
    }
    if (reset?.km != null) candidates.push({ date: reset.date, value: reset.km });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
  return candidates[0];
}

export async function assertReadingNotDecreasing(opts: {
  equipmentId: number;
  date: string;
  kind: MeterKind;
  value: number | null | undefined;
  exclude?: { dailyLogId?: number; maintenanceId?: number };
}) {
  const { equipmentId, value, kind, exclude } = opts;
  if (value == null) return;

  const date = toDateOnly(opts.date);
  const latest = await latestReadingBefore(equipmentId, date, kind, exclude);
  if (!latest) return;

  const resetBetween = await prisma.meterReset.findFirst({
    where: {
      equipmentId,
      date: { gt: latest.date, lte: date },
      ...(kind === "hours" ? { hours: { not: null } } : { km: { not: null } }),
    },
    select: { id: true },
  });

  if (!isDecreasingReading(value, latest.value, !!resetBetween)) return;

  const label = kind === "hours" ? "قراءة العداد" : "قراءة الكيلومترات";
  fail(
    `${label} (${value}) أقل من آخر قراءة مسجلة (${latest.value}) بتاريخ ${isoDate(latest.date)} — لا يمكن حفظ قراءة أقل إلا بعد تسجيل حدث تصفير`
  );
}
