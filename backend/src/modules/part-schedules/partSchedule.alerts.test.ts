import test from "node:test";
import assert from "node:assert/strict";
import {
  buildServiceHistory,
  computeService,
  resolveServiceStatus,
  resolveOverallStatus,
  resolveOilAlertState,
  resolveOilDueBy,
  resolveFilterDue,
  resolveFilterAlert,
  resolveEffectiveTrackingMode,
  isEngineOilPart,
  isOilFilterPart,
  isPeriodicMaintenance,
  FILTER_DEFAULT_INTERVAL,
  FILTER_KM_DEFAULT_INTERVAL,
  OIL_DEFAULT_INTERVAL,
  OIL_KM_DEFAULT_INTERVAL,
  type MaintenanceHistoryOrder,
  type MeterResetRecord,
  type OilAlertState,
  type ServiceAlert,
  type ServiceStatus,
  type TrackingMode,
} from "./partSchedule.service";
import { resolveTrackingSetup, UNCLASSIFIED_CATEGORY } from "../equipments/trackingMode";
import { isDecreasingReading } from "../../utils/meterReading";

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

function order(input: {
  equipmentId?: number;
  date: string;
  endDate?: string;
  maintenanceType?: string | null;
  meterReading?: number;
  kmMeter?: number;
  parts?: string[];
}): MaintenanceHistoryOrder {
  return {
    equipmentId: input.equipmentId ?? 1,
    date: d(input.date),
    endDate: input.endDate ? d(input.endDate) : null,
    maintenanceType: input.maintenanceType === undefined ? "صيانة دورية" : input.maintenanceType,
    meterReading: input.meterReading ?? null,
    kmMeter: input.kmMeter ?? null,
    workParts: (input.parts ?? ["زيت محرك"]).map((name) => ({ name })),
  };
}

function reset(input: {
  equipmentId?: number;
  date: string;
  hours?: number;
  km?: number;
}): MeterResetRecord {
  return {
    equipmentId: input.equipmentId ?? 1,
    date: d(input.date),
    hours: input.hours ?? null,
    km: input.km ?? null,
  };
}

function service(
  status: ServiceStatus,
  interval = OIL_DEFAULT_INTERVAL,
  remaining: number | null = null
): ServiceAlert {
  return {
    interval,
    isDefault: true,
    lastDate: remaining == null ? null : "2026-01-01",
    lastMeter: remaining == null ? null : 1000,
    elapsed: remaining == null ? null : interval - remaining,
    remaining,
    percent: remaining == null ? null : Math.round(((interval - remaining) / interval) * 10000) / 100,
    status,
  };
}

/** Build an alert with an exact remaining value and its matching status. */
function remaining(
  remainingValue: number,
  interval = OIL_DEFAULT_INTERVAL,
  statusOverride?: ServiceStatus
): ServiceAlert {
  const elapsed = interval - remainingValue;
  const rawPercent = (elapsed / interval) * 100;
  const percent = Math.round(rawPercent * 100) / 100;
  const status: ServiceStatus = statusOverride ?? resolveServiceStatus(percent);
  return {
    interval,
    isDefault: true,
    lastDate: "2026-01-01",
    lastMeter: 1000,
    elapsed,
    remaining: remainingValue,
    percent,
    status,
  };
}

const atPercent = (percent: number, interval = OIL_DEFAULT_INTERVAL) =>
  computeService({
    interval,
    isDefault: true,
    last: { date: d("2026-01-01"), meter: 1000 },
    currentMeter: 1000 + (interval * percent) / 100,
  });

const missing = (interval: number) => service("UNKNOWN", interval);
const notApplicable = (interval = OIL_KM_DEFAULT_INTERVAL) =>
  service("NOT_APPLICABLE", interval, null);

const elapsedService = (interval: number, elapsed: number) =>
  computeService({
    interval,
    isDefault: true,
    last: { date: d("2026-01-01"), meter: 1000 },
    currentMeter: 1000 + elapsed,
  });

function oilAt(hours: number, km: number) {
  const date = d("2026-01-01");
  return {
    hours: computeService({
      interval: OIL_DEFAULT_INTERVAL,
      isDefault: true,
      last: { date, meter: 1000 },
      currentMeter: 1000 + hours,
    }),
    km: computeService({
      interval: OIL_KM_DEFAULT_INTERVAL,
      isDefault: true,
      last: { date, meter: 50000 },
      currentMeter: 50000 + km,
    }),
  };
}

