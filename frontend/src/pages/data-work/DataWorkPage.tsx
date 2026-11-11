import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, Pencil, Loader2, X } from "lucide-react";
import {
  cn,
  todayLocal,
  ORDER_TYPES,
  MAINT_TYPES,
  WORKSHOPS,
  MAINT_STATUS_LABELS as STATUS_LABELS,
  MAINT_STATUS_CLS as STATUS_CLS,
} from "@/lib/utils";
import { getApiError } from "@/lib/api";
import { listAllMaintenance, exportMaintenance } from "@/services/maintenance";
import { projectOptions } from "@/services/projects";
import type { Maintenance, Project } from "@/types";

interface ColFilters {
  workOrderNo: string;
  dateFrom: string;
  dateTo: string;
  endDateFrom: string;
  endDateTo: string;
  code: string;
  name: string;
  projectId: string;
  orderType: string;
  maintenanceType: string;
  workshop: string;
  meterFrom: string;
  meterTo: string;
  status: string;
  description: string;
  part: string;
  notes: string;
  user: string;
}

const emptyFilters: ColFilters = {
  workOrderNo: "",
  dateFrom: "",
  dateTo: "",
  endDateFrom: "",
  endDateTo: "",
  code: "",
  name: "",
  projectId: "",
  orderType: "",
  maintenanceType: "",
  workshop: "",
  meterFrom: "",
  meterTo: "",
  status: "",
  description: "",
  part: "",
  notes: "",
  user: "",
};

const fInput =
  "w-full min-w-0 text-[11px] px-1.5 py-1 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500";

const thCls =
  "px-3 py-2 text-right text-xs font-bold text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap h-[36px]";
const tfCls =
  "px-1.5 py-1 bg-slate-50/80 border-b-2 border-slate-200 align-top";
const tdCls = "px-3 py-2 text-[13px] text-slate-700 border-b border-slate-100 align-middle";

