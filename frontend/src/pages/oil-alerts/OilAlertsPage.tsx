import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Loader2, Droplets, AlertTriangle, Fuel, CheckCircle2, CircleHelp, ShieldAlert, Clock, Printer, ImageDown } from "lucide-react";
import {
  cn,
  OVERALL_STATUS_LABELS as STATUS_LABELS,
  OVERALL_STATUS_CLS as STATUS_CLS,
  SERVICE_STATUS_CLS,
  SERVICE_STATUS_LABELS as SERVICE_LABELS,
  OIL_ALERT_STATE_LABELS,
  OIL_ALERT_STATE_CLS,
  TRACKING_MODE_LABELS,
  TRACKING_MODE_CLS,
  trackingModeAppliesHours,
  trackingModeAppliesKm,
} from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { getApiError } from "@/lib/api";
import { projectOptions } from "@/services/projects";
import {
  getPartAlerts,
  type AlertStatusFilter,
  type EquipmentAlert,
  type ServiceAlert,
  type ServiceStatus,
} from "@/services/partSchedules";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";

const STATUS_FILTERS: { value: "" | AlertStatusFilter; label: string }[] = [
  { value: "", label: "كل الحالات" },
  { value: "OIL_DUE", label: "يحتاج تغيير زيت" },
  { value: "OIL_AND_FILTER", label: "يحتاج زيت و فلتر" },
  { value: "DUE_SOON", label: "أوشكت (90% – أقل من 100%)" },
  { value: "SAFE", label: "سليم (أقل من 90%)" },
  { value: "UNKNOWN", label: "بدون سجل" },
  { value: "MODE_UNCONFIRMED", label: "وضع التتبع غير مؤكد" },
];

function fmtNum(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fmtPercent(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function remainingCls(status: ServiceStatus) {
  if (status === "OVERDUE") return "text-red-600 font-bold";
  if (status === "DUE") return "text-orange-600 font-bold";
  if (status === "DUE_SOON") return "text-amber-600 font-bold";
  if (status === "SAFE") return "text-emerald-700 font-semibold";
  return "text-slate-400";
}

function basisText(r: EquipmentAlert): string | null {
  if (!r.oilDueBy) return null;
  const label =
    r.oilDueBy === "HOURS"
      ? "الساعات"
      : r.oilDueBy === "KM"
        ? "الكيلومترات"
        : "الحدان";
  const percent =
    r.oilDueBy === "HOURS"
      ? r.oil.percent
      : r.oilDueBy === "KM"
        ? r.oilKm.percent
        : Math.max(r.oil.percent ?? 0, r.oilKm.percent ?? 0);
  return percent == null ? `السبب: ${label}` : `السبب: ${label} (${fmtPercent(percent)}%)`;
}

function remainingSummary(r: EquipmentAlert): string {
  if (r.oilState === "VERIFY_DATA") {
    if (r.hoursDataMissing && r.kmDataMissing) return "أكمل قراءات الساعات والكيلومترات للحكم على الزيت";
    if (r.hoursDataMissing) return "أكمل قراءة ساعات التشغيل للحكم على الزيت";
    if (r.kmDataMissing) return "أكمل قراءة الكيلومترات للحكم على الزيت";
    return "أكمل القراءة الناقصة للحكم على الزيت";
  }
  const parts: string[] = [];
  const basis = basisText(r);
  if (basis) parts.push(basis);
  if (r.oil.remaining != null) {
    parts.push(
      r.oil.remaining < 0
        ? `تجاوز ${fmtNum(Math.abs(r.oil.remaining))} ساعة`
        : `متبقي ${fmtNum(r.oil.remaining)} ساعة`
    );
  }
  if (r.oilKm.remaining != null) {
    parts.push(
      r.oilKm.remaining < 0
        ? `تجاوز ${fmtNum(Math.abs(r.oilKm.remaining))} كم`
        : `متبقي ${fmtNum(r.oilKm.remaining)} كم`
    );
  }
  return parts.join(" · ");
}

function LastChangeCell({ s, unit }: { s: ServiceAlert; unit: "ساعة" | "كم" }) {
  if (s.status === "NOT_APPLICABLE") {
    return <span className="text-slate-400 text-xs">لا ينطبق</span>;
  }
  if (!s.lastDate) return <span className="text-slate-400 text-xs">لم يُسجّل</span>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-mono text-xs">{s.lastDate.split("-").reverse().join("/")}</span>
      {s.lastMeter != null ? (
        <span className="text-[10px] text-slate-400">
          عند {fmtNum(s.lastMeter)} {unit}
        </span>
      ) : (
        <span className="text-[10px] font-bold text-amber-600">بدون قراءة {unit}</span>
      )}
    </div>
  );
}

function ElapsedCell({ s }: { s: ServiceAlert }) {
  if (s.status === "NOT_APPLICABLE") {
    return <span className="text-slate-400 text-xs">لا ينطبق</span>;
  }
  if (s.elapsed == null) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span>{fmtNum(s.elapsed)}</span>
      {s.percent != null && (
        <span className="text-[9px] text-slate-400 font-mono">{fmtPercent(s.percent)}%</span>
      )}
      <span
        className={cn(
          "text-[9px] font-bold rounded-full px-1.5 py-px whitespace-nowrap",
          SERVICE_STATUS_CLS[s.status]
        )}
      >
        {SERVICE_LABELS[s.status]}
      </span>
    </div>
  );
}