const state = (
  hoursRemaining: number,
  kmRemaining: number | null,
  mode: TrackingMode = "BOTH",
  confirmed = true
) =>
  resolveOilAlertState(
    remaining(hoursRemaining),
    kmRemaining == null ? missing(OIL_KM_DEFAULT_INTERVAL) : remaining(kmRemaining, OIL_KM_DEFAULT_INTERVAL),
    mode,
    confirmed
  );

test("boundary table: 89.9% / 90% / 100% / 100.1%", () => {
  const cases: { percent: number; expected: ServiceStatus }[] = [
    { percent: 89.9, expected: "SAFE" },
    { percent: 90, expected: "DUE_SOON" },
    { percent: 100, expected: "DUE" },
    { percent: 100.1, expected: "OVERDUE" },
  ];

  for (const { percent, expected } of cases) {
    assert.equal(atPercent(percent).percent, percent);
    assert.equal(atPercent(percent).status, expected);
    assert.equal(atPercent(percent, OIL_KM_DEFAULT_INTERVAL).status, expected);
    assert.equal(atPercent(percent, FILTER_DEFAULT_INTERVAL).status, expected);
    assert.equal(atPercent(percent, FILTER_KM_DEFAULT_INTERVAL).status, expected);
  }
});

test("status follows the displayed two-decimal percentage at rounding edges", () => {
  const cases: { raw: number; displayed: number; expected: ServiceStatus }[] = [
    { raw: 89.994, displayed: 89.99, expected: "SAFE" },
    { raw: 89.996, displayed: 90, expected: "DUE_SOON" },
    { raw: 99.994, displayed: 99.99, expected: "DUE_SOON" },
    { raw: 99.996, displayed: 100, expected: "DUE" },
    { raw: 100.004, displayed: 100, expected: "DUE" },
    { raw: 100.006, displayed: 100.01, expected: "OVERDUE" },
  ];

  for (const { raw, displayed, expected } of cases) {
    const result = atPercent(raw);
    assert.equal(result.percent, displayed);
    assert.equal(result.status, expected);
  }
});

test("HOURS mode: safe below 90%, near at 90%, due at 150 hours, overdue after", () => {
  assert.equal(elapsedService(OIL_DEFAULT_INTERVAL, 134).status, "SAFE");
  assert.equal(elapsedService(OIL_DEFAULT_INTERVAL, 135).status, "DUE_SOON");
  assert.equal(elapsedService(OIL_DEFAULT_INTERVAL, 149).status, "DUE_SOON");
  assert.equal(elapsedService(OIL_DEFAULT_INTERVAL, 150).status, "DUE");
  assert.equal(elapsedService(OIL_DEFAULT_INTERVAL, 151).status, "OVERDUE");

  assert.equal(
    resolveOilAlertState(elapsedService(OIL_DEFAULT_INTERVAL, 134), notApplicable(), "HOURS"),
    "OK"
  );
  assert.equal(
    resolveOilAlertState(elapsedService(OIL_DEFAULT_INTERVAL, 135), notApplicable(), "HOURS"),
    "HOURS_DUE_SOON"
  );
  assert.equal(
    resolveOilAlertState(elapsedService(OIL_DEFAULT_INTERVAL, 150), notApplicable(), "HOURS"),
    "HOURS_DUE"
  );
  assert.equal(
    resolveOilAlertState(elapsedService(OIL_DEFAULT_INTERVAL, 151), notApplicable(), "HOURS"),
    "HOURS_OVERDUE"
  );
});

test("KM mode: safe below 90%, near at 90%, due at 10,000 km, overdue after", () => {
  assert.equal(elapsedService(OIL_KM_DEFAULT_INTERVAL, 8_999).status, "SAFE");
  assert.equal(elapsedService(OIL_KM_DEFAULT_INTERVAL, 9_000).status, "DUE_SOON");
  assert.equal(elapsedService(OIL_KM_DEFAULT_INTERVAL, 9_999).status, "DUE_SOON");
  assert.equal(elapsedService(OIL_KM_DEFAULT_INTERVAL, 10_000).status, "DUE");
  assert.equal(elapsedService(OIL_KM_DEFAULT_INTERVAL, 10_001).status, "OVERDUE");

  assert.equal(
    resolveOilAlertState(notApplicable(), elapsedService(OIL_KM_DEFAULT_INTERVAL, 8_999), "KM"),
    "OK"
  );
  assert.equal(
    resolveOilAlertState(notApplicable(), elapsedService(OIL_KM_DEFAULT_INTERVAL, 9_000), "KM"),
    "KM_DUE_SOON"
  );
  assert.equal(
    resolveOilAlertState(notApplicable(), elapsedService(OIL_KM_DEFAULT_INTERVAL, 10_000), "KM"),
    "KM_DUE"
  );
  assert.equal(
    resolveOilAlertState(notApplicable(), elapsedService(OIL_KM_DEFAULT_INTERVAL, 10_001), "KM"),
    "KM_OVERDUE"
  );
});

