import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Loader2,
  Search,
  HardHat,
  Droplets,
  Filter,
  CalendarDays,
  AlertTriangle,
  Printer,
  X,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Gauge,
  RotateCcw,
  Settings2,
} from "lucide-react";
import {
  cn,
  todayLocal,
  SERVICE_STATUS_LABELS,
  SERVICE_STATUS_CLS,
  MAINT_STATUS_LABELS,
  CONDITION_LABELS,
  OIL_ALERT_STATE_LABELS,
  OIL_ALERT_STATE_CLS,
  TRACKING_MODE_LABELS,
  TRACKING_MODE_CLS,
  trackingModeAppliesHours,
  trackingModeAppliesKm,
} from "@/lib/utils";
import { getApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { DailyLog, Equipment, EquipmentCategory, Fault, Maintenance, PartSchedule, TrackingMode } from "@/types";
import {
  lookupEquipment,
  listEquipments,
  syncEquipmentsFromManagers,
  updateEquipment,
  listMeterResets,
  createMeterReset,
  listCategories,
  listAssignments,
  type MeterReset,
  type EquipmentAssignment,
} from "@/services/equipments";
import { projectOptions } from "@/services/projects";
import {
  getPartAlerts,
  listPartSchedules,
  type EquipmentAlert,
  type ServiceAlert,
} from "@/services/partSchedules";
import { listDailyLogs } from "@/services/dailylogs";
import { listMaintenance } from "@/services/maintenance";
import { listFaults } from "@/services/faults";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const thCls =
  "px-3 py-2 text-right text-xs font-bold text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap";
const tdCls = "px-3 py-2 text-[13px] text-slate-700 border-b border-slate-100";

type TabKey = "overview" | "oil" | "parts" | "day" | "faults";

const TABS: { key: TabKey; label: string; icon: typeof Droplets }[] = [
  { key: "overview", label: "نظرة عامة", icon: HardHat },
  { key: "oil", label: "الزيوت والفلاتر", icon: Droplets },
  { key: "parts", label: "أصناف الصيانة", icon: Filter },
  { key: "day", label: "السراكي", icon: CalendarDays },
  { key: "faults", label: "الأعطال", icon: AlertTriangle },
];

const day = (s?: string | null) => (s ? s.slice(0, 10) : "—");
const num = (n?: number | null) => (n == null ? "—" : String(n));
const numUnit = (n: number | null | undefined, unit: string) => (n == null ? "—" : `${n} ${unit}`);

interface DetailData {
  schedules: PartSchedule[];
  daily: { data: DailyLog[]; total: number };
  maints: Maintenance[];
  faults: { data: Fault[]; total: number };
  resets: MeterReset[];
  assignments: EquipmentAssignment[];
}

export default function EquipmentPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Equipment[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const canSync = user?.role === "ROOT" || user?.role === "ADMIN";

  const [selected, setSelected] = useState<Equipment | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<EquipmentAlert | undefined>();

  const [resetDate, setResetDate] = useState(todayLocal());
  const [resetHours, setResetHours] = useState("");
  const [resetKm, setResetKm] = useState("");
  const [resetNotes, setResetNotes] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);

  const [rows, setRows] = useState<Equipment[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [rowsPage, setRowsPage] = useState(1);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [projectFilter, setProjectFilter] = useState<number | "">("");
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const ROWS_PAGE_SIZE = 20;

  const handleSync = async () => {
    if (!window.confirm("جلب المعدات ومشاريعها من نظام المدرين وتحديث سجل المعدات هنا؟")) return;
    setSyncing(true);
    try {
      const r = await syncEquipmentsFromManagers();
      const projNames = r.projects.map((p) => p.name).join("، ");
      toast.success(
        `تمت المزامنة: ${r.fetched} سجل — جديد ${r.created}، مُحدّث ${r.updated}، بدون تغيير ${r.unchanged}` +
          (projNames ? ` — مشاريع: ${projNames}` : "") +
          (r.sectors ? ` — قطاعات: ${r.sectors}` : "")
      );
      if (r.errors.length) {
        toast.error(
          `اتخطى ${r.errors.length} سجل — أول خطأ: ${r.errors[0].code ?? "?"}: ${r.errors[0].message}`
        );
      }
      setRowsPage(1);
      setReloadTick((t) => t + 1);
      projectOptions()
        .then(setProjects)
        .catch(() => {});
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    projectOptions()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!canSync) return;
    listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [canSync]);

  useEffect(() => {
    if (selected) return;
    setRowsLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await listEquipments({
          page: rowsPage,
          pageSize: ROWS_PAGE_SIZE,
          projectId: projectFilter || undefined,
        });
        setRows(res.data);
        setRowsTotal(res.total);
      } catch (err) {
        toast.error(getApiError(err));
      } finally {
        setRowsLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [selected, rowsPage, projectFilter, reloadTick]);

  const rowsTotalPages = Math.max(1, Math.ceil(rowsTotal / ROWS_PAGE_SIZE));

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const rows = await lookupEquipment(q);
        setResults(rows);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const reloadAlert = async (eq: Equipment) => {
    try {
      const res = await getPartAlerts({ q: eq.code });
      setAlert(res.rows.find((r) => r.equipmentId === eq.id));
    } catch {
      setAlert(undefined);
    }
  };

  const loadDetail = async (eq: Equipment) => {
    setLoading(true);
    setDetail(null);
    setResetDate(todayLocal());
    setResetHours("");
    setResetKm("");
    setResetNotes("");
    try {
      const [schedules, daily, maints, faults, resets, assignments] = await Promise.all([
        listPartSchedules(eq.id),
        listDailyLogs({ equipmentId: eq.id, page: 1, pageSize: 200 }),
        listMaintenance({ equipmentId: eq.id, page: 1, pageSize: 200 }),
        listFaults({ equipmentId: eq.id, page: 1, pageSize: 200 }),
        listMeterResets(eq.id),
        listAssignments(eq.id).catch(() => [] as EquipmentAssignment[]),
      ]);
      setDetail({
        schedules,
        daily: { data: daily.data, total: daily.total },
        maints: maints.data,
        faults: { data: faults.data, total: faults.total },
        resets,
        assignments,
      });
      await reloadAlert(eq);
    } catch (err) {
      toast.error(getApiError(err));
      setSelected(null);
    } finally {
      setLoading(false);
    }
  };

  const applyEquipmentUpdate = (updated: Equipment) => {
    setSelected(updated);
    setRows((list) => list.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setQuery(updated.code);
  };

  const saveTrackingField = async (payload: {
    categoryId?: number | null;
    trackingMode?: TrackingMode;
    trackingModeConfirmed?: boolean;
  }) => {
    if (!selected) return;
    setTrackingSaving(true);
    try {
      const updated = await updateEquipment(selected.id, payload);
      applyEquipmentUpdate(updated);
      if (!trackingModeAppliesHours(updated.trackingMode)) setResetHours("");
      if (!trackingModeAppliesKm(updated.trackingMode)) setResetKm("");
      await reloadAlert(updated);
      toast.success("تم تحديث إعدادات وضع التتبع");
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setTrackingSaving(false);
    }
  };

  const submitMeterReset = async () => {
    if (!selected) return;
    const hoursApplicable = trackingModeAppliesHours(selected.trackingMode);
    const kmApplicable = trackingModeAppliesKm(selected.trackingMode);
    const hours =
      hoursApplicable && resetHours.trim() !== "" ? Number(resetHours) : null;
    const km = kmApplicable && resetKm.trim() !== "" ? Number(resetKm) : null;

    if (hours == null && km == null) {
      toast.error("أدخل قراءة الساعات أو الكيلومترات بعد التصفير");
      return;
    }
    if (
      (hours != null && (!Number.isFinite(hours) || hours < 0)) ||
      (km != null && (!Number.isFinite(km) || km < 0))
    ) {
      toast.error("قيم العداد يجب أن تكون أرقامًا غير سالبة");
      return;
    }

    setResetSaving(true);
    try {
      await createMeterReset(selected.id, {
        date: resetDate,
        hours,
        km,
        notes: resetNotes.trim() || null,
      });
      const resets = await listMeterResets(selected.id);
      setDetail((d) => (d ? { ...d, resets } : d));
      setResetHours("");
      setResetKm("");
      setResetNotes("");
      await reloadAlert(selected);
      toast.success("تم تسجيل حدث التصفير وإعادة ضبط الاحتساب");
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setResetSaving(false);
    }
  };

  const pick = (eq: Equipment) => {
    setOpen(false);
    setQuery(eq.code);
    setSelected(eq);
    setTab("overview");
    void loadDetail(eq);
  };

  const clear = () => {
    setSelected(null);
    setDetail(null);
    setAlert(undefined);
    setQuery("");
    setResults([]);
  };

  const partRows = (detail?.maints ?? []).flatMap((m) => (m.workParts ?? []).map((p) => ({ m, p })));

  const oilStateText = alert ? OIL_ALERT_STATE_LABELS[alert.oilState] : "بدون سجل";
  const summaryText = !alert
    ? "بدون سجل"
    : alert.status === "OIL_AND_FILTER"
      ? `${oilStateText} — الفلتر مطلوب أيضًا`
      : alert.status === "OIL" || alert.status === "DUE_SOON"
        ? oilStateText
        : alert.status === "SAFE"
          ? "سليم — ضمن الحد"
          : "تحقق من البيانات";

  const serviceCard = (
    title: string,
    icon: typeof Droplets,
    s: ServiceAlert | undefined,
    unit: "ساعة" | "كم"
  ) => {
    const Icon = icon;
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
            <Icon size={14} /> {title}
          </span>
          <span
            className={cn(
              "text-[11px] font-bold rounded-full px-2 py-0.5",
              s ? SERVICE_STATUS_CLS[s.status] : "bg-slate-100 text-slate-400"
            )}
          >
            {s ? SERVICE_STATUS_LABELS[s.status] : "—"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>
            الفترة: <b className="text-slate-700">{s?.interval ?? "—"} {unit}</b>
          </span>
          <span>
            المتبقي: <b className="text-slate-700">{num(s?.remaining)} {unit}</b>
          </span>
          <span>
            المنقضي: <b className="text-slate-700">{num(s?.elapsed)} {unit}</b>
          </span>
          <span>
            آخر خدمة: <b className="text-slate-700">{day(s?.lastDate)}</b>
          </span>
        </div>
      </div>
    );
  };

  const serviceCards = (mode: TrackingMode) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {trackingModeAppliesHours(mode) && (
        <>
          {serviceCard("زيت المحرك — ساعات", Droplets, alert?.oil, "ساعة")}
          {serviceCard("فلتر الزيت — ساعات", Filter, alert?.filter, "ساعة")}
        </>
      )}
      {trackingModeAppliesKm(mode) && (
        <>
          {serviceCard("زيت المحرك — كيلومترات", Gauge, alert?.oilKm, "كم")}
          {serviceCard("فلتر الزيت — كيلومترات", Filter, alert?.filterKm, "كم")}
        </>
      )}
    </div>
  );

  return (
    <>
    <div className="no-print space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">سجل المعدات</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ابحث عن المعدة بالكود أو الاسم — وبتشوف كل تفاصيلها: الزيوت والفلاتر، أصناف الصيانة، السراكي، والأعطال
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSync && (
            <button
              onClick={handleSync}
              disabled={syncing}
              title="جلب المعدات ومشاريعها من نظام المدرين"
              className="flex items-center gap-2 rounded-lg border border-primary-600 text-primary-700 hover:bg-primary-50 disabled:opacity-60 text-[13px] font-semibold px-3 py-2 transition-colors"
            >
              {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {syncing ? "جاري الجلب..." : "مزامنة من نظام المدرين"}
            </button>
          )}
          <div className="relative w-80" ref={boxRef}>
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 z-10" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="ابحث بالكود أو اسم المعدة... مثال: DZ03"
            className={cn(inputCls, "pr-9")}
          />
          {searching && (
            <Loader2
              size={15}
              className="animate-spin absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
          )}
          {open && results.length > 0 && (
            <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto z-30">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => pick(r)}
                  className="w-full text-right px-3 py-2 hover:bg-primary-50 transition-colors flex items-center justify-between gap-2 border-b border-slate-100 last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold text-slate-700 truncate">{r.name}</span>
                    <span className="block text-[11px] text-slate-400">{r.project?.name || "بدون مشروع"}</span>
                  </span>
                  <span className="font-mono text-xs text-primary-700 font-bold shrink-0" dir="ltr">
                    {r.code}
                  </span>
                </button>
              ))}
            </div>
          )}
          {open && query.trim() && !searching && results.length === 0 && (
            <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs text-slate-400 z-30">
              لا توجد نتائج لـ «{query.trim()}»
            </div>
          )}
          </div>
        </div>
      </div>

      {!selected ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex-wrap">
            <div className="text-sm font-bold text-slate-700">
              كل المعدات
              <span className="font-mono text-xs text-slate-400 mr-2">{rowsTotal} معدة</span>
            </div>
            <select
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value ? Number(e.target.value) : "");
                setRowsPage(1);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">كل المشاريع</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {rowsLoading ? (
            <div className="py-14 text-center text-slate-400 text-sm">
              <Loader2 size={18} className="animate-spin inline ml-2" /> جاري التحميل...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <HardHat size={26} />
              </div>
              <p className="text-sm font-bold text-slate-600">لا توجد معدات</p>
              <p className="text-xs text-slate-400 mt-1">
                اضغط «مزامنة من نظام المدرين» لجلب المعدات ومشاريعها
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr>
                    <th className={thCls}>الكود</th>
                    <th className={thCls}>اسم المعدة</th>
                    <th className={thCls}>المشروع</th>
                    <th className={thCls}>القطاع</th>
                    <th className={thCls}>الفئة / وضع التتبع</th>
                    <th className={cn(thCls, "text-center")}>سراكي</th>
                    <th className={cn(thCls, "text-center")}>أوامر شغل</th>
                    <th className={cn(thCls, "text-center")}>أعطال</th>
                    <th className={cn(thCls, "text-center")}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="hover:bg-primary-50/50 cursor-pointer transition-colors"
                      onClick={() => pick(r)}
                    >
                      <td className={cn(tdCls, "font-mono text-xs font-bold text-primary-700")} dir="ltr">
                        {r.code}
                      </td>
                      <td className={cn(tdCls, "font-semibold")}>{r.name}</td>
                      <td className={tdCls}>
                        {r.project ? (
                          <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-primary-50 text-primary-700">
                            {r.project.name}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">بدون مشروع</span>
                        )}
                      </td>
                      <td className={cn(tdCls, "text-slate-500")}>{r.sector?.name || "—"}</td>
                      <td className={tdCls}>
                        <div className="flex items-center gap-1 flex-wrap">
                          {r.category && (
                            <span className="text-[11px] text-slate-500">{r.category.name}</span>
                          )}
                          <span
                            className={cn(
                              "text-[10px] font-bold rounded-full px-1.5 py-0.5 border whitespace-nowrap",
                              TRACKING_MODE_CLS[r.trackingMode]
                            )}
                          >
                            {TRACKING_MODE_LABELS[r.trackingMode]}
                          </span>
                          {!r.trackingModeConfirmed && (
                            <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 whitespace-nowrap">
                              غير مؤكد
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={cn(tdCls, "text-center font-mono text-xs")}>
                        {r._count?.dailyLogs ?? 0}
                      </td>
                      <td className={cn(tdCls, "text-center font-mono text-xs")}>
                        {r._count?.maintenance ?? 0}
                      </td>
                      <td className={cn(tdCls, "text-center font-mono text-xs")}>
                        {r._count?.faults ?? 0}
                      </td>
                      <td className={cn(tdCls, "text-center")}>
                        <span className="text-[11px] font-bold text-primary-600">عرض ←</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rowsTotalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 bg-slate-50/40">
              <button
                onClick={() => setRowsPage((p) => Math.max(1, p - 1))}
                disabled={rowsPage <= 1}
                className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-800 disabled:opacity-40"
              >
                <ChevronRight size={14} /> السابق
              </button>
              <span className="text-xs text-slate-500 font-semibold">
                صفحة {rowsPage} من {rowsTotalPages}
              </span>
              <button
                onClick={() => setRowsPage((p) => Math.min(rowsTotalPages, p + 1))}
                disabled={rowsPage >= rowsTotalPages}
                className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-800 disabled:opacity-40"
              >
                التالي <ChevronLeft size={14} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 bg-slate-50/60">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center shrink-0">
                <HardHat size={19} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2 flex-wrap">
                  <span className="font-mono" dir="ltr">
                    {selected.code}
                  </span>
                  <span className="text-slate-400">—</span>
                  {selected.name}
                  <span
                    className={cn(
                      "text-[11px] font-bold rounded-full px-2 py-0.5",
                      alert
                        ? OIL_ALERT_STATE_CLS[alert.oilState]
                        : "bg-slate-100 text-slate-400"
                    )}
                  >
                    {alert ? OIL_ALERT_STATE_LABELS[alert.oilState] : "بدون سجل زيت"}
                  </span>
                  {alert?.filterAlert && (
                    <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-orange-100 text-orange-700">
                      الفلتر مطلوب أيضًا
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-[11px] font-bold rounded-full px-2 py-0.5",
                      TRACKING_MODE_CLS[selected.trackingMode]
                    )}
                  >
                    {TRACKING_MODE_LABELS[selected.trackingMode]}
                  </span>
                  {selected.category && (
                    <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">
                      {selected.category.name}
                    </span>
                  )}
                  {!selected.trackingModeConfirmed && (
                    <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-700">
                      وضع التتبع غير مؤكد
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {selected.project?.name || "بدون مشروع"} · {selected.sector?.name || "بدون قطاع"}
                </p>
              </div>
            </div>
            <button
              onClick={() => window.print()}
              title="طباعة نموذج سجل المعدة"
              className="no-print flex items-center gap-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white px-3 py-2 hover:bg-slate-800 transition-colors shrink-0"
            >
              <Printer size={14} /> طباعة نموذج
            </button>
            <button
              onClick={clear}
              title="بحث عن معدة أخرى"
              className="no-print p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X size={17} />
            </button>
          </div>

          <div className="flex items-center gap-1 px-4 border-b border-slate-200 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold border-b-2 -mb-px whitespace-nowrap transition-colors",
                  tab === t.key
                    ? "border-primary-600 text-primary-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                <t.icon size={14} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {loading ? (
              <div className="py-16 text-center text-slate-400 text-sm">
                <Loader2 size={18} className="animate-spin inline ml-2" /> جاري تحميل السجل...
              </div>
            ) : !detail ? (
              <div className="py-16 text-center text-slate-400 text-sm">تعذّر تحميل السجل</div>
            ) : tab === "overview" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-400 font-semibold mb-1">آخر عداد (ساعة)</div>
                    <div className="text-lg font-extrabold text-slate-800">
                      {trackingModeAppliesHours(selected.trackingMode) ? (
                        num(alert?.currentMeter)
                      ) : (
                        <span className="text-slate-400 text-sm">لا ينطبق</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-400 font-semibold mb-1">آخر عداد (كم)</div>
                    <div className="text-lg font-extrabold text-slate-800">
                      {trackingModeAppliesKm(selected.trackingMode) ? (
                        num(alert?.currentKm)
                      ) : (
                        <span className="text-slate-400 text-sm">لا ينطبق</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-400 font-semibold mb-1">سجلات السراكي</div>
                    <div className="text-lg font-extrabold text-slate-800">{detail.daily.total}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-400 font-semibold mb-1">أوامر الشغل</div>
                    <div className="text-lg font-extrabold text-slate-800">{detail.maints.length}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-400 font-semibold mb-1">الأعطال</div>
                    <div className="text-lg font-extrabold text-slate-800">{detail.faults.total}</div>
                  </div>
                </div>
                {serviceCards(selected.trackingMode)}
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                    سجل تخصيص المعدة (المشروع والقطاع)
                  </div>
                  <div className="px-3 py-2 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      التخصيص الحالي:{" "}
                      <b className="text-slate-800">
                        {selected.project?.name || "بدون مشروع"} — {selected.sector?.name || "بدون قطاع"}
                      </b>
                    </span>
                  </div>
                  {detail.assignments.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
                      لا يوجد تاريخ تخصيص مسجّل — التخصيص الحالي أعلاه وليس دليلًا تاريخيًا. السجلات القديمة تبقى «لم يُسجّل وقت الإنشاء».
                    </div>
                  ) : (
                    <table className="w-full border-collapse border-t border-slate-200">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className={thCls}>من</th>
                          <th className={thCls}>إلى</th>
                          <th className={thCls}>المشروع</th>
                          <th className={thCls}>القطاع</th>
                          <th className={thCls}>المصدر</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.assignments.map((a) => (
                          <tr key={a.id}>
                            <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                              {day(a.effectiveFrom)}
                            </td>
                            <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                              {a.effectiveTo ? day(a.effectiveTo) : "الحالي"}
                            </td>
                            <td className={cn(tdCls, "text-xs")}>{a.project?.name || "بدون مشروع"}</td>
                            <td className={cn(tdCls, "text-xs")}>{a.sector?.name || "بدون قطاع"}</td>
                            <td className={cn(tdCls, "text-xs text-slate-500")} dir="ltr">
                              {a.sourceSystem}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  الخلاصة: <b className="text-slate-600">{summaryText}</b> — وضع التتبع:{" "}
                  <b className="text-slate-600">{TRACKING_MODE_LABELS[selected.trackingMode]}</b> — كل التفاصيل في تبويب «الزيوت والفلاتر».
                </p>
              </div>
            ) : tab === "oil" ? (
              <div className="space-y-4">
                {serviceCards(selected.trackingMode)}
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                    مواعيد الأصناف المعرفة للمعدة
                  </div>
                  {detail.schedules.length === 0 ? (
                    <div className="px-3 py-6 text-center text-slate-400 text-sm">
                      لا توجد مواعيد مخصصة — الافتراضي: زيت المحرك كل 150 ساعة أو 10,000 كم (أيهما أسبق)، وفلتر الزيت 300 ساعة أو 20,000 كم
                    </div>
                  ) : (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className={thCls}>الصنف</th>
                          <th className={cn(thCls, "text-center")}>الفترة</th>
                          <th className={cn(thCls, "text-center")}>الوحدة</th>
                          <th className={thCls}>ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.schedules.map((s) => (
                          <tr key={s.id}>
                            <td className={cn(tdCls, "font-semibold")}>{s.partName}</td>
                            <td className={cn(tdCls, "text-center font-mono text-xs")}>{s.interval}</td>
                            <td className={cn(tdCls, "text-center")}>{s.unit}</td>
                            <td className={cn(tdCls, "text-slate-500")}>{s.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {canSync && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                        <Settings2 size={14} /> إعدادات وضع التتبع
                      </span>
                      <span
                        className={cn(
                          "text-[11px] font-bold rounded-full px-2 py-0.5",
                          selected.trackingModeConfirmed
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        )}
                      >
                        {selected.trackingModeConfirmed ? "الوضع مؤكد" : "بانتظار المراجعة"}
                      </span>
                    </div>
                    <div className="p-3 space-y-3">
                      <p className="text-[11px] text-slate-500">
                        وضع التتبع يحدد العدادات المعتمدة: الساعات أو الكيلومترات أو الاثنان.
                        المعدات غير المؤكدة لا تُفعَّل تنبيهاتها. تغيير افتراضي الفئة يسري على
                        المعدات التي لم تتجاوز وضع فئتها ويطلب إعادة التأكيد.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            فئة المعدة
                          </label>
                          <select
                            value={selected.categoryId ?? ""}
                            onChange={(e) =>
                              saveTrackingField({
                                categoryId: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                            disabled={trackingSaving}
                            className={cn(inputCls, "text-xs py-1.5")}
                          >
                            <option value="">— بدون فئة —</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} — {TRACKING_MODE_LABELS[c.defaultTrackingMode]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            وضع التتبع
                          </label>
                          <select
                            value={selected.trackingMode}
                            onChange={(e) =>
                              saveTrackingField({ trackingMode: e.target.value as TrackingMode })
                            }
                            disabled={trackingSaving}
                            className={cn(inputCls, "text-xs py-1.5")}
                          >
                            <option value="HOURS">ساعات التشغيل فقط</option>
                            <option value="KM">الكيلومترات فقط</option>
                            <option value="BOTH">ساعات + كيلومترات</option>
                          </select>
                          <p className="text-[10px] text-slate-400 mt-1">
                            {selected.trackingModeOverridden
                              ? "مخصص لهذه المعدة"
                              : selected.category
                                ? "موروث من الفئة"
                                : "افتراضي — بلا فئة"}
                          </p>
                        </div>
                        <div>
                          {selected.trackingModeConfirmed ? (
                            <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                              وضع التتبع مؤكد — التنبيهات مفعّلة
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => saveTrackingField({ trackingModeConfirmed: true })}
                              disabled={trackingSaving}
                              className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                            >
                              {trackingSaving ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Gauge size={13} />
                              )}
                              تأكيد وضع التتبع
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        عند تغيير أو ضبط العداد سجّل حدث تصفير صريحًا هنا. يعيد الحدث تأسيس
                        احتساب العدادات المطبقة، ولا يُسجّل تغيير فلتر.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            تاريخ التصفير
                          </label>
                          <input
                            type="date"
                            dir="ltr"
                            value={resetDate}
                            onChange={(e) => setResetDate(e.target.value)}
                            className={cn(inputCls, "text-xs py-1.5")}
                          />
                        </div>
                        {trackingModeAppliesHours(selected.trackingMode) && (
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              الساعات بعد التصفير
                            </label>
                            <input
                              dir="ltr"
                              type="number"
                              min="0"
                              step="any"
                              value={resetHours}
                              onChange={(e) => setResetHours(e.target.value)}
                              placeholder="مثال: 0"
                              className={cn(inputCls, "text-xs py-1.5 font-mono")}
                            />
                          </div>
                        )}
                        {trackingModeAppliesKm(selected.trackingMode) && (
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                              الكيلومترات بعد التصفير
                            </label>
                            <input
                              dir="ltr"
                              type="number"
                              min="0"
                              step="any"
                              value={resetKm}
                              onChange={(e) => setResetKm(e.target.value)}
                              placeholder="مثال: 0"
                              className={cn(inputCls, "text-xs py-1.5 font-mono")}
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            ملاحظات
                          </label>
                          <input
                            value={resetNotes}
                            onChange={(e) => setResetNotes(e.target.value)}
                            placeholder="سبب التصفير..."
                            className={cn(inputCls, "text-xs py-1.5")}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={submitMeterReset}
                        disabled={resetSaving}
                        className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white px-3 py-2 hover:bg-slate-800 disabled:opacity-60 transition-colors"
                      >
                        {resetSaving ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <RotateCcw size={13} />
                        )}
                        تسجيل حدث التصفير
                      </button>
                      {detail.resets.length > 0 && (
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <table className="w-full border-collapse">
                            <thead>
                              <tr>
                                <th className={thCls}>تاريخ التصفير</th>
                                {trackingModeAppliesHours(selected.trackingMode) && (
                                  <th className={cn(thCls, "text-center")}>الساعات</th>
                                )}
                                {trackingModeAppliesKm(selected.trackingMode) && (
                                  <th className={cn(thCls, "text-center")}>الكيلومترات</th>
                                )}
                                <th className={thCls}>ملاحظات</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.resets.map((r) => (
                                <tr key={r.id}>
                                  <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                                    {day(r.date)}
                                  </td>
                                  {trackingModeAppliesHours(selected.trackingMode) && (
                                    <td className={cn(tdCls, "text-center font-mono text-xs")}>
                                      {num(r.hours)}
                                    </td>
                                  )}
                                  {trackingModeAppliesKm(selected.trackingMode) && (
                                    <td className={cn(tdCls, "text-center font-mono text-xs")}>
                                      {num(r.km)}
                                    </td>
                                  )}
                                  <td className={cn(tdCls, "text-slate-500")}>{r.notes || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">التعديل والتفصيل الكامل في شاشة «تنبيهات الزيوت».</p>
              </div>
            ) : tab === "parts" ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 flex items-center justify-between">
                  <span>كل أصناف أوامر الشغل</span>
                  <span className="font-mono">{partRows.length} صنف</span>
                </div>
                {partRows.length === 0 ? (
                  <div className="px-3 py-8 text-center text-slate-400 text-sm">لا توجد أصناف مسجلة</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[750px] border-collapse">
                      <thead>
                        <tr>
                          <th className={thCls}>رقم الأمر</th>
                          <th className={thCls}>التاريخ</th>
                          <th className={thCls}>الصنف</th>
                          <th className={thCls}>كود الصنف</th>
                          <th className={cn(thCls, "text-center")}>الكمية</th>
                          <th className={thCls}>ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partRows.map(({ m, p }, i) => (
                          <tr key={`${m.id}-${p.id ?? i}`}>
                            <td className={cn(tdCls, "font-mono text-xs")}>{m.workOrderNo ?? "—"}</td>
                            <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                              {day(m.date)}
                            </td>
                            <td className={cn(tdCls, "font-semibold")}>{p.name}</td>
                            <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                              {p.code || "—"}
                            </td>
                            <td className={cn(tdCls, "text-center font-mono text-xs")}>{num(p.qty)}</td>
                            <td className={cn(tdCls, "text-slate-500 max-w-[220px] truncate")}>
                              {p.notes || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : tab === "day" ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 flex items-center justify-between">
                  <span>سجل السراكي</span>
                  <span className="font-mono">
                    {detail.daily.data.length} من {detail.daily.total}
                  </span>
                </div>
                {detail.daily.data.length === 0 ? (
                  <div className="px-3 py-8 text-center text-slate-400 text-sm">لا توجد سجلات يومية</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px] border-collapse">
                      <thead>
                        <tr>
                          <th className={thCls}>التاريخ</th>
                          <th className={cn(thCls, "text-center")}>النهاية</th>
                          <th className={cn(thCls, "text-center")}>ساعات</th>
                          <th className={cn(thCls, "text-center")}>ديزل</th>
                          <th className={cn(thCls, "text-center")}>نوع الإنتاجية</th>
                          <th className={cn(thCls, "text-center")}>عدد الإنتاجية</th>
                          <th className={cn(thCls, "text-center")}>الصلاحية</th>
                          <th className={thCls}>ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.daily.data.map((l) => (
                          <tr key={l.id}>
                            <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                              {day(l.date)}
                            </td>
                            <td className={cn(tdCls, "text-center font-mono text-xs")}>{num(l.endMeter)}</td>
                            <td className={cn(tdCls, "text-center font-mono text-xs")}>
                              {num(l.operatingHours)}
                            </td>
                            <td className={cn(tdCls, "text-center font-mono text-xs")}>{num(l.diesel)}</td>
                            <td className={cn(tdCls, "text-center text-xs")}>{l.productivityType || "—"}</td>
                            <td className={cn(tdCls, "text-center font-mono text-xs")}>{num(l.productivityCount)}</td>
                            <td className={cn(tdCls, "text-center")}>
                              {l.condition ? (
                                <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">
                                  {CONDITION_LABELS[l.condition]}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className={cn(tdCls, "text-slate-500 max-w-[200px] truncate")}>
                              {l.conditionNote || l.notes || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 flex items-center justify-between">
                  <span>سجل الأعطال</span>
                  <span className="font-mono">
                    {detail.faults.data.length} من {detail.faults.total}
                  </span>
                </div>
                {detail.faults.data.length === 0 ? (
                  <div className="px-3 py-8 text-center text-slate-400 text-sm">لا توجد أعطال مسجلة</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[850px] border-collapse">
                      <thead>
                        <tr>
                          <th className={thCls}>التاريخ</th>
                          <th className={thCls}>العطل</th>
                          <th className={thCls}>السبب</th>
                          <th className={cn(thCls, "text-center")}>توقف (ساعة)</th>
                          <th className={cn(thCls, "text-center")}>الحالة</th>
                          <th className={thCls}>الإجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.faults.data.map((f) => (
                          <tr key={f.id}>
                            <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                              {day(f.date)}
                            </td>
                            <td className={cn(tdCls, "max-w-[260px] truncate")} title={f.description}>
                              {f.description}
                            </td>
                            <td className={cn(tdCls, "text-slate-500 max-w-[180px] truncate")}>
                              {f.cause || "—"}
                            </td>
                            <td className={cn(tdCls, "text-center font-mono text-xs")}>
                              {num(f.downtimeHours)}
                            </td>
                            <td className={cn(tdCls, "text-center")}>
                              <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">
                                {MAINT_STATUS_LABELS[f.status] || f.status}
                              </span>
                            </td>
                            <td className={cn(tdCls, "text-slate-500 max-w-[200px] truncate")}>
                              {f.actionTaken || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {selected && detail && (
        <div className="print-area hidden print:block bg-white text-slate-900">
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
            <div>
              <h1 className="text-base font-extrabold">EFMS — نموذج سجل معدة</h1>
              <p className="text-[10px] text-slate-600">متابعة المعدات والصيانة — قاصد خير</p>
            </div>
            <div className="text-left text-[10px] leading-4">
              <p>تاريخ الطباعة: {new Date().toLocaleDateString("ar-EG")}</p>
              <p>بواسطة: {user?.name ?? "—"}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-x-5 gap-y-1 mb-3 text-[11px]">
            <p>
              <b>الكود:</b> <span className="font-mono">{selected.code}</span>
            </p>
            <p>
              <b>الاسم:</b> {selected.name}
            </p>
            <p>
              <b>المشروع:</b> {selected.project?.name || "—"}
            </p>
            <p>
              <b>القطاع:</b> {selected.sector?.name || "—"}
            </p>
            <p>
              <b>وضع التتبع:</b> {TRACKING_MODE_LABELS[selected.trackingMode]}
            </p>
            <p>
              <b>الفئة:</b> {selected.category?.name || "—"}
            </p>
            {trackingModeAppliesHours(selected.trackingMode) && (
              <p>
                <b>آخر عداد (ساعة):</b> <span className="font-mono">{num(alert?.currentMeter)}</span>
              </p>
            )}
            {trackingModeAppliesKm(selected.trackingMode) && (
              <p>
                <b>آخر عداد (كم):</b>{" "}
                <span className="font-mono">{num(alert?.currentKm)}</span>
              </p>
            )}
            <p>
              <b>الخلاصة:</b> {summaryText}
            </p>
          </div>

          <table className="w-full border-collapse mb-3 text-[10px]">
            <thead>
              <tr>
                {["الخدمة", "الفترة", "آخر خدمة", "آخر قراءة عند الخدمة", "المنقضي", "المتبقي", "الحالة"].map(
                  (h) => (
                    <th key={h} className="border border-slate-400 px-1.5 py-1 bg-slate-100 text-right font-bold">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {trackingModeAppliesHours(selected.trackingMode) && (
                <>
                  <tr>
                    <td className="border border-slate-400 px-1.5 py-1 font-bold">زيت المحرك (ساعات)</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.oil.interval, "ساعة")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{day(alert?.oil.lastDate)}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.oil.lastMeter, "ساعة")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.oil.elapsed, "ساعة")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.oil.remaining, "ساعة")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center font-bold">
                      {alert ? SERVICE_STATUS_LABELS[alert.oil.status] : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-400 px-1.5 py-1 font-bold">فلتر الزيت (ساعات)</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.filter.interval, "ساعة")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{day(alert?.filter.lastDate)}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.filter.lastMeter, "ساعة")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.filter.elapsed, "ساعة")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.filter.remaining, "ساعة")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center font-bold">
                      {alert ? SERVICE_STATUS_LABELS[alert.filter.status] : "—"}
                    </td>
                  </tr>
                </>
              )}
              {trackingModeAppliesKm(selected.trackingMode) && (
                <>
                  <tr>
                    <td className="border border-slate-400 px-1.5 py-1 font-bold">زيت المحرك (كيلومترات)</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.oilKm.interval, "كم")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{day(alert?.oilKm.lastDate)}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.oilKm.lastMeter, "كم")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.oilKm.elapsed, "كم")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.oilKm.remaining, "كم")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center font-bold">
                      {alert ? SERVICE_STATUS_LABELS[alert.oilKm.status] : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-400 px-1.5 py-1 font-bold">فلتر الزيت (كيلومترات)</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.filterKm.interval, "كم")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{day(alert?.filterKm.lastDate)}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.filterKm.lastMeter, "كم")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.filterKm.elapsed, "كم")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{numUnit(alert?.filterKm.remaining, "كم")}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center font-bold">
                      {alert ? SERVICE_STATUS_LABELS[alert.filterKm.status] : "—"}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>

          <div className="mb-2 text-[11px] font-extrabold border-b border-slate-400 pb-0.5">
            آخر سجلات السراكي ({Math.min(12, detail.daily.data.length)} من {detail.daily.total})
          </div>
          <table className="w-full border-collapse mb-3 text-[10px]">
            <thead>
              <tr>
                {["التاريخ", "النهاية", "ساعات", "ديزل", "نوع الإنتاجية", "عدد الإنتاجية", "الصلاحية", "ملاحظات"].map((h) => (
                  <th key={h} className="border border-slate-400 px-1.5 py-1 bg-slate-100 text-right font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.daily.data.slice(0, 12).map((l) => (
                <tr key={l.id}>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{day(l.date)}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{num(l.endMeter)}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{num(l.operatingHours)}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{num(l.diesel)}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{l.productivityType || "—"}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{num(l.productivityCount)}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">
                    {l.condition ? CONDITION_LABELS[l.condition] : "—"}
                  </td>
                  <td className="border border-slate-400 px-1.5 py-1 max-w-[180px] truncate">
                    {l.conditionNote || l.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-2 text-[11px] font-extrabold border-b border-slate-400 pb-0.5">
                آخر أصناف الصيانة ({Math.min(8, partRows.length)})
              </div>
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr>
                    {["التاريخ", "رقم الأمر", "الصنف", "الكمية"].map((h) => (
                      <th key={h} className="border border-slate-400 px-1.5 py-1 bg-slate-100 text-right font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {partRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="border border-slate-400 px-1.5 py-2 text-center text-slate-500">
                        لا توجد أصناف
                      </td>
                    </tr>
                  ) : (
                    partRows.slice(0, 8).map(({ m, p }, i) => (
                      <tr key={`${m.id}-${p.id ?? i}`}>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">{day(m.date)}</td>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">{m.workOrderNo ?? "—"}</td>
                        <td className="border border-slate-400 px-1.5 py-1">{p.name}</td>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">{num(p.qty)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-extrabold border-b border-slate-400 pb-0.5">
                آخر الأعطال ({Math.min(8, detail.faults.data.length)} من {detail.faults.total})
              </div>
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr>
                    {["التاريخ", "العطل", "توقف (ساعة)", "الحالة"].map((h) => (
                      <th key={h} className="border border-slate-400 px-1.5 py-1 bg-slate-100 text-right font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.faults.data.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="border border-slate-400 px-1.5 py-2 text-center text-slate-500">
                        لا توجد أعطال
                      </td>
                    </tr>
                  ) : (
                    detail.faults.data.slice(0, 8).map((f) => (
                      <tr key={f.id}>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">{day(f.date)}</td>
                        <td className="border border-slate-400 px-1.5 py-1 max-w-[160px] truncate" title={f.description}>
                          {f.description}
                        </td>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">
                          {num(f.downtimeHours)}
                        </td>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">
                          {MAINT_STATUS_LABELS[f.status] || f.status}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between items-end text-[10px] mt-6 pt-2 border-t border-slate-300">
            <span>توقيع المسؤول: ..............................</span>
            <span className="text-slate-500">build by Gen Code</span>
          </div>
        </div>
      )}


    </>
  );
}