function RemainingCell({ s, unit }: { s: ServiceAlert; unit: "ساعة" | "كم" }) {
  if (s.status === "NOT_APPLICABLE") {
    return <span className="text-slate-400 text-xs">لا ينطبق</span>;
  }
  if (s.remaining == null) return <span className="text-slate-400">—</span>;
  return (
    <div className={cn("flex flex-col items-center gap-0.5 whitespace-nowrap", remainingCls(s.status))}>
      <span>
        {s.remaining < 0 ? `متأخر ${fmtNum(Math.abs(s.remaining))}` : fmtNum(s.remaining)} {unit}
      </span>
      <span className="text-[10px] text-slate-400 font-medium">
        من {fmtNum(s.interval)} {unit} {s.isDefault ? "افتراضي" : "مخصص"}
      </span>
    </div>
  );
}

function lastService(r: EquipmentAlert): { s: ServiceAlert; unit: string } {
  return r.oil.status !== "NOT_APPLICABLE" ? { s: r.oil, unit: "ساعة" } : { s: r.oilKm, unit: "كم" };
}

function lastServiceDate(r: EquipmentAlert): string {
  const { s } = lastService(r);
  return s.lastDate ? s.lastDate.split("-").reverse().join("/") : "لم تُسجّل";
}

function lastServiceMeter(r: EquipmentAlert): string {
  const { s, unit } = lastService(r);
  return s.lastMeter == null ? "بدون قراءة" : `${fmtNum(s.lastMeter)} ${unit}`;
}

function delayText(r: EquipmentAlert): string {
  const bits: string[] = [];
  if (r.oil.status !== "NOT_APPLICABLE" && r.oil.remaining != null) {
    bits.push(
      r.oil.remaining < 0
        ? `متأخرة ${fmtNum(-r.oil.remaining)} ساعة`
        : `متبقي ${fmtNum(r.oil.remaining)} ساعة`
    );
  }
  if (r.oilKm.status !== "NOT_APPLICABLE" && r.oilKm.remaining != null) {
    bits.push(
      r.oilKm.remaining < 0
        ? `متأخرة ${fmtNum(-r.oilKm.remaining)} كم`
        : `متبقي ${fmtNum(r.oilKm.remaining)} كم`
    );
  }
  return bits.length ? bits.join(" · ") : "لا يوجد سجل";
}

const SHEET_HEADERS = [
  "الكود",
  "اسم المعدة",
  "تاريخ آخر صيانة",
  "آخر عداد صيانة",
  "التأخير / المتبقي",
  "محتاج فلتر؟",
  "الحالة",
];