test("filter intervals: 300 hours and 20,000 km with 90% warning", () => {
  assert.equal(elapsedService(FILTER_DEFAULT_INTERVAL, 269).status, "SAFE");
  assert.equal(elapsedService(FILTER_DEFAULT_INTERVAL, 270).status, "DUE_SOON");
  assert.equal(elapsedService(FILTER_DEFAULT_INTERVAL, 299).status, "DUE_SOON");
  assert.equal(elapsedService(FILTER_DEFAULT_INTERVAL, 300).status, "DUE");
  assert.equal(elapsedService(FILTER_DEFAULT_INTERVAL, 301).status, "OVERDUE");

  assert.equal(elapsedService(FILTER_KM_DEFAULT_INTERVAL, 17_998).status, "SAFE");
  // 17,999 / 20,000 = 89.995% وتُعرض 90.00% بعد التقريب، فلا تكون «سليم»
  assert.equal(elapsedService(FILTER_KM_DEFAULT_INTERVAL, 17_999).status, "DUE_SOON");
  assert.equal(elapsedService(FILTER_KM_DEFAULT_INTERVAL, 18_000).status, "DUE_SOON");
  assert.equal(elapsedService(FILTER_KM_DEFAULT_INTERVAL, 19_998).status, "DUE_SOON");
  // 19,999 / 20,000 = 99.995% وتُعرض 100.00% بعد التقريب، فلا تكون «أوشكت»
  assert.equal(elapsedService(FILTER_KM_DEFAULT_INTERVAL, 19_999).status, "DUE");
  assert.equal(elapsedService(FILTER_KM_DEFAULT_INTERVAL, 20_000).status, "DUE");
  assert.equal(elapsedService(FILTER_KM_DEFAULT_INTERVAL, 20_001).status, "OVERDUE");
});

test("BOTH mode uses the larger percentage and reports the causing limit", () => {
  const hoursDue = oilAt(150, 6_000);
  assert.equal(hoursDue.hours.remaining, 0);
  assert.equal(resolveOilAlertState(hoursDue.hours, hoursDue.km, "BOTH"), "HOURS_DUE");
  assert.equal(resolveOilDueBy(hoursDue.hours, hoursDue.km, "BOTH"), "HOURS");

  const kmDue = oilAt(100, 10_000);
  assert.equal(kmDue.km.remaining, 0);
  assert.equal(resolveOilAlertState(kmDue.hours, kmDue.km, "BOTH"), "KM_DUE");
  assert.equal(resolveOilDueBy(kmDue.hours, kmDue.km, "BOTH"), "KM");

  const safe = oilAt(120, 8_000);
  assert.equal(resolveOilAlertState(safe.hours, safe.km, "BOTH"), "OK");

  const bothOverdue = oilAt(151, 10_001);
  assert.equal(resolveOilAlertState(bothOverdue.hours, bothOverdue.km, "BOTH"), "BOTH_OVERDUE");
  assert.equal(resolveOilDueBy(bothOverdue.hours, bothOverdue.km, "BOTH"), "HOURS");

  const hoursOverdue = oilAt(151, 4_000);
  assert.equal(resolveOilAlertState(hoursOverdue.hours, hoursOverdue.km, "BOTH"), "HOURS_OVERDUE");

  const kmOverdue = oilAt(100, 10_001);
  assert.equal(resolveOilAlertState(kmOverdue.hours, kmOverdue.km, "BOTH"), "KM_OVERDUE");

  assert.equal(state(0, 0), "BOTH_DUE");

  const hoursNear = oilAt(140, 8_500);
  assert.equal(
    resolveOilAlertState(hoursNear.hours, hoursNear.km, "BOTH"),
    "HOURS_DUE_SOON"
  );
  assert.equal(resolveOilDueBy(hoursNear.hours, hoursNear.km, "BOTH"), "HOURS");

  const kmNear = oilAt(140, 9_500);
  assert.equal(resolveOilAlertState(kmNear.hours, kmNear.km, "BOTH"), "KM_DUE_SOON");
  assert.equal(resolveOilDueBy(kmNear.hours, kmNear.km, "BOTH"), "KM");

  const bothNear = oilAt(135, 9_000);
  assert.equal(resolveOilAlertState(bothNear.hours, bothNear.km, "BOTH"), "BOTH_DUE_SOON");
  assert.equal(resolveOilDueBy(bothNear.hours, bothNear.km, "BOTH"), "BOTH");
});

