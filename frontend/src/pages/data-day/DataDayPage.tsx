import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, Pencil, Loader2, X } from "lucide-react";
import { cn, todayLocal, CONDITION_LABELS } from "@/lib/utils";
import { getApiError } from "@/lib/api";
import { listAllDailyLogs, exportDailyLogs } from "@/services/dailylogs";
import { projectOptions } from "@/services/projects";
import type { DailyLog, Project } from "@/types";

interface ColFilters {
  dateFrom: string;
  dateTo: string;
  code: string;
  name: string;
  projectId: string;
  meterStartFrom: string;
  meterStartTo: string;
  meterEndFrom: string;
  meterEndTo: string;
  hoursFrom: string;
  hoursTo: string;
  dieselFrom: string;
  dieselTo: string;
  productivity: string;
  condition: string;
  notes: string;
  user: string;
}

const emptyFilters: ColFilters = {
  dateFrom: "",
  dateTo: "",
  code: "",
  name: "",
  projectId: "",
  meterStartFrom: "",
  meterStartTo: "",
  meterEndFrom: "",
  meterEndTo: "",
  hoursFrom: "",
  hoursTo: "",
  dieselFrom: "",
  dieselTo: "",
  productivity: "",
  condition: "",
  notes: "",
  user: "",
};

const fInput =
  "w-full min-w-0 text-[11px] px-1.5 py-1 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500";

const thCls =
  "px-3 py-2 text-right text-xs font-bold text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap sticky top-[45px] z-20 h-[36px]";
const tfCls =
  "px-1.5 py-1 bg-slate-50/80 border-b-2 border-slate-200 sticky top-[81px] z-20 align-top";
const tdCls = "px-3 py-2 text-[13px] text-slate-700 border-b border-slate-100 align-middle";

