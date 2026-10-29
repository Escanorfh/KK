import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Loader2,
  RefreshCw,
  HardHat,
  CalendarDays,
  Wrench,
  AlertTriangle,
  Droplets,
  FolderKanban,
  CheckCircle2,
  CircleDot,
  OctagonX,
  Fuel,
  Clock,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import { cn, MAINT_STATUS_LABELS, MAINT_STATUS_CLS, CONDITION_LABELS } from "@/lib/utils";
import { getApiError } from "@/lib/api";
import { getDashboardSummary, type DashboardSummary } from "@/services/dashboard";

const cardCls = "bg-white rounded-xl border border-slate-200 shadow-sm p-4";

const CONDITION_COLORS: Record<string, string> = {
  GOOD: "#10b981",
  BROKEN: "#ef4444",
  STOPPED: "#f59e0b",
};

const PROJECT_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#f97316", "#64748b",
];

const ALERT_LABELS: Record<string, string> = {
  OIL_AND_FILTER: "يحتاج زيت و فلتر",
  OIL: "يحتاج زيت",
  FILTER: "يحتاج فلتر",
  DUE_SOON: "أوشكت",
  SAFE: "سليم",
  UNKNOWN: "بدون سجل",
};

const ALERT_COLORS: Record<string, string> = {
  OIL_AND_FILTER: "#dc2626",
  OIL: "#ea580c",
  FILTER: "#06b6d4",
  DUE_SOON: "#f59e0b",
  SAFE: "#10b981",
  UNKNOWN: "#94a3b8",
};