test("missing required data is VERIFY, never assumed zero; overdue still wins in BOTH", () => {
  assert.equal(resolveOilAlertState(missing(150), missing(10_000), "BOTH"), "VERIFY_DATA");
  assert.equal(resolveOilAlertState(missing(150), remaining(0, 10_000), "BOTH"), "VERIFY_DATA");
  assert.equal(resolveOilAlertState(remaining(0), missing(10_000), "BOTH"), "VERIFY_DATA");
  assert.equal(resolveOilAlertState(remaining(45), missing(10_000), "BOTH"), "VERIFY_DATA");

  // عداد صالح واحد يستحق فعلًا يكفي لإظهار التنبيه
  assert.equal(resolveOilAlertState(missing(150), remaining(-1, 10_000), "BOTH"), "KM_OVERDUE");
  assert.equal(resolveOilAlertState(remaining(-12), missing(10_000), "BOTH"), "HOURS_OVERDUE");
});

test("each mode ignores the meter it does not use", () => {
  assert.equal(resolveOilAlertState(remaining(30), missing(10_000), "HOURS"), "OK");
  assert.equal(resolveOilAlertState(remaining(10), missing(10_000), "HOURS"), "HOURS_DUE_SOON");
  assert.equal(resolveOilAlertState(remaining(0), missing(10_000), "HOURS"), "HOURS_DUE");
  assert.equal(resolveOilAlertState(missing(150), remaining(9_000, 10_000), "KM"), "OK");
  assert.equal(resolveOilAlertState(missing(150), remaining(1_000, 10_000), "KM"), "KM_DUE_SOON");
  assert.equal(resolveOilAlertState(missing(150), remaining(0, 10_000), "KM"), "KM_DUE");
  assert.equal(resolveOilAlertState(missing(150), missing(10_000), "KM"), "VERIFY_DATA");

  assert.equal(resolveOilDueBy(remaining(0), notApplicable(), "HOURS"), "HOURS");
  assert.equal(resolveOilDueBy(remaining(10), notApplicable(), "HOURS"), "HOURS");
  assert.equal(resolveOilDueBy(remaining(30), notApplicable(), "HOURS"), null);
  assert.equal(resolveOilDueBy(remaining(30), remaining(-1, 10_000), "HOURS"), null);
  assert.equal(resolveOilDueBy(remaining(-1), remaining(5_000, 10_000), "KM"), null);
  assert.equal(resolveOilDueBy(remaining(1_000), remaining(0, 10_000), "KM"), "KM");
  assert.equal(resolveOilDueBy(remaining(30), remaining(0, 10_000), "KM"), "KM");
  assert.equal(resolveOilDueBy(remaining(10), remaining(1_000, 10_000), "BOTH"), "HOURS");
  assert.equal(resolveOilDueBy(remaining(30), remaining(1_000, 10_000), "BOTH"), "KM");
  assert.equal(resolveOilDueBy(remaining(0), remaining(0, 10_000), "BOTH"), "BOTH");
});

test("an unconfirmed tracking mode disables alerts", () => {
  assert.equal(state(0, 0, "BOTH", false), "MODE_UNCONFIRMED");
  assert.equal(state(30, 5_000, "HOURS", false), "MODE_UNCONFIRMED");
  assert.equal(resolveOverallStatus("MODE_UNCONFIRMED", true, false), "UNKNOWN");
  assert.equal(resolveFilterAlert("MODE_UNCONFIRMED", true), false);
});

test("imported equipment falls back to the meter that actually has readings", () => {
  assert.equal(resolveEffectiveTrackingMode("BOTH", false, true, true), "HOURS");
  assert.equal(resolveEffectiveTrackingMode("BOTH", false, true, false), "HOURS");
  assert.equal(resolveEffectiveTrackingMode("BOTH", false, false, true), "KM");
  assert.equal(resolveEffectiveTrackingMode("BOTH", false, false, false), "BOTH");
  assert.equal(resolveEffectiveTrackingMode("KM", true, true, true), "KM");
});