export default function DataWorkPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ColFilters>(emptyFilters);
  const [records, setRecords] = useState<Maintenance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState<Pick<Project, "id" | "name">[]>([]);
  const [detail, setDetail] = useState<Maintenance | null>(null);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const numOrU = (v: string) => {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };
  const strOrU = (v: string) => (v.trim() === "" ? undefined : v.trim());

  const buildParams = () => {
    const params: Record<string, unknown> = {};
    const strs: (keyof ColFilters)[] = [
      "code",
      "name",
      "orderType",
      "maintenanceType",
      "workshop",
      "description",
      "part",
      "notes",
      "user",
      "dateFrom",
      "dateTo",
      "endDateFrom",
      "endDateTo",
    ];
    for (const key of strs) {
      const v = strOrU(filters[key]);
      if (v !== undefined) params[key] = v;
    }
    if (filters.projectId) params.projectId = filters.projectId;
    if (filters.status) params.status = filters.status;
    const nums: (keyof ColFilters)[] = ["workOrderNo", "meterFrom", "meterTo"];
    for (const key of nums) {
      const v = numOrU(filters[key]);
      if (v !== undefined) params[key] = v;
    }
    return params;
  };

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAllMaintenance(buildParams());
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
      const blob = await exportMaintenance(buildParams());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `أعمال-صيانة-${todayLocal()}.csv`;
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

  const textF = (key: keyof ColFilters, placeholder = "بحث...") => (
    <input
      value={filters[key]}
      onChange={(e) => setF(key, e.target.value)}
      placeholder={placeholder}
      className={fInput}
    />
  );

  const selectF = (key: keyof ColFilters, options: [string, string][]) => (
    <select value={filters[key]} onChange={(e) => setF(key, e.target.value)} className={fInput}>
      <option value="">الكل</option>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );

  const partsTitle = (rec: Maintenance) =>
    (rec.workParts ?? []).map((p) => (p.qty != null ? `${p.name} (${p.qty})` : p.name)).join("، ");

  const dField = (label: string, value: string | number | null | undefined, mono = false) => (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 mb-0.5">{label}</div>
      <div
        className={cn("text-[13px] text-slate-700 font-semibold", mono && "font-mono")}
        dir={mono ? "ltr" : undefined}
      >
        {value === null || value === undefined || value === "" ? (
          <span className="text-slate-300 font-normal">—</span>
        ) : (
          value
        )}
      </div>
    </div>
  );

  const dSection = (label: string, value: string) => (
    <div>
      <div className="text-[11px] font-bold text-slate-500 mb-1">{label}</div>
      <p className="text-[13px] leading-6 text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-line">
        {value}
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">عرض أعمال الصيانة</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            كل أوامر الشغل في جدول واحد — فلتر لكل عمود — DATA WORK
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
          <table className="w-full min-w-[1680px] border-collapse">
            <thead>
              <tr>
                <th className={cn(thCls, "text-center")}>رقم أمر الشغل</th>
                <th className={thCls}>التاريخ</th>
                <th className={thCls}>تاريخ الخروج</th>
                <th className={thCls}>الكود</th>
                <th className={thCls}>اسم المعدة</th>
                <th className={thCls}>المشروع</th>
                <th className={thCls}>نوع أمر الشغل</th>
                <th className={thCls}>نوع الصيانة</th>
                <th className={thCls}>الورشة</th>
                <th className={cn(thCls, "text-center")}>العداد النهائي</th>
                <th className={thCls}>الحالة</th>
                <th className={thCls}>وصف الشغل</th>
                <th className={thCls}>قطع الغيار</th>
                <th className={thCls}>ملاحظات</th>
                <th className={cn(thCls, "text-center")}>المستخدم</th>
                <th className={cn(thCls, "text-center")}>تعديل</th>
              </tr>
              <tr>
                <td className={cn(tfCls, "text-center")}>
                  <input
                    type="number"
                    dir="ltr"
                    value={filters.workOrderNo}
                    onChange={(e) => setF("workOrderNo", e.target.value)}
                    placeholder="رقم..."
                    className={fInput}
                  />
                </td>
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
                  <div className="flex gap-1">
                    <input
                      type="date"
                      dir="ltr"
                      value={filters.endDateFrom}
                      onChange={(e) => setF("endDateFrom", e.target.value)}
                      className={fInput}
                      title="من تاريخ"
                    />
                    <input
                      type="date"
                      dir="ltr"
                      value={filters.endDateTo}
                      onChange={(e) => setF("endDateTo", e.target.value)}
                      className={fInput}
                      title="إلى تاريخ"
                    />
                  </div>
                </td>
                <td className={tfCls}>{textF("code")}</td>
                <td className={tfCls}>{textF("name")}</td>
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
                <td className={tfCls}>
                  {selectF(
                    "orderType",
                    ORDER_TYPES.map((t) => [t, t] as [string, string])
                  )}
                </td>
                <td className={tfCls}>
                  {selectF(
                    "maintenanceType",
                    MAINT_TYPES.map((t) => [t, t] as [string, string])
                  )}
                </td>
                <td className={tfCls}>
                  {selectF(
                    "workshop",
                    WORKSHOPS.map((w) => [w, w] as [string, string])
                  )}
                </td>
                <td className={tfCls}>{rangeCell("meterFrom", "meterTo")}</td>
                <td className={tfCls}>
                  {selectF("status", Object.entries(STATUS_LABELS))}
                </td>
                <td className={tfCls}>{textF("description")}</td>
                <td className={tfCls}>{textF("part", "صنف...")}</td>
                <td className={tfCls}>{textF("notes")}</td>
                <td className={tfCls}>{textF("user")}</td>
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
                  <td colSpan={16} className="px-4 py-10 text-center text-slate-400 text-sm">
                    <Loader2 size={18} className="animate-spin inline ml-2" />
                    جاري تحميل أوامر الشغل...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-4 py-10 text-center text-slate-400 text-sm">
                    لا توجد أوامر شغل مطابقة
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <tr
                    key={rec.id}
                    onClick={() => setDetail(rec)}
                    title="اضغط لعرض تفاصيل أمر الشغل"
                    className="hover:bg-primary-50/50 transition-colors cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_41px]"
                  >
                    <td className={cn(tdCls, "text-center font-mono font-semibold text-primary-700")}>
                      {rec.workOrderNo != null ? rec.workOrderNo : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                      {rec.date.slice(0, 10)}
                    </td>
                    <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                      {rec.endDate ? rec.endDate.slice(0, 10) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={cn(tdCls, "font-mono text-primary-700 font-semibold")} dir="ltr">
                      {rec.equipment.code}
                    </td>
                    <td className={cn(tdCls, "font-semibold whitespace-nowrap")}>
                      {rec.equipment.name}
                    </td>
                    <td className={cn(tdCls, "text-xs text-slate-500 whitespace-nowrap")}>
                      {rec.projectName || rec.projectCode || "غير محدد"}
                    </td>
                    <td className={cn(tdCls, "text-xs whitespace-nowrap")}>{rec.orderType || "—"}</td>
                    <td className={cn(tdCls, "text-xs whitespace-nowrap text-slate-600")}>
                      {rec.maintenanceType || "—"}
                    </td>
                    <td className={cn(tdCls, "text-xs whitespace-nowrap text-slate-500")}>
                      {rec.workshop || "—"}
                    </td>
                    <td className={cn(tdCls, "text-center font-semibold")}>
                      {num(rec.meterReading)}
                    </td>
                    <td className={tdCls}>
                      <span
                        className={cn(
                          "inline-block text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap",
                          STATUS_CLS[rec.status]
                        )}
                      >
                        {STATUS_LABELS[rec.status] || rec.status}
                      </span>
                    </td>
                    <td
                      className={cn(tdCls, "text-xs text-slate-500 max-w-[170px] truncate")}
                      title={rec.description || ""}
                    >
                      {rec.description || "—"}
                    </td>
                    <td
                      className={cn(tdCls, "text-xs whitespace-nowrap")}
                      title={partsTitle(rec)}
                    >
                      {rec.workParts && rec.workParts.length > 0 ? (
                        <span className="bg-slate-100 text-slate-600 font-semibold rounded-full px-2 py-0.5 text-[11px]">
                          {rec.workParts.length}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td
                      className={cn(tdCls, "text-xs text-slate-500 max-w-[150px] truncate")}
                      title={rec.notes || ""}
                    >
                      {rec.notes || "—"}
                    </td>
                    <td className={cn(tdCls, "text-center text-xs text-slate-400")}>
                      {rec.user?.name || "—"}
                    </td>
                    <td className={cn(tdCls, "text-center")}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate("/work", { state: { edit: rec } });
                        }}
                        title="تعديل في شاشة WORK"
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
            إجمالي <b className="text-slate-700">{total}</b> أمر شغل
            {isFiltered && " بعد الفلترة"} — يُعرض الكل
            {loading && <Loader2 size={12} className="animate-spin inline mr-1.5" />}
          </span>
          <span className="text-xs text-slate-400">مرّر الجدول لأسفل لرؤية بقية السجلات</span>
        </div>
      </div>

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3 rounded-t-2xl">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-lg font-bold font-mono text-primary-700" dir="ltr">
                    {detail.workOrderNo != null ? `#${detail.workOrderNo}` : "بدون رقم"}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-bold rounded-full px-2 py-0.5",
                      STATUS_CLS[detail.status]
                    )}
                  >
                    {STATUS_LABELS[detail.status]}
                  </span>
                  {detail.maintenanceType && (
                    <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                      {detail.maintenanceType}
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-600 mt-1 truncate">
                  <bdi dir="ltr" className="font-mono text-primary-700 font-semibold">
                    {detail.equipment.code}
                  </bdi>
                  <span className="mx-1.5 text-slate-300">|</span>
                  {detail.equipment.name}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => {
                    const rec = detail;
                    setDetail(null);
                    navigate("/work", { state: { edit: rec } });
                  }}
                  title="تعديل في شاشة WORK"
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:text-primary-800 bg-primary-50 hover:bg-primary-100 rounded-lg px-3 py-2 transition-colors"
                >
                  <Pencil size={14} />
                  تعديل
                </button>
                <button
                  onClick={() => setDetail(null)}
                  title="إغلاق (Esc)"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
                {dField("تاريخ الدخول", detail.date.slice(0, 10), true)}
                {dField(
                  "تاريخ الخروج",
                  detail.endDate ? detail.endDate.slice(0, 10) : "",
                  true
                )}
                {dField("المشروع", detail.projectName || detail.projectCode || "غير محدد")}
                {dField("القطاع", detail.sectorName || "غير محدد")}
                {dField("نوع أمر الشغل", detail.orderType)}
                {dField("الورشة", detail.workshop)}
                {dField("العداد النهائي", detail.meterReading, true)}
                {detail.kmMeter != null && dField("عداد الكيلومترات", detail.kmMeter, true)}
                {dField("المستخدم", detail.user?.name || "")}
              </div>

              {detail.description && dSection("وصف الشغل", detail.description)}
              {detail.action && dSection("الإجراء المتخذ", detail.action)}
              {detail.notes && dSection("ملاحظات", detail.notes)}

              <div>
                <div className="text-[11px] font-bold text-slate-500 mb-1.5">
                  قطع الغيار
                  {detail.workParts && detail.workParts.length > 0 && (
                    <span className="text-slate-400 font-normal">
                      {" "}
                      ({detail.workParts.length})
                    </span>
                  )}
                </div>
                {!detail.workParts || detail.workParts.length === 0 ? (
                  <p className="text-xs text-slate-400">لا توجد قطع غيار مسجلة</p>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[1fr_110px_70px_1fr] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600">
                      <span>الصنف</span>
                      <span>الكود</span>
                      <span className="text-center">الكمية</span>
                      <span>ملاحظات</span>
                    </div>
                    {detail.workParts.map((p, i) => (
                      <div
                        key={p.id ?? i}
                        className="grid grid-cols-[1fr_110px_70px_1fr] gap-2 px-3 py-2 border-b border-slate-100 last:border-0 text-[13px] text-slate-700 items-center"
                      >
                        <span className="font-semibold">{p.name}</span>
                        <bdi dir="ltr" className="font-mono text-xs text-slate-500">
                          {p.code || "—"}
                        </bdi>
                        <span className="text-center font-mono">
                          {p.qty != null ? p.qty : "—"}
                        </span>
                        <span className="text-xs text-slate-500 truncate" title={p.notes || ""}>
                          {p.notes || "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