export default function DataDayPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ColFilters>(emptyFilters);
  const [records, setRecords] = useState<DailyLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState<Pick<Project, "id" | "name">[]>([]);

  const numOrU = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const strOrU = (v: string) => (v.trim() === "" ? undefined : v.trim());

  const buildParams = () => {
    const params: Record<string, unknown> = {};
    const map: [keyof ColFilters, string][] = [
      ["code", "code"],
      ["name", "name"],
      ["productivity", "productivity"],
      ["notes", "notes"],
      ["user", "user"],
      ["dateFrom", "dateFrom"],
      ["dateTo", "dateTo"],
      ["condition", "condition"],
    ];
    for (const [key, param] of map) {
      const v = strOrU(filters[key]);
      if (v !== undefined) params[param] = v;
    }
    if (filters.projectId) params.projectId = filters.projectId;
    const nums: [keyof ColFilters, string][] = [
      ["meterStartFrom", "meterStartFrom"],
      ["meterStartTo", "meterStartTo"],
      ["meterEndFrom", "meterEndFrom"],
      ["meterEndTo", "meterEndTo"],
      ["hoursFrom", "hoursFrom"],
      ["hoursTo", "hoursTo"],
      ["dieselFrom", "dieselFrom"],
      ["dieselTo", "dieselTo"],
    ];
    for (const [key, param] of nums) {
      const v = numOrU(filters[key]);
      if (v !== undefined && !Number.isNaN(v)) params[param] = v;
    }
    return params;
  };

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAllDailyLogs(buildParams());
      setRecords(res.data);
      setTotal(res.total);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(loadRecords, 300);
    return () => clearTimeout(t);
  }, [loadRecords]);

  useEffect(() => {
    projectOptions()
      .then(setProjects)
      .catch(() => {});
  }, []);

  const setF = (key: keyof ColFilters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const isFiltered = Object.values(filters).some((v) => v !== "");

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportDailyLogs(buildParams());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `سجلات-يومية-${todayLocal()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("تم تنزيل ملف CSV");
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setExporting(false);
    }
  };

  const num = (v: number | null | undefined) =>
    v == null ? (
      <span className="text-slate-300">—</span>
    ) : (
      <bdi dir="ltr" className="font-mono">
        {v}
      </bdi>
    );

  const rangeCell = (from: keyof ColFilters, to: keyof ColFilters, step?: string) => (
    <div className="flex gap-1">
      <input
        type="number"
        dir="ltr"
        step={step}
        value={filters[from]}
        onChange={(e) => setF(from, e.target.value)}
        placeholder="من"
        className={fInput}
      />
      <input
        type="number"
        dir="ltr"
        step={step}
        value={filters[to]}
        onChange={(e) => setF(to, e.target.value)}
        placeholder="إلى"
        className={fInput}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">عرض السجلات اليومية</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            كل السجلات في جدول واحد — فلتر لكل عمود — DATA DAY
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {exporting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Download size={15} />
          )}
          تصدير CSV
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full min-w-[1250px] border-collapse">
            <thead>
              <tr>
                <th className={thCls}>التاريخ</th>
                <th className={thCls}>الكود</th>
                <th className={thCls}>اسم المعدة</th>
                <th className={thCls}>المشروع</th>
                <th className={cn(thCls, "text-center")}>بداية</th>
                <th className={cn(thCls, "text-center")}>نهاية</th>
                <th className={cn(thCls, "text-center")}>ساعات</th>
                <th className={cn(thCls, "text-center")}>ديزل</th>
                <th className={thCls}>الإنتاجية</th>
                <th className={thCls}>الصلاحية</th>
                <th className={thCls}>ملاحظات</th>
                <th className={cn(thCls, "text-center")}>المستخدم</th>
                <th className={cn(thCls, "text-center")}>تعديل</th>
              </tr>
              <tr>
                <td className={tfCls}>
                  <div className="flex gap-1">
                    <input
                      type="date"
                      dir="ltr"
                      value={filters.dateFrom}
                      onChange={(e) => setF("dateFrom", e.target.value)}
                      className={fInput}
                      title="من تاريخ"
                    />
                    <input
                      type="date"
                      dir="ltr"
                      value={filters.dateTo}
                      onChange={(e) => setF("dateTo", e.target.value)}
                      className={fInput}
                      title="إلى تاريخ"
                    />
                  </div>
                </td>
                <td className={tfCls}>
                  <input
                    value={filters.code}
                    onChange={(e) => setF("code", e.target.value)}
                    placeholder="بحث..."
                    className={fInput}
                  />
                </td>
                <td className={tfCls}>
                  <input
                    value={filters.name}
                    onChange={(e) => setF("name", e.target.value)}
                    placeholder="بحث..."
                    className={fInput}
                  />
                </td>
                <td className={tfCls}>
                  <select
                    value={filters.projectId}
                    onChange={(e) => setF("projectId", e.target.value)}
                    className={fInput}
                  >
                    <option value="">الكل</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={tfCls}>{rangeCell("meterStartFrom", "meterStartTo")}</td>
                <td className={tfCls}>{rangeCell("meterEndFrom", "meterEndTo")}</td>
                <td className={tfCls}>{rangeCell("hoursFrom", "hoursTo", "any")}</td>
                <td className={tfCls}>{rangeCell("dieselFrom", "dieselTo", "any")}</td>
                <td className={tfCls}>
                  <input
                    value={filters.productivity}
                    onChange={(e) => setF("productivity", e.target.value)}
                    placeholder="بحث..."
                    className={fInput}
                  />
                </td>
                <td className={tfCls}>
                  <select
                    value={filters.condition}
                    onChange={(e) => setF("condition", e.target.value)}
                    className={fInput}
                  >
                    <option value="">الكل</option>
                    <option value="GOOD">صالح</option>
                    <option value="BROKEN">عاطل</option>
                    <option value="STOPPED">متوقف</option>
                  </select>
                </td>
                <td className={tfCls}>
                  <input
                    value={filters.notes}
                    onChange={(e) => setF("notes", e.target.value)}
                    placeholder="بحث..."
                    className={fInput}
                  />
                </td>
                <td className={tfCls}>
                  <input
                    value={filters.user}
                    onChange={(e) => setF("user", e.target.value)}
                    placeholder="بحث..."
                    className={fInput}
                  />
                </td>
                <td className={cn(tfCls, "text-center")}>
                  {isFiltered && (
                    <button
                      onClick={() => setFilters(emptyFilters)}
                      title="مسح كل الفلاتر"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </td>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-slate-400 text-sm">
                    <Loader2 size={18} className="animate-spin inline ml-2" />
                    جاري تحميل السجلات...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-slate-400 text-sm">
                    لا توجد سجلات مطابقة
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <tr
                    key={rec.id}
                    className="hover:bg-primary-50/50 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_41px]"
                  >
                    <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                      {rec.date.slice(0, 10)}
                    </td>
                    <td className={cn(tdCls, "font-mono text-primary-700 font-semibold")} dir="ltr">
                      {rec.equipment.code}
                    </td>
                    <td className={cn(tdCls, "font-semibold whitespace-nowrap")}>
                      {rec.equipment.name}
                    </td>
                    <td className={cn(tdCls, "text-xs text-slate-500 whitespace-nowrap")}>
                      {rec.equipment.project?.name || "—"}
                    </td>
                    <td className={cn(tdCls, "text-center")}>{num(rec.startMeter)}</td>
                    <td className={cn(tdCls, "text-center")}>{num(rec.endMeter)}</td>
                    <td className={cn(tdCls, "text-center font-semibold")}>
                      {num(rec.operatingHours)}
                    </td>
                    <td className={cn(tdCls, "text-center")}>{num(rec.diesel)}</td>
                    <td className={cn(tdCls, "text-xs text-slate-500 max-w-[120px] truncate")}>
                      {rec.productivity || "—"}
                    </td>
                    <td className={tdCls}>
                      {rec.condition ? (
                        <span
                          title={rec.conditionNote || undefined}
                          className={cn(
                            "inline-block text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap",
                            rec.condition === "GOOD" && "bg-emerald-100 text-emerald-700",
                            rec.condition === "BROKEN" && "bg-red-100 text-red-700",
                            rec.condition === "STOPPED" && "bg-amber-100 text-amber-700"
                          )}
                        >
                          {CONDITION_LABELS[rec.condition]}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td
                      className={cn(tdCls, "text-xs text-slate-500 max-w-[180px] truncate")}
                      title={rec.notes || ""}
                    >
                      {rec.notes || "—"}
                    </td>
                    <td className={cn(tdCls, "text-center text-xs text-slate-400")}>
                      {rec.user?.name || "—"}
                    </td>
                    <td className={cn(tdCls, "text-center")}>
                      <button
                        onClick={() => navigate("/day", { state: { edit: rec } })}
                        title="تعديل في شاشة DAY"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-100 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-slate-500">
            إجمالي <b className="text-slate-700">{total}</b> سجل
            {isFiltered && " بعد الفلترة"} — يُعرض الكل
            {loading && <Loader2 size={12} className="animate-spin inline mr-1.5" />}
          </span>
          <span className="text-xs text-slate-400">مرّر الجدول لأسفل لرؤية بقية السجلات</span>
        </div>
      </div>
    </div>
  );
}