test("overall labels keep the filter as an oil subset with no standalone filter status", () => {
  const cases: { state: OilAlertState; filterDue: boolean; expected: string }[] = [
    { state: "OK", filterDue: false, expected: "SAFE" },
    { state: "OK", filterDue: true, expected: "SAFE" },
    { state: "HOURS_DUE_SOON", filterDue: false, expected: "DUE_SOON" },
    { state: "KM_DUE_SOON", filterDue: true, expected: "DUE_SOON" },
    { state: "BOTH_DUE_SOON", filterDue: false, expected: "DUE_SOON" },
    { state: "HOURS_DUE", filterDue: false, expected: "OIL" },
    { state: "HOURS_DUE", filterDue: true, expected: "OIL_AND_FILTER" },
    { state: "KM_OVERDUE", filterDue: true, expected: "OIL_AND_FILTER" },
    { state: "VERIFY_DATA", filterDue: true, expected: "UNKNOWN" },
    { state: "MODE_UNCONFIRMED", filterDue: true, expected: "UNKNOWN" },
  ];
  for (const c of cases) {
    assert.equal(
      resolveOverallStatus(c.state, c.filterDue, c.state !== "MODE_UNCONFIRMED"),
      c.expected
    );
  }
});

test("filter due is mode-aware, starts at 100%, and stays a subset of oil due", () => {
  const filterSafe = remaining(45, FILTER_DEFAULT_INTERVAL);
  const filterNear = remaining(30, FILTER_DEFAULT_INTERVAL);
  const filterHoursDue = remaining(0, FILTER_DEFAULT_INTERVAL);
  const filterKmSafe = remaining(5_000, FILTER_KM_DEFAULT_INTERVAL);
  const filterKmNear = remaining(2_000, FILTER_KM_DEFAULT_INTERVAL);
  const filterKmDue = remaining(0, FILTER_KM_DEFAULT_INTERVAL);

  assert.equal(resolveFilterDue(filterNear, filterKmSafe, "HOURS"), false);
  assert.equal(resolveFilterDue(filterHoursDue, filterKmSafe, "HOURS"), true);
  assert.equal(resolveFilterDue(filterSafe, filterKmDue, "HOURS"), false);
  assert.equal(resolveFilterDue(filterHoursDue, filterKmSafe, "KM"), false);
  assert.equal(resolveFilterDue(filterSafe, filterKmNear, "KM"), false);
  assert.equal(resolveFilterDue(filterSafe, filterKmDue, "KM"), true);
  assert.equal(resolveFilterDue(filterHoursDue, filterKmSafe, "BOTH"), true);
  assert.equal(resolveFilterDue(filterSafe, filterKmDue, "BOTH"), true);
  assert.equal(resolveFilterDue(filterSafe, filterKmSafe, "BOTH"), false);

  assert.equal(resolveFilterAlert("OK", true), false);
  assert.equal(resolveFilterAlert("VERIFY_DATA", true), false);
  assert.equal(resolveFilterAlert("MODE_UNCONFIRMED", true), false);
  assert.equal(resolveFilterAlert("HOURS_DUE_SOON", true), false);
  assert.equal(resolveFilterAlert("HOURS_DUE", false), false);
  assert.equal(resolveFilterAlert("HOURS_DUE", true), true);
});

test("filter pending never appears without an oil alert in any state", () => {
  const states: OilAlertState[] = [
    "MODE_UNCONFIRMED",
    "VERIFY_DATA",
    "BOTH_OVERDUE",
    "HOURS_OVERDUE",
    "KM_OVERDUE",
    "BOTH_DUE",
    "HOURS_DUE",
    "KM_DUE",
    "BOTH_DUE_SOON",
    "HOURS_DUE_SOON",
    "KM_DUE_SOON",
    "OK",
  ];
  const alerting = new Set<OilAlertState>([
    "BOTH_OVERDUE",
    "HOURS_OVERDUE",
    "KM_OVERDUE",
    "BOTH_DUE",
    "HOURS_DUE",
    "KM_DUE",
  ]);
  for (const oilState of states) {
    assert.equal(resolveFilterAlert(oilState, true), alerting.has(oilState));
  }
});

test("missing baseline stays UNKNOWN and is flagged, never zero", () => {
  const missingBaseline = computeService({
    interval: OIL_KM_DEFAULT_INTERVAL,
    isDefault: true,
    last: { date: d("2026-01-01"), meter: null },
    currentMeter: 60_000,
  });
  assert.equal(missingBaseline.status, "UNKNOWN");
  assert.equal(missingBaseline.elapsed, null);
  assert.equal(missingBaseline.remaining, null);

  const missingCurrent = computeService({
    interval: OIL_KM_DEFAULT_INTERVAL,
    isDefault: true,
    last: { date: d("2026-01-01"), meter: 50_000 },
    currentMeter: null,
  });
  assert.equal(missingCurrent.status, "UNKNOWN");
  assert.equal(missingCurrent.elapsed, null);

  const history = buildServiceHistory([order({ date: "2026-01-01", meterReading: 1000 })]);
  assert.equal(history.lastOilKm.get(1)?.meter, null);
  const oilKm = computeService({
    interval: OIL_KM_DEFAULT_INTERVAL,
    isDefault: true,
    last: history.lastOilKm.get(1) ?? null,
    currentMeter: 55_000,
  });
  assert.equal(oilKm.status, "UNKNOWN");
  assert.equal(resolveOverallStatus(resolveOilAlertState(remaining(45), oilKm, "BOTH"), false), "UNKNOWN");
});

