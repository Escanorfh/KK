import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import toast from "react-hot-toast";
import {
  Loader2,
  Droplets,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  X,
  Search,
  Package,
  Fuel,
  Printer,
  Info,
} from "lucide-react";
import { cn, formatDate, todayLocal } from "@/lib/utils";
import { getApiError } from "@/lib/api";
import { projectOptions } from "@/services/projects";
import { lookupEquipment } from "@/services/equipments";
import type { Project } from "@/types";
import {
  listOilConsumptions,
  getOilConsumptionSummary,
  createOilConsumption,
  updateOilConsumption,
  deleteOilConsumption,
  syncOilConsumptions,
  OIL_TYPES,
  OIL_TYPE_LABELS,
  OIL_TYPE_DOT,
  OIL_SOURCE_LABELS,
  type OilConsumption,
  type OilConsumptionPayload,
  type OilSummaryResponse,
  type OilType,
} from "@/services/oilConsumptions";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[12px] font-bold text-slate-600 mb-1.5";

function fmtLiters(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function OilTypeBadge({ type }: { type: OilType }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 whitespace-nowrap">
      <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", OIL_TYPE_DOT[type])} />
      {OIL_TYPE_LABELS[type]}
    </span>
  );
}

function SourceBadge({ source }: { source: OilConsumption["source"] }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap",
        source === "MANUAL" ? "bg-primary-50 text-primary-700" : "bg-slate-100 text-slate-600"
      )}
    >
      {OIL_SOURCE_LABELS[source]}
    </span>
  );
}

const emptyForm = (): OilConsumptionPayload & { equipmentCode: string; equipmentLabel: string } => ({
  date: todayLocal(),
  equipmentId: 0,
  equipmentCode: "",
  equipmentLabel: "",
  oilType: "ENGINE",
  oilName: "",
  liters: 0,
  pricePerLiter: null,
  notes: "",
});