const fmtVal = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG");

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className={cn(cardCls, "flex items-center gap-3")}>
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", accent)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500 font-semibold truncate">{label}</p>
        <p className="text-xl font-extrabold text-slate-800 font-mono">{value}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      setData(await getDashboardSummary());
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-80">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center text-slate-500 py-20">تعذّر تحميل البيانات</div>
    );
  }

  const needsService =
    (data.alertsSummary.OIL_AND_FILTER ?? 0) +
    (data.alertsSummary.OIL ?? 0) +
    (data.alertsSummary.FILTER ?? 0);

  const pieConditions = [
    { name: "صالح", value: data.conditions.GOOD, color: CONDITION_COLORS.GOOD },
    { name: "عاطل", value: data.conditions.BROKEN, color: CONDITION_COLORS.BROKEN },
    { name: "متوقف", value: data.conditions.STOPPED, color: CONDITION_COLORS.STOPPED },
  ].filter((d) => d.value > 0);

  const pieAlerts = Object.entries(ALERT_LABELS)
    .map(([k, label]) => ({ key: k, name: label, value: data.alertsSummary[k] ?? 0 }))
    .filter((d) => d.value > 0);

  const totalConditions =
    data.conditions.GOOD + data.conditions.BROKEN + data.conditions.STOPPED || 1;

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">لوحة المتابعة</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            نظرة شاملة على المعدات — السراكي، الصيانة، الأعطال، وتنبيهات الزيوت
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-sm font-bold rounded-lg bg-primary-600 text-white px-4 py-2 hover:bg-primary-700 transition-colors disabled:opacity-60"
        >
          <RefreshCw size={15} className={cn(refreshing && "animate-spin")} /> تحديث
        </button>
      </div>

      {/* بطاقات الأرقام */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={<HardHat size={20} className="text-blue-600" />}
          label="المعدات"
          value={data.totals.equipment}
          accent="bg-blue-50"
        />
        <StatCard
          icon={<CalendarDays size={20} className="text-emerald-600" />}
          label="سجلات السراكي"
          value={data.totals.dailyLogs}
          accent="bg-emerald-50"
        />
        <StatCard
          icon={<Wrench size={20} className="text-violet-600" />}
          label="أوامر الصيانة"
          value={data.totals.maintenance}
          accent="bg-violet-50"
        />
        <StatCard
          icon={<AlertTriangle size={20} className="text-red-600" />}
          label="الأعطال"
          value={data.totals.faults}
          accent="bg-red-50"
        />
        <StatCard
          icon={<Droplets size={20} className="text-amber-600" />}
          label="محتاج صيانة زيت/فلتر"
          value={needsService}
          accent="bg-amber-50"
        />
        <StatCard
          icon={<FolderKanban size={20} className="text-cyan-600" />}
          label="المشاريع / القطاعات"
          value={`${data.totals.projects} / ${data.totals.sectors}`}
          accent="bg-cyan-50"
        />
      </div>

      {/* الرسوم البيانية الكبرى */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={cn(cardCls, "lg:col-span-2")}>
          <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <Clock size={15} className="text-slate-400" /> ساعات التشغيل والديزل — آخر 12 شهر
          </h2>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.monthly} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="gHours" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gDiesel" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} reversed />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ direction: "rtl", fontSize: 12, borderRadius: 8 }}
                formatter={(v, n) => [
                  fmtVal(v),
                  n === "hours" ? "ساعات التشغيل" : "ديزل (لتر)",
                ]}
              />
              <Legend formatter={(v) => (v === "hours" ? "ساعات التشغيل" : "ديزل")} />
              <Area type="monotone" dataKey="hours" stroke="#3b82f6" fill="url(#gHours)" strokeWidth={2} />
              <Area type="monotone" dataKey="diesel" stroke="#f59e0b" fill="url(#gDiesel)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className={cn(cardCls, "flex flex-col")}>
          <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-emerald-500" /> حالة المعدات (يومي)
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={pieConditions}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
              >
                {pieConditions.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ direction: "rtl", fontSize: 12, borderRadius: 8 }}
                formatter={(v, n) => [`${fmtVal(v)} سجل`, n]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            {[
              { icon: <CheckCircle2 size={14} />, label: "صالح", value: data.conditions.GOOD, cls: "text-emerald-600" },
              { icon: <CircleDot size={14} />, label: "عاطل", value: data.conditions.BROKEN, cls: "text-red-600" },
              { icon: <OctagonX size={14} />, label: "متوقف", value: data.conditions.STOPPED, cls: "text-amber-600" },
            ].map((r) => (
              <div key={r.label} className="rounded-lg bg-slate-50 py-2">
                <p className={cn("flex items-center justify-center gap-1 text-[11px] font-bold", r.cls)}>
                  {r.icon} {r.label}
                </p>
                <p className="text-sm font-extrabold font-mono text-slate-700">
                  {((r.value / totalConditions) * 100).toFixed(0)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* صف ثانٍ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={cn(cardCls, "lg:col-span-2")}>
          <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <Wrench size={15} className="text-violet-500" /> أوامر الصيانة — آخر 12 شهر
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.monthly} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} reversed />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ direction: "rtl", fontSize: 12, borderRadius: 8 }}
                formatter={(v) => [fmtVal(v), "عدد الأوامر"]}
              />
              <Bar dataKey="maintenance" fill="#8b5cf6" radius={[6, 6, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={cardCls}>
          <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <Droplets size={15} className="text-amber-500" /> تنبيهات الزيت والفلتر
          </h2>
          {pieAlerts.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-14">
              لا توجد بيانات تنبيهات — سجّل سراكي أو مواعيد صيانة
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieAlerts} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={3}>
                    {pieAlerts.map((entry) => (
                      <Cell key={entry.key} fill={ALERT_COLORS[entry.key]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ direction: "rtl", fontSize: 12, borderRadius: 8 }}
                    formatter={(v, n) => [`${fmtVal(v)} معدة`, n]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-1">
                {pieAlerts.map((a) => (
                  <div key={a.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-600">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: ALERT_COLORS[a.key] }} />
                      {a.name}
                    </span>
                    <span className="font-mono font-bold text-slate-800">{a.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* أعلى المعدات + توزيع المشاريع */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={cn(cardCls, "lg:col-span-2")}>
          <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <Fuel size={15} className="text-blue-500" /> أعلى 10 معدات في ساعات التشغيل — آخر 12 شهر
          </h2>
          {data.topEquipment.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-14">لا توجد سجلات سراكي بعد</div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={data.topEquipment} layout="vertical" margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="code" tick={{ fontSize: 10 }} width={60} />
                <Tooltip
                  contentStyle={{ direction: "rtl", fontSize: 12, borderRadius: 8 }}
                  formatter={(v, n) => [
                    fmtVal(v),
                    n === "hours" ? "ساعات" : "ديزل (لتر)",
                  ]}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { name?: string; project?: string | null } | undefined;
                    return p ? `${p.name}${p.project ? ` — ${p.project}` : ""}` : "";
                  }}
                />
                <Legend formatter={(v) => (v === "hours" ? "ساعات التشغيل" : "ديزل")} />
                <Bar dataKey="hours" fill="#3b82f6" radius={[0, 6, 6, 0]} maxBarSize={18} />
                <Bar dataKey="diesel" fill="#f59e0b" radius={[0, 6, 6, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className={cardCls}>
          <h2 className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1.5">
            <FolderKanban size={15} className="text-cyan-500" /> توزيع المعدات على المشاريع
          </h2>
          <p className="text-[11px] text-slate-400 mb-3">
            {data.lastEquipmentLogDate
              ? `من شيت الـ day — آخر يوم مسجل: ${String(data.lastEquipmentLogDate).slice(0, 10)}`
              : "من شيت الـ day (آخر يوم مسجل)"}
          </p>
          {data.equipmentByProject.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-14">لا توجد معدات</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data.equipmentByProject}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {data.equipmentByProject.map((_, i) => (
                      <Cell key={i} fill={PROJECT_COLORS[i % PROJECT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ direction: "rtl", fontSize: 12, borderRadius: 8 }}
                    formatter={(v, n) => [`${fmtVal(v)} معدة`, n]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-1 max-h-40 overflow-y-auto">
                {data.equipmentByProject.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-600 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: PROJECT_COLORS[i % PROJECT_COLORS.length] }}
                      />
                      {p.name}
                    </span>
                    <span className="font-mono font-bold text-slate-800">{p.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* آخر النشاطات */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={cardCls}>
          <h2 className="text-sm font-bold text-slate-700 mb-3">آخر سجلات السراكي</h2>
          <div className="space-y-2">
            {data.recentLogs.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 text-xs border-b border-slate-100 pb-2 last:border-0">
                <div className="min-w-0">
                  <p className="font-bold text-slate-700 font-mono">{l.equipment.code}</p>
                  <p className="text-slate-400">{l.date}</p>
                </div>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0",
                    l.condition === "GOOD"
                      ? "bg-emerald-100 text-emerald-700"
                      : l.condition === "BROKEN"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                  )}
                >
                  {l.condition ? CONDITION_LABELS[l.condition] : "—"}
                </span>
              </div>
            ))}
            {data.recentLogs.length === 0 && <p className="text-slate-400 text-sm text-center py-6">لا توجد سجلات</p>}
          </div>
        </div>

        <div className={cardCls}>
          <h2 className="text-sm font-bold text-slate-700 mb-3">آخر أوامر الصيانة</h2>
          <div className="space-y-2">
            {data.recentMaintenance.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 text-xs border-b border-slate-100 pb-2 last:border-0">
                <div className="min-w-0">
                  <p className="font-bold text-slate-700 font-mono">
                    {m.workOrderNo ?? "—"} · {m.equipment.code}
                  </p>
                  <p className="text-slate-400 truncate" title={m.description ?? ""}>
                    {m.description || "بدون وصف"}
                  </p>
                </div>
                <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0", MAINT_STATUS_CLS[m.status] ?? "bg-slate-100 text-slate-600")}>
                  {MAINT_STATUS_LABELS[m.status] ?? m.status}
                </span>
              </div>
            ))}
            {data.recentMaintenance.length === 0 && (
              <p className="text-slate-400 text-sm text-center py-6">لا توجد أوامر</p>
            )}
          </div>
        </div>

        <div className={cardCls}>
          <h2 className="text-sm font-bold text-slate-700 mb-3">آخر الأعطال</h2>
          <div className="space-y-2">
            {data.recentFaults.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 text-xs border-b border-slate-100 pb-2 last:border-0">
                <div className="min-w-0">
                  <p className="font-bold text-slate-700 font-mono">{f.equipment.code}</p>
                  <p className="text-slate-400 truncate" title={f.description}>
                    {f.description}
                  </p>
                </div>
                <div className="text-left shrink-0">
                  <p className="text-slate-400">{f.date}</p>
                  {f.downtimeHours != null && (
                    <p className="text-red-600 font-bold">{f.downtimeHours} ساعة</p>
                  )}
                </div>
              </div>
            ))}
            {data.recentFaults.length === 0 && (
              <p className="text-slate-400 text-sm text-center py-6">لا توجد أعطال مسجلة</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