test("category tracking mode is inherited and can be overridden per item", () => {
  const loader = { name: "لودر", defaultTrackingMode: "HOURS" as const };
  const grader = { name: "جريدر", defaultTrackingMode: "BOTH" as const };

  assert.deepEqual(resolveTrackingSetup({ category: loader }), {
    trackingMode: "HOURS",
    trackingModeOverridden: false,
    trackingModeConfirmed: true,
  });
  assert.deepEqual(resolveTrackingSetup({ category: grader }), {
    trackingMode: "BOTH",
    trackingModeOverridden: false,
    trackingModeConfirmed: true,
  });
  assert.deepEqual(resolveTrackingSetup({ category: loader, explicitMode: "KM" }), {
    trackingMode: "KM",
    trackingModeOverridden: true,
    trackingModeConfirmed: true,
  });
  assert.deepEqual(
    resolveTrackingSetup({ category: grader, explicitMode: "BOTH", explicitConfirmed: false }),
    {
      trackingMode: "BOTH",
      trackingModeOverridden: true,
      trackingModeConfirmed: false,
    }
  );
  assert.deepEqual(
    resolveTrackingSetup({
      category: { name: UNCLASSIFIED_CATEGORY, defaultTrackingMode: "BOTH" },
    }),
    {
      trackingMode: "BOTH",
      trackingModeOverridden: false,
      trackingModeConfirmed: false,
    }
  );
});

test("decreasing readings are rejected unless an explicit reset happened between", () => {
  assert.equal(isDecreasingReading(90, 100, false), true);
  assert.equal(isDecreasingReading(90, 100, true), false);
  assert.equal(isDecreasingReading(100, 100, false), false);
  assert.equal(isDecreasingReading(110, 100, false), false);
  assert.equal(isDecreasingReading(0, null, false), false);
});

test("decreasing meter readings never produce negative elapsed", () => {
  const hours = computeService({
    interval: OIL_DEFAULT_INTERVAL,
    isDefault: true,
    last: { date: d("2026-01-01"), meter: 5000 },
    currentMeter: 4900,
  });
  assert.equal(hours.elapsed, 0);
  assert.equal(hours.remaining, OIL_DEFAULT_INTERVAL);
  assert.equal(hours.status, "SAFE");

  const km = computeService({
    interval: OIL_KM_DEFAULT_INTERVAL,
    isDefault: true,
    last: { date: d("2026-01-01"), meter: 60_000 },
    currentMeter: 59_000,
  });
  assert.equal(km.elapsed, 0);
  assert.equal(km.remaining, OIL_KM_DEFAULT_INTERVAL);
  assert.equal(km.status, "SAFE");
});

test("a periodic oil-only change resets oil hours and km, not the filter", () => {
  const history = buildServiceHistory([
    order({ date: "2026-01-01", meterReading: 1000, kmMeter: 50_000 }),
  ]);
  assert.equal(history.lastOilHours.get(1)?.meter, 1000);
  assert.equal(history.lastOilKm.get(1)?.meter, 50_000);
  assert.equal(history.lastFilter.has(1), false);
  assert.equal(history.lastFilterKm.has(1), false);
});

test("oil changes never reset the filter; only a recorded filter does", () => {
  const history = buildServiceHistory([
    order({
      date: "2026-01-01",
      meterReading: 1000,
      kmMeter: 50_000,
      parts: ["زيت محرك", "فلتر زيت"],
    }),
    order({ date: "2026-01-10", meterReading: 1150, kmMeter: 56_000, parts: ["زيت محرك"] }),
  ]);
  assert.equal(history.lastOilHours.get(1)?.meter, 1150);
  assert.equal(history.lastOilKm.get(1)?.meter, 56_000);
  assert.equal(history.lastFilter.get(1)?.meter, 1000);
  assert.equal(history.lastFilterKm.get(1)?.meter, 50_000);

  const filterHours = computeService({
    interval: FILTER_DEFAULT_INTERVAL,
    isDefault: true,
    last: history.lastFilter.get(1) ?? null,
    currentMeter: 1150,
  });
  assert.equal(filterHours.elapsed, 150);
  assert.equal(filterHours.status, "SAFE");

  const filterKm = computeService({
    interval: FILTER_KM_DEFAULT_INTERVAL,
    isDefault: true,
    last: history.lastFilterKm.get(1) ?? null,
    currentMeter: 56_000,
  });
  assert.equal(filterKm.elapsed, 6_000);
  assert.equal(filterKm.status, "SAFE");
});