export default function OilConsumptionsPage() {
  const [view, setView] = useState<"list" | "form">("list");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OilConsumption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [summary, setSummary] = useState<OilSummaryResponse | null>(null);

  const [projects, setProjects] = useState<Pick<Project, "id" | "code" | "name">[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [oilType, setOilType] = useState<OilType | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [eqQ, setEqQ] = useState("");
  const [eqSuggestions, setEqSuggestions] = useState<{ id: number; code: string; name: string }[]>([]);
  const [eqLoading, setEqLoading] = useState(false);
  const [printRows, setPrintRows] = useState<OilConsumption[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, pageSize };
      if (projectId) params.projectId = projectId;
      if (oilType) params.oilType = oilType;
      if (from) params.from = from;
      if (to) params.to = to;
      if (q.trim()) params.q = q.trim();

      const [listRes, sumRes] = await Promise.all([
        listOilConsumptions(params),
        getOilConsumptionSummary({
          ...(projectId ? { projectId } : {}),
          ...(oilType ? { oilType } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        }),
      ]);
      setRows(listRes.data);
      setTotal(listRes.total);
      setSummary(sumRes);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, projectId, oilType, from, to, q]);

  useEffect(() => {
    projectOptions().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // البحث عن المعدة بالكود (debounce)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!eqQ.trim() || form.equipmentId) {
      setEqSuggestions([]);
      return;
    }
    setEqLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await lookupEquipment(eqQ.trim());
        setEqSuggestions(found.slice(0, 8).map((e) => ({ id: e.id, code: e.code, name: e.name })));
      } catch {
        setEqSuggestions([]);
      } finally {
        setEqLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [eqQ, form.equipmentId]);

  const openCreate = () => {
    setForm(emptyForm());
    setEditId(null);
    setEqQ("");
    setEqSuggestions([]);
    setView("form");
  };

  const openEdit = (rec: OilConsumption) => {
    setForm({
      date: rec.date.slice(0, 10),
      equipmentId: rec.equipment.id,
      equipmentCode: rec.equipment.code,
      equipmentLabel: `${rec.equipment.code} — ${rec.equipment.name}`,
      oilType: rec.oilType,
      oilName: rec.oilName ?? "",
      liters: rec.liters,
      pricePerLiter: rec.pricePerLiter,
      notes: rec.notes ?? "",
    });
    setEditId(rec.id);
    setEqQ("");
    setEqSuggestions([]);
    setView("form");
  };

  const pickEquipment = (eq: { id: number; code: string; name: string }) => {
    setForm((f) => ({
      ...f,
      equipmentId: eq.id,
      equipmentCode: eq.code,
      equipmentLabel: `${eq.code} — ${eq.name}`,
    }));
    setEqQ("");
    setEqSuggestions([]);
  };

  const handleSave = async () => {
    const errors: string[] = [];
    if (!form.equipmentId) errors.push("اختر المعدة من القائمة");
    if (!form.liters || form.liters <= 0) errors.push("الكمية باللترات لازم تكون أكبر من صفر");
    if (errors.length) {
      toast.error(errors.join(" · "));
      return;
    }
    setSaving(true);
    try {
      const payload: OilConsumptionPayload = {
        date: form.date,
        equipmentId: form.equipmentId,
        oilType: form.oilType,
        oilName: form.oilName?.trim() || null,
        liters: form.liters,
        pricePerLiter: form.pricePerLiter,
        notes: form.notes?.trim() || null,
      };
      if (editId) {
        await updateOilConsumption(editId, payload);
        toast.success("تم تعديل قيد الاستهلاك");
      } else {
        await createOilConsumption(payload);
        toast.success("تم تسجيل الاستهلاك");
      }
      setView("list");
      load();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("متأكد من حذف قيد الاستهلاك ده؟")) return;
    setDeletingId(id);
    try {
      await deleteOilConsumption(id);
      toast.success("تم حذف القيد");
      load();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setDeletingId(null);
    }
  };

  // الطباعة بتجمع كل الصفحات المفلترة (مش الصفحة الحالية بس)
  const handlePrint = async () => {
    try {
      const params: Record<string, unknown> = { page: 1, pageSize: 500 };
      if (projectId) params.projectId = projectId;
      if (oilType) params.oilType = oilType;
      if (from) params.from = from;
      if (to) params.to = to;
      if (q.trim()) params.q = q.trim();
      const res = await listOilConsumptions(params);
      flushSync(() => setPrintRows(res.data));
      window.print();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const handleSync = async () => {    setSyncing(true);
    try {
      const res = await syncOilConsumptions();
      if (res.created === 0) {
        toast("مفيش استهلكات جديدة — كل أوامر الصيانة مستوردة بالفعل", { icon: "✅" });
      } else {
        toast.success(`تم استيراد ${res.created} قيد من أوامر الصيانة`);
      }
      load();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setSyncing(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const grand = summary?.grand;

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
      {/* ===================== شاشة النموذج ===================== */}
      {view === "form" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
        >
          {/* ترويسة النموذج */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setView("list")}
                title="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors shrink-0"
              >
                <X size={18} />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-slate-800 truncate">
                  {editId ? "تعديل قيد استهلاك زيت" : "تسجيل استهلاك زيت — إضافة جديد"}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  سجّل المعدة والتاريخ ونوع الزيت والكمية باللترات — يظهر في ملخص المشروع مباشرة
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setView("list")}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 shrink-0"
            >
              القائمة
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* بانر تنبيه */}
            <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5">
              <Info size={16} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[12px] text-amber-800 leading-relaxed">
                اختر كود المعدة أولًا — هتتعرض بيانات المعدة تلقائيًا. القيد بيتحدّث في ملخص استهلكات
                المشروع (محرك / هيدروليك / فيتيس / ترس) على طول.
              </p>
            </div>

            {/* قسم بيانات الاستهلاك */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <Droplets size={15} className="text-primary-600" />
                <h3 className="text-[13px] font-extrabold text-slate-700">بيانات الاستهلاك</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* المعدة */}
                <div className="relative">
                  <label className={labelCls}>
                    كود المعدة <span className="text-red-500">*</span>
                  </label>
                  {form.equipmentId ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
                      <span className="text-sm font-bold text-primary-800 truncate">
                        {form.equipmentLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({ ...f, equipmentId: 0, equipmentCode: "", equipmentLabel: "" }))
                        }
                        className="text-xs font-bold text-primary-600 hover:text-primary-800 shrink-0"
                      >
                        تغيير
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        dir="ltr"
                        value={eqQ}
                        onChange={(e) => setEqQ(e.target.value)}
                        placeholder="اكتب كود المعدة... (مثال: EX121)"
                        className={cn(inputCls, "pr-9 font-mono")}
                      />
                      {eqLoading && (
                        <Loader2
                          size={14}
                          className="animate-spin absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                      )}
                      {eqSuggestions.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                          {eqSuggestions.map((eq) => (
                            <button
                              key={eq.id}
                              type="button"
                              onClick={() => pickEquipment(eq)}
                              className="w-full text-right px-3 py-2 text-sm hover:bg-primary-50 flex items-center justify-between gap-2"
                            >
                              <span className="font-mono text-xs font-bold text-primary-700">{eq.code}</span>
                              <span className="text-slate-600 text-xs">{eq.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className={labelCls}>
                    التاريخ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>
                    نوع الزيت <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.oilType}
                    onChange={(e) => setForm((f) => ({ ...f, oilType: e.target.value as OilType }))}
                    className={inputCls}
                  >
                    {OIL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {OIL_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>اسم الزيت (اختياري)</label>
                  <input
                    value={form.oilName ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, oilName: e.target.value }))}
                    placeholder="مثال: Shell Rimula 15W-40"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>
                    الكمية (لتر) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={form.liters || ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, liters: e.target.value === "" ? 0 : Number(e.target.value) }))
                    }
                    className={cn(inputCls, "font-mono")}
                  />
                </div>

                <div>
                  <label className={labelCls}>سعر اللتر (اختياري)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.pricePerLiter ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        pricePerLiter: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    className={cn(inputCls, "font-mono")}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className={labelCls}>ملاحظات</label>
                  <textarea
                    rows={2}
                    value={form.notes ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="سبب الصرف، رقم إذن الصرف..."
                    className={cn(inputCls, "resize-y")}
                  />
                </div>
              </div>

              {/* الإجمالي المحسوب */}
              {form.liters > 0 && (
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                  <Fuel size={15} className="text-primary-600" />
                  <span className="text-[12px] font-bold text-slate-600">إجمالي القيد:</span>
                  <span className="text-sm font-extrabold text-slate-800 font-mono">
                    {fmtLiters(form.liters)} لتر
                  </span>
                  {form.pricePerLiter != null && form.pricePerLiter > 0 && (
                    <>
                      <span className="text-slate-300">|</span>
                      <span className="text-sm font-extrabold text-primary-700 font-mono">
                        {fmtMoney(form.liters * form.pricePerLiter)} ج.م
                      </span>
                    </>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* شريط الأزرار السفلي */}
          <div className="flex items-center gap-2 px-5 py-3 bg-slate-50 border-t border-slate-200">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 text-sm font-bold rounded-lg bg-primary-600 text-white px-5 py-2.5 hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Droplets size={15} />}
              {editId ? "حفظ التعديلات" : "تسجيل الاستهلاك"}
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className="text-sm font-bold rounded-lg border border-slate-300 text-slate-600 px-4 py-2.5 hover:bg-slate-100"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* ===================== شاشة القائمة ===================== */}
      {view === "list" && (
        <>
          {/* الترويسة */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                <Droplets size={22} className="text-primary-600" />
                استهلكات الزيوت
              </h1>
              <p className="text-[12px] text-slate-500 mt-0.5">
                معدة × تاريخ × نوع الزيت — للمراجعة عند طلب الزيت من فرع الصيانة الرئيسي
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 px-3 py-2 hover:bg-slate-100 disabled:opacity-60"
                title="استيراد استهلكات الزيوت من أوامر الصيانة تلقائيًا"
              >
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                استيراد من الصيانة
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 px-3 py-2 hover:bg-slate-100"
              >
                <Printer size={14} />
                طباعة
              </button>
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 text-sm font-bold rounded-lg bg-primary-600 text-white px-4 py-2 hover:bg-primary-700"
              >
                <Plus size={16} />
                تسجيل استهلاك
              </button>
            </div>
          </div>

          {/* شريط الملخص المضغوط */}
          {summary && (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-bold text-slate-500">إجمالي اللترات</span>
                <span className="text-lg font-extrabold text-slate-800 font-mono">
                  {fmtLiters(grand?.liters)}
                </span>
                <span className="text-[10px] font-bold text-slate-400">لتر</span>
                <span className="text-[10px] text-slate-400">({grand?.entries ?? 0} قيد)</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-bold text-slate-500">إجمالي القيمة</span>
                <span className="text-lg font-extrabold text-slate-800 font-mono">
                  {fmtMoney(grand?.amount)}
                </span>
                {grand?.amount != null && <span className="text-[10px] font-bold text-slate-400">ج.م</span>}
              </div>
              <div className="w-px h-6 bg-slate-200 hidden md:block" />
              {OIL_TYPES.map((type) => {
                const bucket = grand?.byType[type];
                return (
                  <div key={type} className="flex items-baseline gap-1.5">
                    <span className={cn("w-2.5 h-2.5 rounded-full inline-block", OIL_TYPE_DOT[type])} />
                    <span className="text-[11px] font-bold text-slate-600">{OIL_TYPE_LABELS[type]}</span>
                    <span className="text-sm font-extrabold text-slate-800 font-mono">
                      {fmtLiters(bucket?.liters)}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">لتر</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* ملخص المشاريع × نوع الزيت */}
          {summary && summary.projects.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                <Package size={15} className="text-primary-600" />
                <h2 className="text-[13px] font-extrabold text-slate-700">
                  مجموع استهلاك كل مشروع حسب نوع الزيت
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-[11px] text-slate-500 bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2 font-bold">المشروع</th>
                      {OIL_TYPES.map((type) => (
                        <th key={type} className="px-3 py-2 font-bold whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn("w-2 h-2 rounded-full", OIL_TYPE_DOT[type])} />
                            {OIL_TYPE_LABELS[type]}
                          </span>
                        </th>
                      ))}
                      <th className="px-3 py-2 font-bold">الإجمالي (لتر)</th>
                      <th className="px-3 py-2 font-bold">القيمة (ج.م)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.projects.map((p) => (
                      <tr key={p.projectId ?? 0} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="px-4 py-2 font-bold text-slate-700 whitespace-nowrap">{p.projectName}</td>
                        {OIL_TYPES.map((type) => (
                          <td key={type} className="px-3 py-2 font-mono text-xs text-slate-700">
                            {p.byType[type].entries > 0 ? (
                              fmtLiters(p.byType[type].liters)
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-2 font-extrabold text-slate-800 font-mono">
                          {fmtLiters(p.totalLiters)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">{fmtMoney(p.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-extrabold text-slate-800">
                      <td className="px-4 py-2">الكل</td>
                      {OIL_TYPES.map((type) => (
                        <td key={type} className="px-3 py-2 font-mono text-xs">
                          {fmtLiters(grand?.byType[type]?.liters)}
                        </td>
                      ))}
                      <td className="px-3 py-2 font-mono">{fmtLiters(grand?.liters)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{fmtMoney(grand?.amount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* الفلاتر */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-5 gap-3 print:hidden">
            <div>
              <label className={labelCls}>المشروع</label>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value === "" ? "" : Number(e.target.value));
                  setPage(1);
                }}
                className={inputCls}
              >
                <option value="">كل المشاريع</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} — ` : ""}
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>نوع الزيت</label>
              <select
                value={oilType}
                onChange={(e) => {
                  setOilType(e.target.value as OilType | "");
                  setPage(1);
                }}
                className={inputCls}
              >
                <option value="">كل الأنواع</option>
                {OIL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {OIL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>من تاريخ</label>
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>إلى تاريخ</label>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>بحث (معدة / زيت)</label>
              <div className="relative">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder="كود المعدة أو اسم الزيت..."
                  className={cn(inputCls, "pr-9")}
                />
              </div>
            </div>
          </div>

          {/* جدول الاستهلكات */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-extrabold text-slate-700 flex items-center gap-2">
                <Fuel size={15} className="text-primary-600" />
                سجل الاستهلكات
                <span className="text-[11px] font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                  {total}
                </span>
              </h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 size={22} className="animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-16">
                مفيش استهلكات مسجّلة — سجّل استهلاك يدوي أو استورد من أوامر الصيانة
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-[11px] text-slate-500 bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 font-bold w-10">م</th>
                      <th className="px-3 py-2 font-bold">التاريخ</th>
                      <th className="px-3 py-2 font-bold">المعدة</th>
                      <th className="px-3 py-2 font-bold">المشروع الحالي</th>
                      <th className="px-3 py-2 font-bold">نوع الزيت</th>
                      <th className="px-3 py-2 font-bold">اسم الزيت</th>
                      <th className="px-3 py-2 font-bold">الكمية (لتر)</th>
                      <th className="px-3 py-2 font-bold">سعر اللتر</th>
                      <th className="px-3 py-2 font-bold">الإجمالي</th>
                      <th className="px-3 py-2 font-bold">المصدر</th>
                      <th className="px-3 py-2 font-bold print:hidden w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((rec, i) => (
                      <tr key={rec.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-2 text-xs text-slate-400 font-mono">
                          {(page - 1) * pageSize + i + 1}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatDate(rec.date)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-mono text-xs text-primary-700 font-bold">
                            {rec.equipment.code}
                          </span>
                          <span className="text-[11px] text-slate-500 mr-1.5">{rec.equipment.name}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                          {rec.equipment.project?.name ?? <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <OilTypeBadge type={rec.oilType} />
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">{rec.oilName ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs font-extrabold text-slate-800">
                          {fmtLiters(rec.liters)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {rec.pricePerLiter != null ? fmtMoney(rec.pricePerLiter) : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">
                          {rec.totalAmount != null ? fmtMoney(rec.totalAmount) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <SourceBadge source={rec.source} />
                        </td>
                        <td className="px-3 py-2 print:hidden">
                          <div className="flex items-center gap-1 justify-end">
                            {rec.source === "MANUAL" && (
                              <>
                                <button
                                  onClick={() => openEdit(rec)}
                                  title="تعديل"
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-primary-50 hover:text-primary-600"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={() => handleDelete(rec.id)}
                                  disabled={deletingId === rec.id}
                                  title="حذف"
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                >
                                  {deletingId === rec.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={14} />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ترقيم الصفحات */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 print:hidden">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="text-xs font-bold text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-100 disabled:opacity-40"
                >
                  السابق
                </button>
                <span className="text-xs text-slate-500">
                  صفحة {page} من {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="text-xs font-bold text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-100 disabled:opacity-40"
                >
                  التالي
                </button>
              </div>
            )}
          </div>
        </>
      )}
      </div>

      {/* ===== نموذج الطباعة A4 (بنية تقرير حالة المعدات) ===== */}
      {printRows && (
        <div className="print-area hidden print:block bg-white text-slate-900">
          <img src="/logo.jpeg" alt="شركة قاصد خير" className="w-full block select-none" draggable={false} />

          <div className="px-6 pb-6 pt-4">
            <h2 className="text-center text-2xl font-extrabold text-emerald-800 mb-4">تقرير استهلكات الزيوت</h2>

            {/* شريط البيانات */}
            <div dir="ltr" className="flex items-stretch justify-center border border-slate-800 mb-5 text-sm font-semibold">
              <div className="px-4 py-2 border-l border-slate-800 min-w-[160px] text-center font-mono">
                {from || to
                  ? `${from ? formatDate(from) : "…"} — ${to ? formatDate(to) : "…"}`
                  : "كل الفترات"}
              </div>
              <div className="px-4 py-2 border-l border-slate-800 min-w-[70px] text-center">الفترة</div>
              <div className="px-4 py-2 border-l border-slate-800 min-w-[160px] text-center">
                {projectId ? projects.find((p) => p.id === projectId)?.name || "" : "كل المشاريع"}
              </div>
              <div className="px-4 py-2 min-w-[140px] text-center">بيان استهلكات الزيوت</div>
            </div>

            {/* ملخص الأنواع */}
            <div dir="ltr" className="grid grid-cols-6 border border-slate-800 mb-5 text-sm">
              <div className="px-2 py-2 border-l border-slate-800 font-bold text-center bg-slate-100">
                الإجمالي (لتر)
              </div>
              {OIL_TYPES.slice()
                .reverse()
                .map((type) => (
                  <div
                    key={type}
                    className="px-2 py-2 border-l border-slate-800 font-bold text-center bg-slate-100"
                  >
                    {OIL_TYPE_LABELS[type]}
                  </div>
                ))}
              <div className="px-2 py-2 border-l border-t border-slate-800 font-extrabold text-center">
                {fmtLiters(grand?.liters)}
              </div>
              {OIL_TYPES.slice()
                .reverse()
                .map((type) => (
                  <div
                    key={type}
                    className="px-2 py-2 border-l border-t border-slate-800 font-extrabold text-center"
                  >
                    {fmtLiters(grand?.byType[type]?.liters)}
                  </div>
                ))}
            </div>

            {/* جدول المشاريع */}
            {summary && summary.projects.length > 0 && (
              <>
                <h3 className="text-center font-bold text-slate-800 mb-2">بيان باستهلكات المشاريع</h3>
                <table dir="ltr" className="w-full border-collapse text-sm mb-5">
                  <thead>
                    <tr>
                      <th className="border border-slate-800 px-2 py-2 font-bold text-center bg-slate-100">
                        القيمة (ج.م)
                      </th>
                      <th className="border border-slate-800 px-2 py-2 font-bold text-center bg-slate-100 w-[110px]">
                        الإجمالي (لتر)
                      </th>
                      {OIL_TYPES.slice()
                        .reverse()
                        .map((type) => (
                          <th
                            key={type}
                            className="border border-slate-800 px-2 py-2 font-bold text-center bg-slate-100"
                          >
                            {OIL_TYPE_LABELS[type]}
                          </th>
                        ))}
                      <th className="border border-slate-800 px-2 py-2 font-bold text-center bg-slate-100 w-[180px]">
                        المشروع
                      </th>
                      <th className="border border-slate-800 px-2 py-2 font-bold text-center bg-slate-100 w-[45px]">
                        م
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.projects.map((p, i) => (
                      <tr key={p.projectId ?? 0}>
                        <td className="border border-slate-800 px-2 py-1.5 text-center font-mono">
                          {fmtMoney(p.totalAmount)}
                        </td>
                        <td className="border border-slate-800 px-2 py-1.5 text-center font-mono font-bold">
                          {fmtLiters(p.totalLiters)}
                        </td>
                        {OIL_TYPES.slice()
                          .reverse()
                          .map((type) => (
                            <td key={type} className="border border-slate-800 px-2 py-1.5 text-center font-mono">
                              {p.byType[type].entries > 0 ? fmtLiters(p.byType[type].liters) : "—"}
                            </td>
                          ))}
                        <td className="border border-slate-800 px-2 py-1.5 text-right align-top font-semibold">
                          {p.projectName}
                        </td>
                        <td className="border border-slate-800 px-2 py-1.5 text-center align-top font-semibold">
                          {i + 1}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* جدول التفاصيل */}
            <h3 className="text-center font-bold text-slate-800 mb-2">بيان تفصيلي بالاستهلكات</h3>
            {printRows.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">لا توجد استهلكات في هذا التحديد</div>
            ) : (
              <table dir="ltr" className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border border-slate-800 px-2 py-2 font-bold text-center">اسم الزيت</th>
                    <th className="border border-slate-800 px-2 py-2 font-bold text-center w-[95px]">
                      نوع الزيت
                    </th>
                    <th className="border border-slate-800 px-2 py-2 font-bold text-center w-[130px]">
                      المشروع الحالي
                    </th>
                    <th className="border border-slate-800 px-2 py-2 font-bold text-center w-[90px]">الكود</th>
                    <th className="border border-slate-800 px-2 py-2 font-bold text-center w-[110px]">
                      التاريخ
                    </th>
                    <th className="border border-slate-800 px-2 py-2 font-bold text-center w-[80px]">
                      اللتر
                    </th>
                    <th className="border border-slate-800 px-2 py-2 font-bold text-center w-[90px]">
                      الإجمالي
                    </th>
                    <th className="border border-slate-800 px-2 py-2 font-bold text-center w-[45px]">م</th>
                  </tr>
                </thead>
                <tbody>
                  {printRows.map((rec, i) => (
                    <tr key={rec.id}>
                      <td className="border border-slate-800 px-2 py-1.5 text-right align-top">
                        {rec.oilName || "—"}
                      </td>
                      <td className="border border-slate-800 px-2 py-1.5 text-center align-top">
                        {OIL_TYPE_LABELS[rec.oilType]}
                      </td>
                      <td className="border border-slate-800 px-2 py-1.5 text-center align-top">
                        {rec.equipment.project?.name ?? "—"}
                      </td>
                      <td className="border border-slate-800 px-2 py-1.5 text-center align-top font-mono font-semibold">
                        {rec.equipment.code}
                      </td>
                      <td className="border border-slate-800 px-2 py-1.5 text-center align-top font-mono">
                        {formatDate(rec.date)}
                      </td>
                      <td className="border border-slate-800 px-2 py-1.5 text-center align-top font-mono font-bold">
                        {fmtLiters(rec.liters)}
                      </td>
                      <td className="border border-slate-800 px-2 py-1.5 text-center align-top font-mono">
                        {rec.totalAmount != null ? fmtMoney(rec.totalAmount) : "—"}
                      </td>
                      <td className="border border-slate-800 px-2 py-1.5 text-center align-top font-semibold">
                        {i + 1}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="text-center text-[11px] text-slate-500 mt-4 font-semibold">
              إجمالي القيمة المطبوعة: {fmtMoney(grand?.amount)} ج.م — عدد القيود: {printRows.length}
            </div>

            <div className="text-center text-[10px] text-slate-400 mt-5 print:text-slate-500">build by Gen Code</div>
          </div>
        </div>
      )}
    </div>
  );
}