function AlertsSheet({
  rows,
  summary,
  statusLabel,
  projectName,
  search,
  printedBy,
  now,
}: {
  rows: EquipmentAlert[];
  summary: Awaited<ReturnType<typeof getPartAlerts>>["summary"] | null;
  statusLabel: string;
  projectName: string;
  search: string;
  printedBy: string;
  now: Date;
}) {
  return (
    <div className="w-full bg-white text-slate-900 p-4">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-2">
        <div>
          <h2 className="text-base font-extrabold">EFMS — تنبيهات تغيير الزيت والفلتر</h2>
          <p className="text-[10px] text-slate-600">متابعة المعدات والصيانة — قاصد خير</p>
        </div>
        <div className="text-left text-[10px] leading-4">
          <p>تاريخ الطباعة: {now.toLocaleDateString("ar-EG")}</p>
          <p>بواسطة: {printedBy}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-x-4 gap-y-0.5 mb-2 text-[10px]">
        <p>
          <b>الحالة:</b> {statusLabel}
        </p>
        <p>
          <b>المشروع:</b> {projectName}
        </p>
        <p>
          <b>بحث:</b> {search || "—"}
        </p>
        <p>
          <b>عدد المعدات:</b> {rows.length}
        </p>
      </div>

      {summary && (
        <p className="text-[10px] mb-2">
          محتاجة تغيير زيت <b>{summary.oilDue}</b> · منها فلتر <b>{summary.filterDue}</b> · أوشكت{" "}
          <b>{summary.dueSoon}</b> · سليم <b>{summary.safe}</b> · بدون سجل <b>{summary.unknown}</b> · إجمالي{" "}
          <b>{summary.total}</b>
        </p>
      )}

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {SHEET_HEADERS.map((h) => (
              <th key={h} className="border border-slate-400 px-1.5 py-1 bg-slate-100 text-right font-bold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.equipmentId} className="break-inside-avoid">
              <td className="border border-slate-300 px-1.5 py-1 font-mono font-bold whitespace-nowrap" dir="ltr">
                {r.code}
              </td>
              <td className="border border-slate-300 px-1.5 py-1">{r.name}</td>
              <td className="border border-slate-300 px-1.5 py-1 whitespace-nowrap font-mono text-center">
                {lastServiceDate(r)}
              </td>
              <td className="border border-slate-300 px-1.5 py-1 whitespace-nowrap font-mono text-center">
                {lastServiceMeter(r)}
              </td>
              <td className={cn("border border-slate-300 px-1.5 py-1 whitespace-nowrap font-bold", r.oil.remaining != null && r.oil.remaining < 0 ? "text-red-700" : "text-slate-700")}>
                {delayText(r)}
              </td>
              <td
                className={cn(
                  "border border-slate-300 px-1.5 py-1 whitespace-nowrap text-center font-bold",
                  r.filterAlert ? "text-orange-700" : "text-emerald-700"
                )}
              >
                {r.filterAlert ? "نعم — مطلوب" : "لا"}
              </td>
              <td className="border border-slate-300 px-1.5 py-1 whitespace-nowrap font-bold">
                {STATUS_LABELS[r.status]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[8px] text-slate-400 text-center mt-2">build BY GEN CODE</p>
    </div>
  );
}

export default function OilAlertsPage() {
  const { user } = useAuth();
  const canReview = user?.role === "ROOT" || user?.role === "ADMIN";
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof projectOptions>>>([]);
  const [status, setStatus] = useState<"" | AlertStatusFilter>("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getPartAlerts>>["rows"]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getPartAlerts>>["summary"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(300);
  const [exporting, setExporting] = useState(false);
  const firstLoad = useRef(true);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    projectOptions().then(setProjects).catch((err) => toast.error(getApiError(err)));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPartAlerts({
        status: status || undefined,
        projectId: projectId === "" ? undefined : projectId,
        q: qDebounced || undefined,
      });
      setRows(res.rows);
      setSummary(res.summary);
      setVisible(300);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
      firstLoad.current = false;
    }
  }, [status, projectId, qDebounced]);

  useEffect(() => {
    load();
  }, [load]);

  const statusLabel = STATUS_FILTERS.find((f) => f.value === status)?.label ?? "كل الحالات";
  const projectName =
    projectId === "" ? "كل المشاريع" : projects.find((p) => p.id === projectId)?.name ?? "—";

  const sheet = (
    <AlertsSheet
      rows={rows}
      summary={summary}
      statusLabel={statusLabel}
      projectName={projectName}
      search={qDebounced}
      printedBy={user?.name ?? "—"}
      now={new Date()}
    />
  );

  const handleSaveImage = async () => {
    flushSync(() => setExporting(true));
    const node = sheetRef.current;
    if (!node) {
      toast.error("تعذّر تجهيز الصورة");
      setExporting(false);
      return;
    }
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
        width: node.scrollWidth,
        height: node.scrollHeight,
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `تنبيهات-الزيوت-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      toast.success("تم حفظ الصورة في مجلد التنزيلات على جهازك");
    } catch {
      toast.error("تعذّر إنشاء الصورة — جرّب زر الطباعة");
    } finally {
      setExporting(false);
    }
  };

  const chips: {
    label: string;
    filter: "" | AlertStatusFilter;
    value: number;
    cls: string;
    icon: typeof Fuel;
  }[] = [
    {
      label: "محتاجة تغيير زيت",
      filter: "OIL_DUE",
      value: summary?.oilDue ?? 0,
      cls: "bg-amber-50 text-amber-700 border-amber-200",
      icon: Fuel,
    },
    {
      label: "منها محتاجة فلتر زيت",
      filter: "OIL_AND_FILTER",
      value: summary?.filterDue ?? 0,
      cls: "bg-red-50 text-red-700 border-red-200",
      icon: AlertTriangle,
    },
    {
      label: "أوشكت (90% – أقل من 100%)",
      filter: "DUE_SOON",
      value: summary?.dueSoon ?? 0,
      cls: "bg-amber-50 text-amber-700 border-amber-200",
      icon: Clock,
    },
    {
      label: "سليم (أقل من 90%)",
      filter: "SAFE",
      value: summary?.safe ?? 0,
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
      icon: CheckCircle2,
    },
    {
      label: "بدون سجل",
      filter: "UNKNOWN",
      value: summary?.unknown ?? 0,
      cls: "bg-slate-50 text-slate-600 border-slate-200",
      icon: CircleHelp,
    },
    {
      label: "وضع تتبع غير مؤكد",
      filter: "MODE_UNCONFIRMED",
      value: summary?.unconfirmed ?? 0,
      cls: "bg-slate-50 text-slate-700 border-slate-300",
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap no-print">
        <div>
          <h1 className="text-lg font-bold text-slate-800">تنبيهات تغيير الزيت والفلتر</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            وضع تتبع كل معدة (ساعات / كيلومترات / الاثنان) يحدد العدادات المعتمدة. تُحسب نسبة الاستهلاك = (القراءة
            الحالية − قراءة آخر صيانة) ÷ الحد × 100: أقل من 90% سليم، من 90% لأقل من 100% أوشكت، 100% مطلوب
            التغيير، وأكثر من 100% متأخر. زيت المحرك: 150 ساعة أو 10,000 كم حسب الوضع. في وضع الاثنين تُعتمد
            النسبة الأكبر ويُوضَّح الحد المسبِّب للتنبيه. فلتر الزيت: 300 ساعة أو 20,000 كم، ولا يظهر منفردًا — يظهر
            «الفلتر مطلوب أيضًا» مع تنبيه الزيت فقط، ويُضاف للصيانة الدورية القادمة عند بلوغه حده. المعدات غير
            المؤكدة تُحسب تلقائيًا حسب العداد المتاح: الساعات أولًا، ثم الكيلومترات عند غيابها.
          </p>
          {canReview && (
            <Link
              to="/tracking-modes"
              className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:underline mt-1.5"
            >
              مراجعة أوضاع التتبع والفئات ←
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={loading || rows.length === 0}
            title="طباعة جدول التنبيهات (A4 عرضي)"
            className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white px-3 py-2 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <Printer size={14} /> طباعة
          </button>
          <button
            type="button"
            onClick={handleSaveImage}
            disabled={loading || rows.length === 0 || exporting}
            title="حفظ الجدول كصورة PNG على جهازك"
            className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-primary-600 text-white px-3 py-2 hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <ImageDown size={14} />} حفظ صورة
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm no-print">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className={labelCls}>الحالة</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | AlertStatusFilter)}
              className={cn(inputCls, "w-full")}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>المشروع</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value === "" ? "" : Number(e.target.value))}
              className={cn(inputCls, "w-full")}
            >
              <option value="">كل المشاريع</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>بحث بالكود أو الاسم</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="مثال: EX23..."
              className={cn(inputCls, "w-full")}
            />
          </div>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 no-print">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setStatus((cur) => (cur === c.filter ? "" : c.filter))}
              className={cn(
                "flex items-center gap-2 border rounded-xl px-4 py-3 text-right transition-colors",
                c.cls,
                status !== "" && status === c.filter && "ring-2 ring-primary-400"
              )}
            >
              <c.icon size={18} className="shrink-0" />
              <div>
                <div className="text-xl font-extrabold leading-tight">{c.value}</div>
                <div className="text-[11px] font-semibold">{c.label}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden no-print">
        {loading && firstLoad.current ? (
          <div className="p-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> جاري التحميل...
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm space-y-2">
            <Droplets size={28} className="mx-auto text-slate-300" />
            <p>لا توجد نتائج مطابقة للفلاتر الحالية</p>
            <Link to="/work" className="inline-block text-primary-700 font-semibold hover:underline text-xs">
              الذهاب لشاشة أعمال الصيانة (تعديل الفترات) ←
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm min-w-[1900px]">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th rowSpan={2} className="px-3 py-2 text-right font-semibold border-b border-slate-200 border-l">الكود</th>
                  <th rowSpan={2} className="px-3 py-2 text-right font-semibold border-b border-slate-200 border-l">اسم المعدة</th>
                  <th rowSpan={2} className="px-3 py-2 text-right font-semibold border-b border-slate-200 border-l">المشروع</th>
                  <th colSpan={2} className="px-3 py-2 text-center font-semibold border-b border-slate-200 border-l bg-slate-50">
                    العداد الحالي
                  </th>
                  <th colSpan={3} className="px-3 py-2 text-center font-bold text-amber-700 border-b border-slate-200 border-l bg-amber-50">
                    زيت المحرك — بالساعات (كل 150 ساعة)
                  </th>
                  <th colSpan={3} className="px-3 py-2 text-center font-bold text-sky-700 border-b border-slate-200 border-l bg-sky-50">
                    زيت المحرك — بالكيلومترات (كل 10,000 كم)
                  </th>
                  <th colSpan={3} className="px-3 py-2 text-center font-bold text-orange-700 border-b border-slate-200 border-l bg-orange-50">
                    فلتر الزيت — بالساعات (كل 300 ساعة)
                  </th>
                  <th colSpan={3} className="px-3 py-2 text-center font-bold text-rose-700 border-b border-slate-200 border-l bg-rose-50">
                    فلتر الزيت — بالكيلومترات (كل 20,000 كم)
                  </th>
                  <th rowSpan={2} className="px-3 py-2 text-center font-semibold border-b border-slate-200">الخلاصة</th>
                </tr>
                <tr className="bg-slate-50 text-slate-500 text-xs">
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">ساعة</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">كم</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">آخر تغيير</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">المنقضي</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">المتبقي</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">آخر تغيير</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">المنقضي</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">المتبقي</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">آخر تغيير</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">المنقضي</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">المتبقي</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">آخر تغيير</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">المنقضي</th>
                  <th className="px-2 py-1.5 text-center font-semibold border-b border-slate-200 border-l">المتبقي</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, visible).map((r) => (
                  <tr key={r.equipmentId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono font-semibold text-primary-700 whitespace-nowrap border-l border-slate-100" dir="ltr">
                      {r.code}
                    </td>
                    <td className="px-3 py-2 text-slate-700 border-l border-slate-100">
                      <div className="max-w-[170px] truncate">{r.name}</div>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <span
                          className={cn(
                            "text-[9px] font-bold rounded-full px-1.5 py-px border whitespace-nowrap",
                            TRACKING_MODE_CLS[r.trackingMode]
                          )}
                        >
                          {TRACKING_MODE_LABELS[r.trackingMode]}
                        </span>
                        {r.categoryName && (
                          <span className="text-[9px] text-slate-400 whitespace-nowrap">{r.categoryName}</span>
                        )}
                        {r.modeUnconfirmed && (
                          <span className="text-[9px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-px whitespace-nowrap">
                            غير مؤكد
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-[120px] truncate border-l border-slate-100">{r.projectName || "—"}</td>
                    <td className="px-3 py-2 text-center font-mono text-slate-700 border-l border-slate-100">
                      {trackingModeAppliesHours(r.trackingMode) ? (
                        fmtNum(r.currentMeter)
                      ) : (
                        <span className="text-[10px] font-bold text-slate-400">لا ينطبق</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-slate-700 border-l border-slate-100">
                      {!trackingModeAppliesKm(r.trackingMode) ? (
                        <span className="text-[10px] font-bold text-slate-400">لا ينطبق</span>
                      ) : r.currentKm == null ? (
                        <span
                          className="text-[10px] font-bold text-amber-600"
                          title="لا توجد قراءة كيلومترات مسجلة لهذه المعدة"
                        >
                          غير مسجل
                        </span>
                      ) : (
                        fmtNum(r.currentKm)
                      )}
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap border-l border-slate-100">
                      <LastChangeCell s={r.oil} unit="ساعة" />
                    </td>
                    <td className="px-2 py-2 text-center text-slate-700 border-l border-slate-100">
                      <ElapsedCell s={r.oil} />
                    </td>
                    <td className="px-2 py-2 text-center border-l border-slate-100">
                      <RemainingCell s={r.oil} unit="ساعة" />
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap border-l border-slate-100">
                      <LastChangeCell s={r.oilKm} unit="كم" />
                    </td>
                    <td className="px-2 py-2 text-center text-slate-700 border-l border-slate-100">
                      <ElapsedCell s={r.oilKm} />
                    </td>
                    <td className="px-2 py-2 text-center border-l border-slate-100">
                      <RemainingCell s={r.oilKm} unit="كم" />
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap border-l border-slate-100">
                      <LastChangeCell s={r.filter} unit="ساعة" />
                    </td>
                    <td className="px-2 py-2 text-center text-slate-700 border-l border-slate-100">
                      <ElapsedCell s={r.filter} />
                    </td>
                    <td className="px-2 py-2 text-center border-l border-slate-100">
                      <RemainingCell s={r.filter} unit="ساعة" />
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap border-l border-slate-100">
                      <LastChangeCell s={r.filterKm} unit="كم" />
                    </td>
                    <td className="px-2 py-2 text-center text-slate-700 border-l border-slate-100">
                      <ElapsedCell s={r.filterKm} />
                    </td>
                    <td className="px-2 py-2 text-center border-l border-slate-100">
                      <RemainingCell s={r.filterKm} unit="كم" />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className={cn(
                            "text-[11px] font-bold rounded-full px-2 py-1 whitespace-nowrap",
                            STATUS_CLS[r.status]
                          )}
                        >
                          {STATUS_LABELS[r.status]}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap",
                            OIL_ALERT_STATE_CLS[r.oilState]
                          )}
                        >
                          {OIL_ALERT_STATE_LABELS[r.oilState]}
                        </span>
                        <span className="text-[10px] text-slate-500 font-semibold whitespace-nowrap">
                          {remainingSummary(r)}
                        </span>
                        {r.filterAlert && (
                          <span className="text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 whitespace-nowrap">
                            الفلتر مطلوب أيضًا
                          </span>
                        )}
                        {r.kmDataMissing && (
                          <span
                            className="text-[10px] font-bold text-sky-700 bg-sky-50 rounded px-1 whitespace-nowrap"
                            title="بيانات الكيلومترات ناقصة: لا توجد قراءة حالية أو قراءة عند آخر تغيير زيت"
                          >
                            كم غير مكتمل
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > visible && (
          <div className="p-3 text-center border-t border-slate-200">
            <button
              onClick={() => setVisible((v) => v + 300)}
              className="text-xs font-semibold text-primary-700 hover:bg-primary-50 rounded-lg px-4 py-2 transition-colors"
            >
              عرض المزيد ({Math.min(300, rows.length - visible)} من {rows.length - visible} متبقٍ)
            </button>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            عدد المعدات المعروضة: <b>{Math.min(visible, rows.length)}</b>
            {summary && summary.total !== rows.length && <> من إجمالي {summary.total}</>}
          </div>
        )}
      </div>

      {rows.length > 0 && <div className="print-area print-alerts hidden print:block">{sheet}</div>}

      {exporting && (
        <div className="fixed top-0 left-[-20000px] w-[1200px] bg-white" aria-hidden>
          <div ref={sheetRef}>{sheet}</div>
        </div>
      )}
    </div>
  );
}