test("an explicit oil-plus-filter operation resets oil and filter on both meters", () => {
  const history = buildServiceHistory([
    order({
      date: "2026-01-01",
      meterReading: 1200,
      kmMeter: 52_000,
      parts: ["زيت محرك", "فلتر زيت"],
    }),
  ]);
  assert.equal(history.lastOilHours.get(1)?.meter, 1200);
  assert.equal(history.lastOilKm.get(1)?.meter, 52_000);
  assert.equal(history.lastFilter.get(1)?.meter, 1200);
  assert.equal(history.lastFilterKm.get(1)?.meter, 52_000);
});

test("same-day oil and filter orders are one service event", () => {
  const history = buildServiceHistory([
    order({ date: "2026-01-01", meterReading: 1300, kmMeter: 53_000, parts: ["زيت محرك"] }),
    order({ date: "2026-01-01", meterReading: 1300, kmMeter: 53_000, parts: ["فلتر زيت"] }),
  ]);
  assert.equal(history.lastOilHours.get(1)?.meter, 1300);
  assert.equal(history.lastOilKm.get(1)?.meter, 53_000);
  assert.equal(history.lastFilter.get(1)?.meter, 1300);
  assert.equal(history.lastFilterKm.get(1)?.meter, 53_000);
});

test("a same-day filter reading does not overwrite the oil baseline", () => {
  const history = buildServiceHistory([
    order({ date: "2026-10-13", meterReading: 1928, kmMeter: 222, parts: ["زيت محرك"] }),
    order({ date: "2026-10-13", meterReading: 1590, kmMeter: 222, parts: ["فلتر محرك"] }),
  ]);
  assert.equal(history.lastOilHours.get(1)?.meter, 1928);
  assert.equal(history.lastOilKm.get(1)?.meter, 222);
  assert.equal(history.lastFilter.get(1)?.meter, 1590);
  assert.equal(history.lastFilterKm.get(1)?.meter, 222);
});

test("same-day duplicate events from repeated sync are counted once", () => {
  const history = buildServiceHistory([
    order({ date: "2026-01-01", meterReading: 1000, kmMeter: 50_000 }),
    order({ date: "2026-01-01", meterReading: 1000, kmMeter: 50_000 }),
  ]);
  assert.equal(history.lastOilHours.get(1)?.meter, 1000);
  assert.equal(history.lastOilKm.get(1)?.meter, 50_000);
  assert.equal(history.lastFilter.has(1), false);
});

test("filter-only part is treated as oil plus filter, never alone", () => {
  const history = buildServiceHistory([
    order({ date: "2026-01-01", meterReading: 2000, kmMeter: 60_000, parts: ["فلتر زيت"] }),
  ]);
  assert.equal(history.lastOilHours.get(1)?.meter, 2000);
  assert.equal(history.lastOilKm.get(1)?.meter, 60_000);
  assert.equal(history.lastFilter.get(1)?.meter, 2000);
  assert.equal(history.lastFilterKm.get(1)?.meter, 60_000);
});

test("an explicit meter reset re-baselines the affected meters, including filter", () => {
  const history = buildServiceHistory(
    [
      order({
        date: "2026-01-01",
        meterReading: 1000,
        kmMeter: 50_000,
        parts: ["زيت محرك", "فلتر زيت"],
      }),
      order({ date: "2026-01-10", meterReading: 1150, kmMeter: 56_000, parts: ["زيت محرك"] }),
    ],
    [reset({ date: "2026-02-01", hours: 0, km: 0 })]
  );

  assert.equal(history.lastOilHours.get(1)?.meter, 0);
  assert.equal(history.lastOilKm.get(1)?.meter, 0);
  assert.equal(history.lastFilter.get(1)?.meter, 0);
  assert.equal(history.lastFilterKm.get(1)?.meter, 0);

  const afterService = buildServiceHistory(
    [order({ date: "2026-03-01", meterReading: 30, kmMeter: 500 })],
    [reset({ date: "2026-02-01", hours: 0, km: 0 })]
  );
  assert.equal(afterService.lastOilHours.get(1)?.meter, 30);
  assert.equal(afterService.lastOilKm.get(1)?.meter, 500);
});

