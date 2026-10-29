import prisma from "../../config/prisma";
import { logAudit } from "../../utils/audit";
import { scopeOr } from "../../utils/scope";

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

type SaveInput = {
  equipmentId?: number;
  partName?: string;
  interval?: number;
  unit?: string;
  notes?: string | null;
};

async function ensureEquipment(equipmentId: number) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) {
    fail("المعدة غير موجودة", 404);
  }
}

async function ensureUniquePart(equipmentId: number, partName: string, excludeId?: number) {
  const dup = await prisma.partSchedule.findFirst({
    where: { equipmentId, partName, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (dup) {
    fail("هذا الصنف مضاف بالفعل لهذه المعدة", 409);
  }
}

export async function list(equipmentId: number) {
  await ensureEquipment(equipmentId);
  return prisma.partSchedule.findMany({
    where: { equipmentId },
    orderBy: [{ id: "asc" }],
  });
}

export async function create(input: Required<Pick<SaveInput, "equipmentId" | "partName" | "interval">> & SaveInput, userId: number) {
  await ensureEquipment(input.equipmentId);
  await ensureUniquePart(input.equipmentId, input.partName);

  const record = await prisma.partSchedule.create({
    data: {
      equipmentId: input.equipmentId,
      partName: input.partName,
      interval: input.interval,
      unit: input.unit ?? "ساعة",
      notes: input.notes ?? null,
    },
  });

  await logAudit(userId, "PartSchedule", record.id, "CREATE", {
    equipmentId: input.equipmentId,
    partName: input.partName,
    interval: input.interval,
    unit: input.unit ?? "ساعة",
  });
  return { record };
}

export async function update(id: number, input: SaveInput, userId: number) {
  const existing = await prisma.partSchedule.findUnique({ where: { id } });
  if (!existing) {
    fail("موعد تغيير الصنف غير موجود", 404);
  }

  const equipmentId = input.equipmentId ?? existing.equipmentId;
  const partName = input.partName ?? existing.partName;

  if (input.equipmentId !== undefined) {
    await ensureEquipment(input.equipmentId);
  }
  if (input.equipmentId !== undefined || input.partName !== undefined) {
    await ensureUniquePart(equipmentId, partName, id);
  }

  const record = await prisma.partSchedule.update({
    where: { id },
    data: {
      ...(input.equipmentId !== undefined ? { equipmentId: input.equipmentId } : {}),
      ...(input.partName !== undefined ? { partName: input.partName } : {}),
      ...(input.interval !== undefined ? { interval: input.interval } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  await logAudit(userId, "PartSchedule", id, "UPDATE", {
    partName,
    interval: record.interval,
    unit: record.unit,
  });
  return { record };
}

export async function remove(id: number, userId: number) {
  const existing = await prisma.partSchedule.findUnique({ where: { id } });
  if (!existing) {
    fail("موعد تغيير الصنف غير موجود", 404);
  }
  await prisma.partSchedule.delete({ where: { id } });
  await logAudit(userId, "PartSchedule", id, "DELETE", {
    equipmentId: existing.equipmentId,
    partName: existing.partName,
  });
  return { message: "تم حذف موعد تغيير الصنف" };
}

export const OIL_DEFAULT_INTERVAL = 150;
export const OIL_KM_DEFAULT_INTERVAL = 10000;
export const FILTER_DEFAULT_INTERVAL = 300;
export const FILTER_KM_DEFAULT_INTERVAL = 20_000;

function normalizePartName(value: string): string {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

export function isEngineOilPart(partName: string): boolean {
  const name = normalizePartName(partName);
  return name.includes("زيت") && ["محرك", "موتور", "ماتور"].some((w) => name.includes(w));
}

export function isOilFilterPart(partName: string): boolean {
  const name = normalizePartName(partName);
  if (!name.includes("فلتر")) return false;
  if (["هيدروليك", "فتيس", "جاز", "ديزل", "سولار", "هوا", "فاصل"].some((w) => name.includes(w))) {
    return false;
  }
  return ["زيت", "محرك", "موتور", "ماتور"].some((w) => name.includes(w));
}

export function isPeriodicMaintenance(maintenanceType: string | null): boolean {
  return normalizePartName(maintenanceType ?? "").includes("دوريه");
}

export type TrackingMode = "HOURS" | "KM" | "BOTH";
export type ServiceStatus =
  | "OVERDUE"
  | "DUE"
  | "DUE_SOON"
  | "SAFE"
  | "UNKNOWN"
  | "NOT_APPLICABLE";
export type OverallStatus =
  | "OIL_AND_FILTER"
  | "OIL"
  | "FILTER"
  | "DUE_SOON"
  | "SAFE"
  | "UNKNOWN";
export type OilDueBy = "HOURS" | "KM" | "BOTH";
export type OilAlertState =
  | "MODE_UNCONFIRMED"
  | "VERIFY_DATA"
  | "BOTH_OVERDUE"
  | "HOURS_OVERDUE"
  | "KM_OVERDUE"
  | "BOTH_DUE"
  | "HOURS_DUE"
  | "KM_DUE"
  | "BOTH_DUE_SOON"
  | "HOURS_DUE_SOON"
  | "KM_DUE_SOON"
  | "OK";

export interface ServiceAlert {
  interval: number;
  isDefault: boolean;
  lastDate: string | null;
  lastMeter: number | null;
  elapsed: number | null;
  remaining: number | null;
  percent: number | null;
  status: ServiceStatus;
}

export interface EquipmentAlert {
  equipmentId: number;
  code: string;
  name: string;
  projectName: string | null;
  categoryName: string | null;
  trackingMode: TrackingMode;
  trackingModeConfirmed: boolean;
  modeUnconfirmed: boolean;
  currentMeter: number | null;
  currentKm: number | null;
  oil: ServiceAlert;
  oilKm: ServiceAlert;
  filter: ServiceAlert;
  filterKm: ServiceAlert;
  status: OverallStatus;
  oilState: OilAlertState;
  oilDueBy: OilDueBy | null;
  filterDue: boolean;
  filterAlert: boolean;
  hoursDataMissing: boolean;
  kmDataMissing: boolean;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// المعدات المستوردة قد تبقى غير مؤكدة في الإعدادات، لكن التنبيهات تُحسب من العدادات المتاحة فعلًا.
export function resolveEffectiveTrackingMode(
  mode: TrackingMode,
  confirmed: boolean,
  hasHoursData: boolean,
  hasKmData: boolean
): TrackingMode {
  if (confirmed) return mode;
  if (hasHoursData) return "HOURS";
  if (hasKmData) return "KM";
  return mode;
}

export function resolveServiceStatus(percent: number | null): ServiceStatus {
  if (percent == null) return "UNKNOWN";
  if (percent < 90) return "SAFE";
  if (percent < 100) return "DUE_SOON";
  if (percent === 100) return "DUE";
  return "OVERDUE";
}

export function computeService(opts: {
  interval: number;
  isDefault: boolean;
  last: { date: Date; meter: number | null } | null;
  currentMeter: number | null;
}): ServiceAlert {
  const rawElapsed =
    opts.last && opts.currentMeter != null && opts.last.meter != null
      ? Math.max(0, opts.currentMeter - opts.last.meter)
      : null;
  const elapsed = rawElapsed != null ? Math.round(rawElapsed * 10) / 10 : null;
  const remaining = elapsed != null ? Math.round((opts.interval - elapsed) * 10) / 10 : null;
  const rawPercent = rawElapsed != null ? (rawElapsed / opts.interval) * 100 : null;
  const percent = rawPercent != null ? Math.round(rawPercent * 100) / 100 : null;
  // الحالة تُبنى على النسبة المعروضة حتى لا يظهر «سليم» بجانب 90% بعد التقريب
  const status = resolveServiceStatus(percent);

  return {
    interval: opts.interval,
    isDefault: opts.isDefault,
    lastDate: opts.last ? isoDate(opts.last.date) : null,
    lastMeter: opts.last?.meter ?? null,
    elapsed,
    remaining,
    percent,
    status,
  };
}

function reachedLimit(s: ServiceAlert) {
  return s.status === "DUE" || s.status === "OVERDUE";
}

function approachingLimit(s: ServiceAlert) {
  return s.status === "DUE_SOON" || reachedLimit(s);
}

function notApplicable(service: ServiceAlert): ServiceAlert {
  return { ...service, elapsed: null, remaining: null, status: "NOT_APPLICABLE" };
}

export function resolveOilDueBy(
  oil: ServiceAlert,
  oilKm: ServiceAlert,
  mode: TrackingMode = "BOTH"
): OilDueBy | null {
  if (mode === "HOURS") return approachingLimit(oil) ? "HOURS" : null;
  if (mode === "KM") return approachingLimit(oilKm) ? "KM" : null;

  const hoursMissing = oil.status === "UNKNOWN" || oil.status === "NOT_APPLICABLE";
  const kmMissing = oilKm.status === "UNKNOWN" || oilKm.status === "NOT_APPLICABLE";
  if (hoursMissing && kmMissing) return null;
  if (hoursMissing) return oilKm.status === "OVERDUE" ? "KM" : null;
  if (kmMissing) return oil.status === "OVERDUE" ? "HOURS" : null;
  if (oil.percent == null || oilKm.percent == null) return null;
  if (Math.max(oil.percent, oilKm.percent) < 90) return null;
  if (oil.percent === oilKm.percent) return "BOTH";
  return oil.percent > oilKm.percent ? "HOURS" : "KM";
}

export function resolveOilAlertState(
  oil: ServiceAlert,
  oilKm: ServiceAlert,
  mode: TrackingMode = "BOTH",
  modeConfirmed = true
): OilAlertState {
  if (!modeConfirmed) return "MODE_UNCONFIRMED";
  if (mode === "HOURS") return resolveSingleMeterState(oil, "HOURS");
  if (mode === "KM") return resolveSingleMeterState(oilKm, "KM");

  const hours = oil.status;
  const km = oilKm.status;

  // لا يجوز اعتبار القراءة الناقصة صفرًا؛ تُقبل الأولوية إن كان العداد الآخر متأخرًا
  if (hours === "OVERDUE" && km === "OVERDUE") return "BOTH_OVERDUE";
  if (hours === "OVERDUE") return "HOURS_OVERDUE";
  if (km === "OVERDUE") return "KM_OVERDUE";

  const hoursMissing = hours === "UNKNOWN" || hours === "NOT_APPLICABLE";
  const kmMissing = km === "UNKNOWN" || km === "NOT_APPLICABLE";
  if (hoursMissing || kmMissing) return "VERIFY_DATA";

  const hoursPercent = oil.percent;
  const kmPercent = oilKm.percent;
  if (hoursPercent == null || kmPercent == null) return "VERIFY_DATA";

  // في وضع BOTH تُعتمد النسبة الأكبر، وعند التساوي يكون السببان معًا
  if (hoursPercent === kmPercent) {
    if (hoursPercent >= 100) return "BOTH_DUE";
    if (hoursPercent >= 90) return "BOTH_DUE_SOON";
    return "OK";
  }
  if (hoursPercent > kmPercent) {
    if (hoursPercent >= 100) return "HOURS_DUE";
    if (hoursPercent >= 90) return "HOURS_DUE_SOON";
    return "OK";
  }
  if (kmPercent >= 100) return "KM_DUE";
  if (kmPercent >= 90) return "KM_DUE_SOON";
  return "OK";
}

function resolveSingleMeterState(
  service: ServiceAlert,
  meter: "HOURS" | "KM"
): OilAlertState {
  if (service.status === "OVERDUE") return meter === "HOURS" ? "HOURS_OVERDUE" : "KM_OVERDUE";
  if (service.status === "DUE") return meter === "HOURS" ? "HOURS_DUE" : "KM_DUE";
  if (service.status === "DUE_SOON") {
    return meter === "HOURS" ? "HOURS_DUE_SOON" : "KM_DUE_SOON";
  }
  if (service.status === "SAFE") return "OK";
  return "VERIFY_DATA";
}

export function resolveOilAlert(oilState: OilAlertState): boolean {
  return (
    oilState === "HOURS_DUE" ||
    oilState === "KM_DUE" ||
    oilState === "BOTH_DUE" ||
    oilState === "HOURS_OVERDUE" ||
    oilState === "KM_OVERDUE" ||
    oilState === "BOTH_OVERDUE"
  );
}

export function resolveFilterDue(
  filterHours: ServiceAlert,
  filterKm: ServiceAlert,
  mode: TrackingMode = "BOTH"
): boolean {
  const hoursDue = mode !== "KM" && reachedLimit(filterHours);
  const kmDue = mode !== "HOURS" && reachedLimit(filterKm);
  return hoursDue || kmDue;
}

export function resolveFilterAlert(oilState: OilAlertState, filterDue: boolean): boolean {
  // الفلتر لا يظهر منفردًا: لا بد من استحقاق الزيت معه
  return resolveOilAlert(oilState) && filterDue;
}

export function resolveOverallStatus(
  oilState: OilAlertState,
  filterDue: boolean,
  modeConfirmed = true
): OverallStatus {
  if (!modeConfirmed || oilState === "VERIFY_DATA") return "UNKNOWN";
  if (oilState === "OK") return "SAFE";
  if (
    oilState === "HOURS_DUE_SOON" ||
    oilState === "KM_DUE_SOON" ||
    oilState === "BOTH_DUE_SOON"
  ) {
    return "DUE_SOON";
  }
  return filterDue ? "OIL_AND_FILTER" : "OIL";
}

export type MaintenanceHistoryOrder = {
  equipmentId: number;
  date: Date;
  endDate: Date | null;
  maintenanceType: string | null;
  meterReading: number | null;
  kmMeter: number | null;
  workParts: { name: string }[];
};

export type MeterResetRecord = {
  equipmentId: number;
  date: Date;
  hours: number | null;
  km: number | null;
};

type Baseline = { date: Date; meter: number | null };

export function buildServiceHistory(
  orders: MaintenanceHistoryOrder[],
  resets: MeterResetRecord[] = []
) {
  const lastOilHours = new Map<number, Baseline>();
  const lastOilKm = new Map<number, Baseline>();
  const lastFilter = new Map<number, Baseline>();
  const lastFilterKm = new Map<number, Baseline>();

  type ServiceEvent = {
    equipmentId: number;
    date: Date;
    oilMeter: number | null;
    oilKmMeter: number | null;
    filterMeter: number | null;
    filterKmMeter: number | null;
    hasFilter: boolean;
  };

  // نجمع أوامر نفس اليوم كخدمة واحدة حتى لا يُحسب الزيت والفلتر المنفصلان مرتين
  const serviceEvents = new Map<string, ServiceEvent>();

  for (const order of orders) {
    // تصفير العدادات يتم فقط بأوامر الصيانة الدورية
    if (!isPeriodicMaintenance(order.maintenanceType)) continue;

    const hasOilPart = order.workParts.some((p) => isEngineOilPart(p.name));
    const hasFilterPart = order.workParts.some((p) => isOilFilterPart(p.name));
    // لا يوجد تغيير فلتر منفرد: أي تغيير فلتر زيت يعني تغيير الزيت معه
    if (!hasOilPart && !hasFilterPart) continue;

    const effDate = order.endDate ?? order.date;
    const key = `${order.equipmentId}|${effDate.toISOString().slice(0, 10)}`;
    const event: ServiceEvent =
      serviceEvents.get(key) ??
      ({
        equipmentId: order.equipmentId,
        date: effDate,
        oilMeter: null,
        oilKmMeter: null,
        filterMeter: null,
        filterKmMeter: null,
        hasFilter: false,
      } satisfies ServiceEvent);

    // قراءة الزيت تُؤخذ من أمر الزيت نفسه؛ أمر الفلتر لا يستبدلها عند اختلاف القراءتين
    if (hasOilPart) {
      if (order.meterReading != null) event.oilMeter = order.meterReading;
      if (order.kmMeter != null) event.oilKmMeter = order.kmMeter;
    }
    if (hasFilterPart) {
      event.hasFilter = true;
      if (order.meterReading != null) event.filterMeter = order.meterReading;
      if (order.kmMeter != null) event.filterKmMeter = order.kmMeter;
    }
    if (effDate > event.date) event.date = effDate;
    serviceEvents.set(key, event);
  }

  const eventsByEquipment = new Map<number, ServiceEvent[]>();
  for (const event of serviceEvents.values()) {
    const list = eventsByEquipment.get(event.equipmentId) ?? [];
    list.push(event);
    eventsByEquipment.set(event.equipmentId, list);
  }

  const resetsByEquipment = new Map<number, MeterResetRecord[]>();
  for (const reset of resets) {
    const list = resetsByEquipment.get(reset.equipmentId) ?? [];
    list.push(reset);
    resetsByEquipment.set(reset.equipmentId, list);
  }

  const equipmentIds = new Set<number>([
    ...eventsByEquipment.keys(),
    ...resetsByEquipment.keys(),
  ]);

  for (const equipmentId of equipmentIds) {
    const services = (eventsByEquipment.get(equipmentId) ?? []).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
    const equipmentResets = (resetsByEquipment.get(equipmentId) ?? []).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    let si = 0;
    let ri = 0;

    while (si < services.length || ri < equipmentResets.length) {
      const takeReset =
        ri < equipmentResets.length &&
        (si >= services.length || equipmentResets[ri].date <= services[si].date);

      if (takeReset) {
        const reset = equipmentResets[ri++];
        // التصفير الصريح يعيد تأسيس كل عداد شملته القيمة الجديدة
        if (reset.hours != null) {
          lastOilHours.set(equipmentId, { date: reset.date, meter: reset.hours });
          if (lastFilter.has(equipmentId)) {
            lastFilter.set(equipmentId, { date: reset.date, meter: reset.hours });
          }
        }
        if (reset.km != null) {
          lastOilKm.set(equipmentId, { date: reset.date, meter: reset.km });
          if (lastFilterKm.has(equipmentId)) {
            lastFilterKm.set(equipmentId, { date: reset.date, meter: reset.km });
          }
        }
        continue;
      }

      const event = services[si++];
      lastOilHours.set(equipmentId, {
        date: event.date,
        meter: event.oilMeter ?? event.filterMeter,
      });
      lastOilKm.set(equipmentId, {
        date: event.date,
        meter: event.oilKmMeter ?? event.filterKmMeter,
      });

      // الفلتر يتصفّر فقط عند تسجيل تغيير فلتر فعلي
      if (event.hasFilter) {
        lastFilter.set(equipmentId, {
          date: event.date,
          meter: event.filterMeter ?? event.oilMeter,
        });
        lastFilterKm.set(equipmentId, {
          date: event.date,
          meter: event.filterKmMeter ?? event.oilKmMeter,
        });
      }
    }
  }

  return { lastOilHours, lastOilKm, lastFilter, lastFilterKm };
}

export async function alerts(params: {
  status?: OverallStatus | "OIL_DUE" | "MODE_UNCONFIRMED";
  projectId?: number;
  q?: string;
  scope?: number[] | null;
}) {
  const own = scopeOr(params.scope);
  const equipment = await prisma.equipment.findMany({
    where: {
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(own ? { OR: own } : {}),
      ...(params.q
        ? {
            OR: [
              { code: { contains: params.q, mode: "insensitive" } },
              { name: { contains: params.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      trackingMode: true,
      trackingModeConfirmed: true,
      category: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  const equipmentIds = equipment.map((e) => e.id);

  // تجاوزات يدوية من جدول المواعيد (WORK): زيت المحرك (ساعة/كم) وفلتر الزيت (ساعة/كم)
  const oilHourOverrides = new Map<number, number>();
  const oilKmOverrides = new Map<number, number>();
  const filterOverrides = new Map<number, number>();
  const filterKmOverrides = new Map<number, number>();
  const hourSources = new Map<number, { date: Date; value: number }>();
  const kmSources = new Map<number, { date: Date; value: number }>();
  let lastOilHours = new Map<number, Baseline>();
  let lastOilKm = new Map<number, Baseline>();
  let lastFilter = new Map<number, Baseline>();
  let lastFilterKm = new Map<number, Baseline>();

  if (equipmentIds.length > 0) {
    const [schedules, logs, kmReadings, orders, resets] = await Promise.all([
      prisma.partSchedule.findMany({
        where: { equipmentId: { in: equipmentIds } },
        select: { equipmentId: true, partName: true, interval: true, unit: true },
      }),
      prisma.dailyLog.findMany({
        where: { equipmentId: { in: equipmentIds }, endMeter: { not: null } },
        select: { equipmentId: true, date: true, endMeter: true },
        orderBy: [{ date: "desc" }, { id: "desc" }],
      }),
      prisma.maintenance.findMany({
        where: { equipmentId: { in: equipmentIds }, kmMeter: { not: null } },
        select: { equipmentId: true, date: true, kmMeter: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      prisma.maintenance.findMany({
        where: {
          equipmentId: { in: equipmentIds },
          workParts: { some: {} },
        },
        select: {
          equipmentId: true,
          date: true,
          endDate: true,
          maintenanceType: true,
          meterReading: true,
          kmMeter: true,
          workParts: { select: { name: true } },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      prisma.meterReset.findMany({
        where: { equipmentId: { in: equipmentIds } },
        select: { equipmentId: true, date: true, hours: true, km: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
    ]);

    for (const s of schedules) {
      const unit = normalizePartName(s.unit);
      const isKmUnit = unit === "كم" || unit.includes("كيلو");
      const isHourUnit = unit.includes("ساع");
      if (isEngineOilPart(s.partName)) {
        if (isKmUnit) {
          const cur = oilKmOverrides.get(s.equipmentId);
          if (cur == null || s.interval < cur) oilKmOverrides.set(s.equipmentId, s.interval);
        } else if (isHourUnit) {
          const cur = oilHourOverrides.get(s.equipmentId);
          if (cur == null || s.interval < cur) oilHourOverrides.set(s.equipmentId, s.interval);
        }
      } else if (isOilFilterPart(s.partName)) {
        if (isKmUnit) {
          const cur = filterKmOverrides.get(s.equipmentId);
          if (cur == null || s.interval < cur) filterKmOverrides.set(s.equipmentId, s.interval);
        } else if (isHourUnit) {
          const cur = filterOverrides.get(s.equipmentId);
          if (cur == null || s.interval < cur) filterOverrides.set(s.equipmentId, s.interval);
        }
      }
    }

    // أحدث قراءة ساعات: يومية أو حدث تصفير صريح (الأحدث تاريخًا يفوز)
    for (const log of logs) {
      if (log.endMeter == null) continue;
      const cur = hourSources.get(log.equipmentId);
      if (!cur || log.date > cur.date) {
        hourSources.set(log.equipmentId, { date: log.date, value: log.endMeter });
      }
    }

    // آخر قراءة كيلومترات مسجلة في أوامر الصيانة أو أحداث التصفير
    for (const reading of kmReadings) {
      if (reading.kmMeter == null) continue;
      const cur = kmSources.get(reading.equipmentId);
      if (!cur || reading.date >= cur.date) {
        kmSources.set(reading.equipmentId, { date: reading.date, value: reading.kmMeter });
      }
    }

    for (const reset of resets) {
      if (reset.hours != null) {
        const cur = hourSources.get(reset.equipmentId);
        if (!cur || reset.date >= cur.date) {
          hourSources.set(reset.equipmentId, { date: reset.date, value: reset.hours });
        }
      }
      if (reset.km != null) {
        const cur = kmSources.get(reset.equipmentId);
        if (!cur || reset.date >= cur.date) {
          kmSources.set(reset.equipmentId, { date: reset.date, value: reset.km });
        }
      }
    }

    ({ lastOilHours, lastOilKm, lastFilter, lastFilterKm } = buildServiceHistory(
      orders,
      resets
    ));
  }

  const rows: EquipmentAlert[] = equipment.map((eq) => {
    const mode = eq.trackingMode as TrackingMode;
    const modeConfirmed = eq.trackingModeConfirmed;
    const hasHoursData = hourSources.has(eq.id);
    const hasKmData = kmSources.has(eq.id);
    const effectiveMode = resolveEffectiveTrackingMode(
      mode,
      modeConfirmed,
      hasHoursData,
      hasKmData
    );
    const hoursApplicable = effectiveMode !== "KM";
    const kmApplicable = effectiveMode !== "HOURS";
    const currentMeter = hoursApplicable ? (hourSources.get(eq.id)?.value ?? null) : null;
    const currentKm = kmApplicable ? (kmSources.get(eq.id)?.value ?? null) : null;

    const oilHourInterval = oilHourOverrides.get(eq.id);
    const oilKmInterval = oilKmOverrides.get(eq.id);
    const filterHourOverride = filterOverrides.get(eq.id);
    const filterKmOverride = filterKmOverrides.get(eq.id);

    let oil = computeService({
      interval: oilHourInterval ?? OIL_DEFAULT_INTERVAL,
      isDefault: oilHourInterval == null,
      last: lastOilHours.get(eq.id) ?? null,
      currentMeter,
    });
    let oilKm = computeService({
      interval: oilKmInterval ?? OIL_KM_DEFAULT_INTERVAL,
      isDefault: oilKmInterval == null,
      last: lastOilKm.get(eq.id) ?? null,
      currentMeter: currentKm,
    });
    let filter = computeService({
      interval: filterHourOverride ?? FILTER_DEFAULT_INTERVAL,
      isDefault: filterHourOverride == null,
      last: lastFilter.get(eq.id) ?? null,
      currentMeter,
    });
    let filterKm = computeService({
      interval: filterKmOverride ?? FILTER_KM_DEFAULT_INTERVAL,
      isDefault: filterKmOverride == null,
      last: lastFilterKm.get(eq.id) ?? null,
      currentMeter: currentKm,
    });

    // العدادات غير المطبقة تبقى محسوبة داخليًا لكنها لا تُعرض ولا تُطلق تنبيهًا
    if (!hoursApplicable) {
      oil = notApplicable(oil);
      filter = notApplicable(filter);
    }
    if (!kmApplicable) {
      oilKm = notApplicable(oilKm);
      filterKm = notApplicable(filterKm);
    }

    const oilState = resolveOilAlertState(oil, oilKm, effectiveMode, true);
    const filterDue = resolveFilterDue(filter, filterKm, effectiveMode);
    const status = resolveOverallStatus(oilState, filterDue, true);

    return {
      equipmentId: eq.id,
      code: eq.code,
      name: eq.name,
      projectName: eq.project?.name ?? null,
      categoryName: eq.category?.name ?? null,
      trackingMode: mode,
      trackingModeConfirmed: modeConfirmed,
      modeUnconfirmed: !modeConfirmed,
      currentMeter,
      currentKm,
      oil,
      oilKm,
      filter,
      filterKm,
      status,
      oilState,
      oilDueBy: resolveOilDueBy(oil, oilKm, effectiveMode),
      filterDue,
      filterAlert: resolveFilterAlert(oilState, filterDue),
      hoursDataMissing: hoursApplicable && oil.status === "UNKNOWN",
      kmDataMissing: kmApplicable && oilKm.status === "UNKNOWN",
    };
  });

  const summary = {
    oilAndFilter: 0,
    oil: 0,
    filter: 0,
    dueSoon: 0,
    safe: 0,
    unknown: 0,
    unconfirmed: 0,
    // قائمتا الزيت والفلتر: كل معدات الفلتر ضمن معدات الزيت
    oilDue: 0,
    filterDue: 0,
    total: rows.length,
  };
  for (const r of rows) {
    if (r.modeUnconfirmed) summary.unconfirmed++;
    if (r.status === "OIL_AND_FILTER") summary.oilAndFilter++;
    else if (r.status === "OIL") summary.oil++;
    else if (r.status === "FILTER") summary.filter++;
    else if (r.status === "DUE_SOON") summary.dueSoon++;
    else if (r.status === "SAFE") summary.safe++;
    else summary.unknown++;

    if (r.status === "OIL_AND_FILTER" || r.status === "OIL") summary.oilDue++;
    if (r.filterAlert) summary.filterDue++;
  }

  const order: Record<OverallStatus, number> = {
    OIL_AND_FILTER: 0,
    OIL: 1,
    FILTER: 2,
    DUE_SOON: 3,
    SAFE: 4,
    UNKNOWN: 5,
  };
  let filtered = rows;
  if (params.status === "MODE_UNCONFIRMED") {
    filtered = rows.filter((r) => r.modeUnconfirmed);
  } else if (params.status === "OIL_DUE") {
    filtered = rows.filter((r) => r.status === "OIL" || r.status === "OIL_AND_FILTER");
  } else if (params.status) {
    filtered = rows.filter((r) => r.status === params.status);
  }
  filtered.sort((a, b) => {
    const byStatus = order[a.status] - order[b.status];
    if (byStatus !== 0) return byStatus;
    const urgency = (r: EquipmentAlert) =>
      Math.min(
        ...[r.oil, r.oilKm, r.filter, r.filterKm].map((s) =>
          s.remaining == null ? Number.POSITIVE_INFINITY : s.remaining / s.interval
        )
      );
    const ra = urgency(a);
    const rb = urgency(b);
    if (ra !== rb) return ra - rb;
    return a.code.localeCompare(b.code);
  });

  return { rows: filtered, summary };
}

export async function parts() {
  const [schedules, grouped] = await Promise.all([
    prisma.partSchedule.findMany({ select: { partName: true } }),
    prisma.workPart.groupBy({ by: ["name"] }),
  ]);
  const set = new Set<string>();
  for (const s of schedules) set.add(s.partName.trim());
  for (const g of grouped) {
    const name = g.name.trim();
    if (name) set.add(name);
  }
  return { parts: [...set].sort((a, b) => a.localeCompare(b, "ar")) };
}