test("a hours-only reset leaves the km baselines untouched", () => {
  const history = buildServiceHistory(
    [
      order({
        date: "2026-01-01",
        meterReading: 1000,
        kmMeter: 50_000,
        parts: ["زيت محرك", "فلتر زيت"],
      }),
    ],
    [reset({ date: "2026-02-01", hours: 0 })]
  );
  assert.equal(history.lastOilHours.get(1)?.meter, 0);
  assert.equal(history.lastFilter.get(1)?.meter, 0);
  assert.equal(history.lastOilKm.get(1)?.meter, 50_000);
  assert.equal(history.lastFilterKm.get(1)?.meter, 50_000);
});

test("non-periodic orders never reset counters", () => {
  const history = buildServiceHistory([
    order({
      date: "2026-01-01",
      meterReading: 1000,
      kmMeter: 50_000,
      maintenanceType: "صيانة أعطال",
    }),
    order({
      date: "2026-01-02",
      meterReading: 1100,
      kmMeter: 51_000,
      maintenanceType: null,
    }),
  ]);
  assert.equal(history.lastOilHours.size, 0);
  assert.equal(history.lastFilter.size, 0);
  assert.equal(history.lastFilterKm.size, 0);
});

test("hydraulic oil, transmission oil, air and fuel filters are excluded", () => {
  const history = buildServiceHistory([
    order({ date: "2026-01-01", meterReading: 1000, parts: ["زيت هيدروليك"] }),
    order({ date: "2026-01-02", meterReading: 1100, parts: ["زيت فتيس"] }),
    order({ date: "2026-01-03", meterReading: 1200, parts: ["فلتر هواء"] }),
    order({ date: "2026-01-04", meterReading: 1300, parts: ["فلتر ديزل"] }),
    order({ date: "2026-01-05", meterReading: 1400, parts: ["فلتر فاصل"] }),
  ]);
  assert.equal(history.lastOilHours.size, 0);
  assert.equal(history.lastFilter.size, 0);
  assert.equal(history.lastFilterKm.size, 0);
});

test("end date takes precedence when recording the service date", () => {
  const history = buildServiceHistory([
    order({ date: "2026-01-01", endDate: "2026-01-05", meterReading: 1000, kmMeter: 50_000 }),
  ]);
  assert.equal(history.lastOilHours.get(1)?.date.toISOString().slice(0, 10), "2026-01-05");
});

test("viewing an alert or rebuilding history does not change counters", () => {
  const input = {
    interval: OIL_DEFAULT_INTERVAL,
    isDefault: true,
    last: { date: d("2026-01-01"), meter: 1000 },
    currentMeter: 1160,
  };
  const first = computeService(input);
  const second = computeService(input);
  assert.deepEqual(second, first);

  const orders = [
    order({
      date: "2026-01-01",
      meterReading: 1000,
      kmMeter: 50_000,
      parts: ["زيت محرك", "فلتر زيت"],
    }),
  ];
  const a = buildServiceHistory(orders);
  const b = buildServiceHistory(orders);
  assert.equal(a.lastOilHours.get(1)?.meter, b.lastOilHours.get(1)?.meter);
  assert.equal(a.lastFilter.get(1)?.meter, b.lastFilter.get(1)?.meter);
  assert.equal(a.lastFilterKm.get(1)?.meter, b.lastFilterKm.get(1)?.meter);
});

test("part and maintenance classification", () => {
  assert.equal(isEngineOilPart("زيت محرك"), true);
  assert.equal(isEngineOilPart("زيت المحرك"), true);
  assert.equal(isEngineOilPart("زيت ماتور"), true);
  assert.equal(isEngineOilPart("زيت هيدروليك"), false);
  assert.equal(isEngineOilPart("زيت فتيس"), false);

  assert.equal(isOilFilterPart("فلتر زيت"), true);
  assert.equal(isOilFilterPart("فلتر محرك"), true);
  assert.equal(isOilFilterPart("فلتر زيت هيدروليك"), false);
  assert.equal(isOilFilterPart("فلتر هواء"), false);
  assert.equal(isOilFilterPart("فلتر ديزل"), false);
  assert.equal(isOilFilterPart("فاصل زيت"), false);

  assert.equal(isPeriodicMaintenance("صيانة دورية"), true);
  assert.equal(isPeriodicMaintenance("صيانة دوريه"), true);
  assert.equal(isPeriodicMaintenance("صيانة أعطال"), false);
  assert.equal(isPeriodicMaintenance(null), false);
});
