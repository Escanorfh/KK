import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Loader2,
  Search,
  FilePlus2,
  Printer,
  ArrowRight,
  Trash2,
  Pencil,
  X,
  Send,
  RefreshCw,
} from "lucide-react";
import { cn, todayLocal } from "@/lib/utils";
import { getApiError, getApiFieldErrors } from "@/lib/api";
import { isQueued } from "@/lib/offline/queue";
import { lookupEquipment } from "@/services/equipments";
import {
  createRepairOrder,
  updateRepairOrder,
  changeRepairOrderStatus,
  deleteRepairOrder,
  listRepairOrders,
  getRepairOrder,
  sendRepairOrder,
  syncRepairOrder,
  REPAIR_STATUS_LABELS,
  REPAIR_STATUS_CLS,
  REPAIR_ITEM_CONDITIONS,
  REPAIR_UNITS,
  NEXT_STATUS_LABEL,
  STATUS_FLOW,
  type RepairOrder,
  type RepairOrderPayload,
  type RepairOrderStatus,
  type RepairItemCondition,
} from "@/services/repairOrders";
import { useAuth } from "@/context/AuthContext";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";
const tdCls = "border-b border-slate-100 px-3 py-2 text-sm";

const TYPE_LABELS = { INTERNAL: "داخلي", EXTERNAL: "خارجي" } as const;

const emptyForm: RepairOrderPayload = {
  type: "INTERNAL",
  equipmentId: 0,
  entryDate: todayLocal(),
  exitDate: null,
  hours: null,
  km: null,
  workshop: null,
  faultDescription: "",
  actionTaken: null,
  itemName: "",
  partModel: null,
  itemCode: null,
  technicalCode: null,
  quantity: 1,
  unit: "عدد",
  itemCondition: "عاطلة",
  siteName: null,
  requesterName: null,
  sourceWarehouseId: null,
  destinationWarehouseId: null,
  technicianPhone: null,
  imageUrl: null,
  imageBase64: null,
  estimatedCost: null,
  actualCost: null,
  notes: null,
  parts: [],
};

function StatusBadge({ status }: { status: RepairOrderStatus }) {
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap", REPAIR_STATUS_CLS[status])}>
      {REPAIR_STATUS_LABELS[status]}
    </span>
  );
}

export default function RepairOrdersPage() {
  const { user } = useAuth();
  const canManage = user?.role === "ROOT" || user?.role === "ADMIN";

  // قائمة
  const [rows, setRows] = useState<RepairOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listQ, setListQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | RepairOrderStatus>("");
  const [loading, setLoading] = useState(true);

  // view: list | form | detail
  const [view, setView] = useState<"list" | "form" | "detail">("list");
  const [form, setForm] = useState<RepairOrderPayload>(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<RepairOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // equipment lookup
  const [eqQ, setEqQ] = useState("");
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof lookupEquipment>>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const err = (k: string) => fieldErrors[k]?.[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listRepairOrders({ page, pageSize: 20, q: listQ || undefined, status: statusFilter || undefined });
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  }, [page, listQ, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!eqQ.trim()) {
      setSuggestions([]);
      return;
    }
    setLookupLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await lookupEquipment(eqQ.trim());
        setSuggestions(res);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLookupLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [eqQ]);

  const selectEquipment = (eq: (typeof suggestions)[number]) => {
    setForm((f) => ({
      ...f,
      equipmentId: eq.id,
      hours: f.hours ?? null,
      siteName: f.siteName || eq.sector?.name || null,
    }));
    setEqQ(eq.code);
    setShowSuggestions(false);
    setFieldErrors((e) => ({ ...e, equipmentId: [] }));
  };

  const openForm = (rec?: RepairOrder) => {
    setFieldErrors({});
    if (rec) {
      setEditId(rec.id);
      setForm({
        type: rec.type,
        equipmentId: rec.equipment.id,
        entryDate: rec.entryDate ?? null,
        exitDate: rec.exitDate ?? null,
        hours: rec.hours ?? null,
        km: rec.km ?? null,
        workshop: rec.workshop ?? null,
        faultDescription: rec.faultDescription,
        actionTaken: rec.actionTaken ?? null,
        itemName: rec.itemName ?? "",
        partModel: rec.partModel ?? null,
        itemCode: rec.itemCode ?? null,
        technicalCode: rec.technicalCode ?? null,
        quantity: rec.quantity ?? 1,
        unit: rec.unit || "عدد",
        itemCondition: (rec.itemCondition as RepairItemCondition) || "عاطلة",
        siteName: rec.siteName ?? rec.sector?.name ?? rec.equipment.sector?.name ?? null,
        requesterName: rec.requesterName ?? rec.createdBy?.name ?? null,
        sourceWarehouseId: rec.sourceWarehouseId ?? null,
        destinationWarehouseId: rec.destinationWarehouseId ?? null,
        technicianPhone: rec.technicianPhone ?? null,
        imageUrl: rec.imageUrl ?? null,
        imageBase64: rec.imageBase64 ?? null,
        estimatedCost: rec.estimatedCost ?? null,
        actualCost: rec.actualCost ?? null,
        notes: rec.notes ?? null,
        parts: (rec.parts ?? []).map((p) => ({ name: p.name, code: p.code, qty: p.qty, notes: p.notes })),
      });
      setEqQ(rec.equipment.code);
    } else {
      setEditId(null);
      setForm({ ...emptyForm, requesterName: user?.name ?? null });
      setEqQ("");
    }
    setView("form");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string[]> = {};
    if (!form.equipmentId) errors.equipmentId = ["اختر المعدة من القائمة"];
    if (!form.itemName.trim()) errors.itemName = ["اسم القطعة مطلوب"];
    if (!form.faultDescription.trim()) errors.faultDescription = ["وصف العطل مطلوب"];
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setSaving(true);
    setFieldErrors({});
    try {
      const payload = { ...form, parts: form.parts.filter((p) => p.name.trim()) };
      const res = editId ? await updateRepairOrder(editId, payload) : await createRepairOrder(payload);
      if (isQueued(res)) {
        toast("تم حفظ الطلب على الجهاز — سيُرسل للسيرفر تلقائيًا عند عودة الاتصال", { icon: "📴" });
        setView("list");
        setEditId(null);
        load();
        return;
      }
      toast.success(editId ? "تم تعديل الطلب" : `تم إنشاء طلب الإصلاح #${res.record.requestNo}`);
      setView("detail");
      setSelected(res.record);
    } catch (e) {
      const fe = getApiFieldErrors(e);
      if (Object.keys(fe).length) setFieldErrors(fe);
      else toast.error(getApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (id: number) => {
    setView("detail");
    setDetailLoading(true);
    setSelected(null);
    try {
      const res = await getRepairOrder(id);
      setSelected(res.record);
    } catch (e) {
      toast.error(getApiError(e));
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  };

  const advance = async () => {
    if (!selected) return;
    const step = NEXT_STATUS_LABEL[selected.status];
    if (!step) return;
    try {
      const res = await changeRepairOrderStatus(selected.id, step.next);
      setSelected(res.record);
      toast.success(step.label);
      load();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    try {
      await sendRepairOrder(selected.id);
      const res = await getRepairOrder(selected.id);
      setSelected(res.record);
      toast.success(`تم إرسال طلب الإصلاح #${selected.requestNo} إلى نظام المدرين`);
      load();
    } catch (e) {
      toast.error(getApiError(e));
      getRepairOrder(selected.id)
        .then((res) => setSelected(res.record))
        .catch(() => undefined);
    } finally {
      setSending(false);
    }
  };

  const handleSync = async () => {
    if (!selected) return;
    setSyncing(true);
    try {
      const res = await syncRepairOrder(selected.id);
      setSelected(res.record);
      toast.success("تم تحديث حالة أمر الإصلاح من نظام المدرين");
      load();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setSyncing(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const extra = selected.managersId ? " سيُحذف أيضًا من نظام المدرين." : "";
    if (!confirm(`حذف طلب الإصلاح #${selected.requestNo}؟${extra}`)) return;
    try {
      await deleteRepairOrder(selected.id);
      toast.success("تم الحذف");
      setView("list");
      setSelected(null);
      load();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const addPartRow = () =>
    setForm((f) => ({ ...f, parts: [...f.parts, { name: "", code: null, qty: null, notes: null }] }));

  const setPart = (i: number, patch: Partial<{ name: string; code: string | null; qty: number | null; notes: string | null }>) =>
    setForm((f) => ({ ...f, parts: f.parts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }));

  const removePart = (i: number) => setForm((f) => ({ ...f, parts: f.parts.filter((_, idx) => idx !== i) }));

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("حجم الصورة يجب ألا يتجاوز 5 ميجابايت");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setForm((f) => ({ ...f, imageBase64: typeof reader.result === "string" ? reader.result : null }));
    reader.onerror = () => toast.error("تعذر قراءة الصورة");
    reader.readAsDataURL(file);
  };

  const flowIdx = selected ? STATUS_FLOW.indexOf(selected.status) : -1;
  const nextStep = selected ? NEXT_STATUS_LABEL[selected.status] : undefined;

  return (
    <>
    <div className="no-print space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">طلبات الإصلاح</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            أمر إصلاح للمعدات — يُنشأ هنا ويُرسل إلى نظام المدرين، ثم يسير في مراحل الاستلام والإصلاح حتى العودة
            للموقع
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view !== "list" && (
            <button
              onClick={() => {
                setView("list");
                setSelected(null);
              }}
              className="flex items-center gap-1.5 text-sm font-bold rounded-lg border border-slate-300 text-slate-600 px-3 py-2 hover:bg-slate-50"
            >
              <X size={15} /> القائمة
            </button>
          )}
          {view === "list" && (
            <button
              onClick={() => openForm()}
              className="flex items-center gap-1.5 text-sm font-bold rounded-lg bg-primary-600 text-white px-4 py-2 hover:bg-primary-700"
            >
              <FilePlus2 size={15} /> طلب جديد
            </button>
          )}
        </div>
      </div>

      {view === "list" && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex items-center gap-3 flex-wrap">
            <div className="relative w-72">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={listQ}
                onChange={(e) => {
                  setListQ(e.target.value);
                  setPage(1);
                }}
                onKeyDown={(e) => e.key === "Enter" && load()}
                placeholder="بحث برقم الطلب أو كود المعدة أو وصف العطل..."
                className={cn(inputCls, "pr-9 w-full")}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as "" | RepairOrderStatus);
                setPage(1);
              }}
              className={cn(inputCls, "w-48")}
            >
              <option value="">كل الحالات</option>
              {STATUS_FLOW.map((s) => (
                <option key={s} value={s}>
                  {REPAIR_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400 font-mono mr-auto">{total} طلب</span>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr className="text-right text-xs text-slate-500">
                    <th className="px-3 py-2.5 font-semibold">رقم الطلب</th>
                    <th className="px-3 py-2.5 font-semibold">المعدة</th>
                    <th className="px-3 py-2.5 font-semibold">القطعة</th>
                    <th className="px-3 py-2.5 font-semibold">المشروع / القطاع</th>
                    <th className="px-3 py-2.5 font-semibold">النوع</th>
                    <th className="px-3 py-2.5 font-semibold">وصف العطل</th>
                    <th className="px-3 py-2.5 font-semibold">الحالة</th>
                    <th className="px-3 py-2.5 font-semibold">التاريخ</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="text-center py-14">
                        <Loader2 className="animate-spin text-slate-400 mx-auto" size={26} />
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-14 text-slate-400 text-sm">
                        لا توجد طلبات إصلاح
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(r.id)}>
                        <td className={cn(tdCls, "font-mono font-bold text-slate-700")}>{r.requestNo}</td>
                        <td className={tdCls}>
                          <span dir="ltr" className="font-mono text-xs text-primary-700 font-semibold">
                            {r.equipment.code}
                          </span>
                          <span className="text-xs text-slate-500 mr-2">{r.equipment.name}</span>
                        </td>
                        <td
                          className={cn(tdCls, "text-xs text-slate-600 max-w-[160px] truncate")}
                          title={r.itemName ?? ""}
                        >
                          {r.itemName || "—"}
                        </td>
                        <td className={cn(tdCls, "text-xs text-slate-600")}>
                          {r.project?.name || "—"}
                          {r.sector ? <span className="text-slate-400"> · {r.sector.name}</span> : null}
                        </td>
                        <td className={cn(tdCls, "text-xs")}>{TYPE_LABELS[r.type]}</td>
                        <td className={cn(tdCls, "text-xs text-slate-600 max-w-[220px] truncate")} title={r.faultDescription}>
                          {r.faultDescription}
                        </td>
                        <td className={tdCls}>
                          <StatusBadge status={r.status} />
                        </td>
                        <td className={cn(tdCls, "text-xs text-slate-400 font-mono")}>{r.createdAt.slice(0, 10)}</td>
                        <td className={cn(tdCls, "text-left")}>
                          <ArrowRight size={15} className="text-slate-300" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {total > 20 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-xs">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40"
                >
                  السابق
                </button>
                <span className="text-slate-500 font-mono">
                  {page} / {Math.ceil(total / 20)}
                </span>
                <button
                  disabled={page >= Math.ceil(total / 20)}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40"
                >
                  التالي
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {view === "form" && (
        <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">بيانات المعدة والطلب</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative" ref={boxRef}>
                <label className={labelCls}>
                  كود المعدة <span className="text-red-500">*</span>
                </label>
                <input
                  dir="ltr"
                  value={eqQ}
                  disabled={Boolean(editId && selected?.managersId)}
                  onChange={(e) => {
                    setEqQ(e.target.value);
                    setForm((f) => ({ ...f, equipmentId: 0 }));
                  }}
                  onFocus={() => suggestions.length && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  placeholder="اكتب الكود أو الاسم..."
                  className={cn(
                    inputCls,
                    "font-mono w-full disabled:bg-slate-100 disabled:text-slate-500",
                    err("equipmentId") && "border-red-400"
                  )}
                />
                {Boolean(editId && selected?.managersId) && (
                  <p className="text-[11px] text-amber-600 mt-1">لا يمكن تغيير المعدة بعد ربط الطلب بنظام المدرين</p>
                )}
                {lookupLoading && (
                  <Loader2 size={14} className="absolute left-2.5 top-9 animate-spin text-slate-400" />
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {suggestions.map((eq) => (
                      <button
                        key={eq.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectEquipment(eq)}
                        className="w-full text-right px-3 py-2 hover:bg-primary-50 border-b border-slate-100 last:border-0"
                      >
                        <span dir="ltr" className="font-mono text-xs text-primary-700 font-semibold">
                          {eq.code}
                        </span>
                        <span className="text-[13px] text-slate-700 mr-2">{eq.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {err("equipmentId") && <p className="text-xs text-red-600 mt-1">{err("equipmentId")}</p>}
              </div>

              <div>
                <label className={labelCls}>نوع الطلب</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "INTERNAL" | "EXTERNAL" }))}
                  className={cn(inputCls, "w-full")}
                >
                  <option value="INTERNAL">داخلي</option>
                  <option value="EXTERNAL">خارجي</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>تاريخ الدخول</label>
                <input
                  type="date"
                  value={form.entryDate ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value || null }))}
                  className={cn(inputCls, "w-full")}
                />
              </div>

              <div>
                <label className={labelCls}>تاريخ الخروج</label>
                <input
                  type="date"
                  value={form.exitDate ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, exitDate: e.target.value || null }))}
                  className={cn(inputCls, "w-full")}
                />
              </div>

              <div>
                <label className={labelCls}>الساعات (آخر عداد)</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.hours ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value === "" ? null : Number(e.target.value) }))}
                  className={cn(inputCls, "w-full")}
                />
              </div>

              <div>
                <label className={labelCls}>الكيلومترات</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.km ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, km: e.target.value === "" ? null : Number(e.target.value) }))}
                  className={cn(inputCls, "w-full")}
                />
              </div>

              <div>
                <label className={labelCls}>الورشة</label>
                <input
                  value={form.workshop ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, workshop: e.target.value || null }))}
                  placeholder="ورشة الموقع / المركز الرئيسي..."
                  className={cn(inputCls, "w-full")}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">
              بيانات القطعة المراد إصلاحها
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className={labelCls}>
                  اسم القطعة / الصنف <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.itemName}
                  onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))}
                  placeholder="مثال: طرمبة هيدروليك..."
                  className={cn(inputCls, "w-full", err("itemName") && "border-red-400")}
                />
                {err("itemName") && <p className="text-xs text-red-600 mt-1">{err("itemName")}</p>}
              </div>

              <div>
                <label className={labelCls}>موديل / طراز القطعة</label>
                <input
                  dir="ltr"
                  value={form.partModel ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, partModel: e.target.value || null }))}
                  className={cn(inputCls, "w-full font-mono text-xs")}
                />
              </div>

              <div>
                <label className={labelCls}>كود الصنف بالمخزن</label>
                <input
                  dir="ltr"
                  value={form.itemCode ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, itemCode: e.target.value || null }))}
                  className={cn(inputCls, "w-full font-mono text-xs")}
                />
              </div>

              <div>
                <label className={labelCls}>الكود الفني</label>
                <input
                  dir="ltr"
                  value={form.technicalCode ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, technicalCode: e.target.value || null }))}
                  placeholder="الافتراضي: كود المعدة"
                  className={cn(inputCls, "w-full font-mono text-xs")}
                />
              </div>

              <div>
                <label className={labelCls}>الكمية</label>
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) }))
                  }
                  className={cn(inputCls, "w-full")}
                />
              </div>

              <div>
                <label className={labelCls}>الوحدة</label>
                <input
                  list="repair-units"
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  className={cn(inputCls, "w-full")}
                />
                <datalist id="repair-units">
                  {REPAIR_UNITS.map((unit) => (
                    <option key={unit} value={unit} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className={labelCls}>حالة القطعة</label>
                <select
                  value={form.itemCondition}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, itemCondition: e.target.value as RepairItemCondition }))
                  }
                  className={cn(inputCls, "w-full")}
                >
                  {REPAIR_ITEM_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">
              الموقع ومقدم الطلب والمخازن
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className={labelCls}>الموقع</label>
                <input
                  value={form.siteName ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value || null }))}
                  placeholder="القطاع / الموقع..."
                  className={cn(inputCls, "w-full")}
                />
              </div>

              <div>
                <label className={labelCls}>اسم مقدم الطلب</label>
                <input
                  value={form.requesterName ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, requesterName: e.target.value || null }))}
                  placeholder={user?.name || "اسم مقدم الطلب"}
                  className={cn(inputCls, "w-full")}
                />
              </div>

              <div>
                <label className={labelCls}>هاتف الفني</label>
                <input
                  dir="ltr"
                  value={form.technicianPhone ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, technicianPhone: e.target.value || null }))}
                  placeholder="01xxxxxxxxx"
                  className={cn(inputCls, "w-full font-mono text-xs")}
                />
              </div>

              <div>
                <label className={labelCls}>مخزن الصرف (ID)</label>
                <input
                  type="number"
                  min={1}
                  value={form.sourceWarehouseId ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      sourceWarehouseId: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  className={cn(inputCls, "w-full font-mono text-xs")}
                />
              </div>

              <div>
                <label className={labelCls}>مخزن الاستلام (ID)</label>
                <input
                  type="number"
                  min={1}
                  value={form.destinationWarehouseId ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      destinationWarehouseId: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  className={cn(inputCls, "w-full font-mono text-xs")}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">وصف العطل والإجراء</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-3">
                <label className={labelCls}>
                  وصف العطل <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={form.faultDescription}
                  onChange={(e) => setForm((f) => ({ ...f, faultDescription: e.target.value }))}
                  placeholder="اكتب وصف العطل بالتفصيل..."
                  className={cn(inputCls, "w-full resize-y", err("faultDescription") && "border-red-400")}
                />
                {err("faultDescription") && <p className="text-xs text-red-600 mt-1">{err("faultDescription")}</p>}
              </div>

              <div className="md:col-span-3">
                <label className={labelCls}>الإجراء المتخذ</label>
                <textarea
                  rows={3}
                  value={form.actionTaken ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, actionTaken: e.target.value || null }))}
                  placeholder="الإجراء المتخذ (يُملأ من المدير/الورشة لاحقًا)..."
                  className={cn(inputCls, "w-full resize-y")}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">
              التكاليف والمرفقات والملاحظات
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className={labelCls}>التكلفة التقديرية</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.estimatedCost ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, estimatedCost: e.target.value === "" ? null : Number(e.target.value) }))
                  }
                  className={cn(inputCls, "w-full font-mono")}
                />
              </div>

              <div>
                <label className={labelCls}>التكلفة الفعلية</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.actualCost ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, actualCost: e.target.value === "" ? null : Number(e.target.value) }))
                  }
                  className={cn(inputCls, "w-full font-mono")}
                />
              </div>

              <div className="md:col-span-2">
                <label className={labelCls}>رابط صورة العطل</label>
                <input
                  dir="ltr"
                  value={form.imageUrl ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value || null }))}
                  placeholder="https://..."
                  className={cn(inputCls, "w-full font-mono text-xs")}
                />
              </div>

              <div className="md:col-span-2">
                <label className={labelCls}>إرفاق صورة (حتى 5 ميجابايت)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImagePick}
                    className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                  />
                  {form.imageBase64 && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, imageBase64: null }))}
                      className="shrink-0 text-xs font-bold text-red-500 hover:text-red-600"
                    >
                      إزالة
                    </button>
                  )}
                </div>
                {(form.imageBase64 || form.imageUrl) && (
                  <img
                    src={form.imageBase64 || form.imageUrl || ""}
                    alt="صورة العطل"
                    className="mt-2 h-20 w-20 rounded-lg object-cover border border-slate-200"
                  />
                )}
              </div>

              <div className="md:col-span-4">
                <label className={labelCls}>ملاحظات</label>
                <textarea
                  rows={2}
                  value={form.notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
                  placeholder="أي ملاحظات إضافية تُرسل مع أمر الإصلاح..."
                  className={cn(inputCls, "w-full resize-y")}
                />
              </div>
            </div>
          </section>

          <div className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-700">قطع الغيار والمستهلكات</h3>
              <button
                type="button"
                onClick={addPartRow}
                className="text-xs font-bold text-primary-600 hover:text-primary-700"
              >
                + إضافة صنف
              </button>
            </div>
            {form.parts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">لا توجد أصناف</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-right text-xs text-slate-500">
                      <th className="py-1.5 font-semibold w-8">م</th>
                      <th className="py-1.5 font-semibold">الصنف</th>
                      <th className="py-1.5 font-semibold w-36">الكود</th>
                      <th className="py-1.5 font-semibold w-28">الكمية</th>
                      <th className="py-1.5 font-semibold">ملاحظات</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.parts.map((p, i) => (
                      <tr key={i}>
                        <td className="py-1 text-xs text-slate-400 text-center font-mono">{i + 1}</td>
                        <td className="py-1 pr-1">
                          <input
                            value={p.name}
                            onChange={(e) => setPart(i, { name: e.target.value })}
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            dir="ltr"
                            value={p.code ?? ""}
                            onChange={(e) => setPart(i, { code: e.target.value || null })}
                            className={cn(inputCls, "w-full text-xs py-1.5 font-mono")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            type="number"
                            step="0.5"
                            value={p.qty ?? ""}
                            onChange={(e) => setPart(i, { qty: e.target.value === "" ? null : Number(e.target.value) })}
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            value={p.notes ?? ""}
                            onChange={(e) => setPart(i, { notes: e.target.value || null })}
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 text-center">
                          <button
                            type="button"
                            onClick={() => removePart(i)}
                            className="text-red-400 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 text-sm font-bold rounded-lg bg-primary-600 text-white px-5 py-2.5 hover:bg-primary-700 disabled:opacity-60"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
                {editId ? "حفظ التعديلات" : "إنشاء طلب الإصلاح"}
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className="text-sm font-bold rounded-lg border border-slate-300 text-slate-600 px-4 py-2.5 hover:bg-slate-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {view === "detail" && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {detailLoading || !selected ? (
            <div className="py-20 text-center">
              <Loader2 className="animate-spin text-slate-400 mx-auto" size={28} />
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-extrabold text-slate-800">#{selected.requestNo}</span>
                  <StatusBadge status={selected.status} />
                  <span className="text-xs text-slate-400">{TYPE_LABELS[selected.type]}</span>
                </div>
                <div className="flex items-center gap-2">
                  {selected.status === "PENDING" && (
                    <>
                      <button
                        onClick={() => openForm(selected)}
                        className="flex items-center gap-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 px-3 py-2 hover:bg-slate-50"
                      >
                        <Pencil size={14} /> تعديل
                      </button>
                      <button
                        onClick={remove}
                        className="flex items-center gap-1.5 text-xs font-bold rounded-lg border border-red-200 text-red-600 px-3 py-2 hover:bg-red-50"
                      >
                        <Trash2 size={14} /> حذف
                      </button>
                    </>
                  )}
                  {!selected.sentAt && !selected.managersId && (
                    <button
                      onClick={handleSend}
                      disabled={sending}
                      className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} إرسال إلى نظام
                      المدرين
                    </button>
                  )}
                  {selected.managersId && (
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className="flex items-center gap-1.5 text-xs font-bold rounded-lg border border-primary-200 text-primary-700 bg-primary-50 px-3 py-2 hover:bg-primary-100 disabled:opacity-60"
                    >
                      <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> تحديث الحالة
                    </button>
                  )}
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white px-3 py-2 hover:bg-slate-800"
                  >
                    <Printer size={14} /> طباعة الطلب
                  </button>
                  {canManage && nextStep && (
                    <button
                      onClick={advance}
                      className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700"
                    >
                      {nextStep.label}
                    </button>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">المعدة</p>
                    <p className="font-bold text-slate-700">
                      <span dir="ltr" className="font-mono text-primary-700">
                        {selected.equipment.code}
                      </span>{" "}
                      — {selected.equipment.name}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">المشروع / القطاع</p>
                    <p className="font-bold text-slate-700">
                      {selected.project?.name || selected.equipment.project?.name || "—"}
                      {(selected.sector || selected.equipment.sector) && (
                        <span className="text-slate-500 font-normal">
                          {" "}
                          · {selected.sector?.name ?? selected.equipment.sector?.name}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">العدادات</p>
                    <p className="font-bold text-slate-700 font-mono">
                      {selected.hours ?? "—"} س · {selected.km ?? "—"} كم
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">الورشة / التواريخ</p>
                    <p className="font-bold text-slate-700 text-xs">
                      {selected.workshop || "—"}
                      <br />
                      <span className="font-mono text-slate-500">
                        {selected.entryDate?.slice(0, 10) || "—"} ← {selected.exitDate?.slice(0, 10) || "—"}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">مرجع نظام المدرين</p>
                    <p className="font-bold text-slate-700 text-xs">{selected.managersRef || "—"}</p>
                    {selected.managersStatusLabel && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold">
                        {selected.managersStatusLabel}
                      </span>
                    )}
                    {selected.sentAt && (
                      <span className="block font-mono text-[10px] text-slate-400 font-normal mt-1">
                        أُرسل {selected.sentAt.slice(0, 16).replace("T", " ")}
                      </span>
                    )}
                    {selected.managersSyncedAt && (
                      <span className="block font-mono text-[10px] text-slate-400 font-normal">
                        آخر مزامنة {selected.managersSyncedAt.slice(0, 16).replace("T", " ")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">القطعة المراد إصلاحها</p>
                    <p className="font-bold text-slate-700">
                      {selected.itemName || selected.parts?.[0]?.name || selected.equipment.name}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                      {selected.partModel || "—"} · {selected.itemCode || "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">الكمية والحالة</p>
                    <p className="font-bold text-slate-700">
                      {selected.quantity ?? 1} {selected.unit || "عدد"} · {selected.itemCondition || "عاطلة"}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                      الكود الفني: {selected.technicalCode || selected.equipment.code}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">الموقع ومقدم الطلب</p>
                    <p className="font-bold text-slate-700">{selected.siteName || "—"}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {selected.requesterName || selected.createdBy?.name || "—"} ·{" "}
                      <span className="font-mono" dir="ltr">
                        {selected.technicianPhone || "—"}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-400 font-semibold">المخازن والتكاليف</p>
                    <p className="font-bold text-slate-700 font-mono">
                      {selected.sourceWarehouseId ?? "—"} ← {selected.destinationWarehouseId ?? "—"}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                      تقديري {selected.estimatedCost ?? "—"} · فعلي {selected.actualCost ?? "—"}
                    </p>
                  </div>
                </div>

                {selected.sendError && !selected.sentAt && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-xs font-bold text-red-700 mb-1">فشل الإرسال الأخير إلى نظام المدرين</p>
                    <p className="text-[11px] text-red-600 font-mono whitespace-pre-wrap">{selected.sendError}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-bold text-slate-500 mb-1">وصف العطل</p>
                  <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">
                    {selected.faultDescription}
                  </p>
                </div>
                {selected.actionTaken && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-1">الإجراء المتخذ</p>
                    <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">
                      {selected.actionTaken}
                    </p>
                  </div>
                )}

                {selected.notes && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-1">ملاحظات</p>
                    <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">
                      {selected.notes}
                    </p>
                  </div>
                )}

                {(selected.imageBase64 || selected.imageUrl) && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-2">صورة العطل</p>
                    <img
                      src={selected.imageBase64 || selected.imageUrl || ""}
                      alt="صورة العطل"
                      className="max-h-64 rounded-lg border border-slate-200 object-contain"
                    />
                  </div>
                )}

                <div>
                  <p className="text-xs font-bold text-slate-500 mb-2">قطع الغيار والمستهلكات</p>
                  {selected.parts && selected.parts.length > 0 ? (
                    <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                      <thead className="bg-slate-50">
                        <tr className="text-right text-xs text-slate-500">
                          <th className="px-3 py-2 font-semibold w-8">م</th>
                          <th className="px-3 py-2 font-semibold">الصنف</th>
                          <th className="px-3 py-2 font-semibold">الكود</th>
                          <th className="px-3 py-2 font-semibold">الكمية</th>
                          <th className="px-3 py-2 font-semibold">ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.parts.map((p, i) => (
                          <tr key={p.id ?? i}>
                            <td className={cn(tdCls, "text-center font-mono text-xs text-slate-400")}>{i + 1}</td>
                            <td className={cn(tdCls, "font-semibold")}>{p.name}</td>
                            <td className={cn(tdCls, "font-mono text-xs")}>{p.code || "—"}</td>
                            <td className={cn(tdCls, "text-center font-mono")}>{p.qty ?? "—"}</td>
                            <td className={cn(tdCls, "text-xs text-slate-500")}>{p.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-slate-400">لا توجد أصناف</p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-bold text-slate-500 mb-3">مسار الطلب</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {STATUS_FLOW.map((s, i) => (
                      <div key={s} className="flex items-center gap-1">
                        <div
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border",
                            i <= flowIdx
                              ? "bg-primary-50 border-primary-200 text-primary-700"
                              : "bg-slate-50 border-slate-200 text-slate-400"
                          )}
                        >
                          {i < flowIdx ? "✓" : i === flowIdx ? "●" : ""}
                          {REPAIR_STATUS_LABELS[s]}
                        </div>
                        {i < STATUS_FLOW.length - 1 && (
                          <ArrowRight size={12} className={i < flowIdx ? "text-primary-400" : "text-slate-300"} />
                        )}
                      </div>
                    ))}
                  </div>
                  {selected.events && selected.events.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {selected.events.map((ev) => (
                        <p key={ev.id} className="text-[11px] text-slate-500">
                          <span className="font-mono">{ev.createdAt.slice(0, 16).replace("T", " ")}</span> —{" "}
                          <b className="text-slate-600">{REPAIR_STATUS_LABELS[ev.status]}</b>
                          {ev.note ? ` · ${ev.note}` : ""} {ev.user ? `· ${ev.user.name}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>

    {/* ===== نموذج الطباعة A4 ===== */}
    {selected && (
      <div className="print-area hidden print:block bg-white text-slate-900">
        <div className="flex items-center justify-between mb-1">
          <div className="text-right">
            <p className="text-[13px] font-extrabold leading-tight">شركة قاصد خير للتوريدات العمومية</p>
            <p className="text-[13px] font-extrabold leading-tight">والمقاولات ش.م.م</p>
          </div>
          <img src="/kased-logo.png" alt="KASED KHAIR" className="h-11" />
        </div>
        <div className="text-right text-[12px] font-extrabold mb-1.5">
          طلب اصلاح في مركز الصيانة الرئيسي — رقم طلب اصلاح :{" "}
          <span className="text-red-600 font-mono">{selected.requestNo}</span>
        </div>

        <table className="w-full border-collapse text-[11px] mb-2">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold w-[26%]">
                طلب اصلاح ( داخلي - خارجي )
              </td>
              <td className="border border-black px-2 py-1.5 text-center font-bold w-[24%]">
                {TYPE_LABELS[selected.type]}
              </td>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold w-[26%]">رقم طلب الاصلاح</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono font-bold w-[24%]">
                {selected.requestNo}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">المشروع</td>
              <td className="border border-black px-2 py-1.5 text-center">
                {selected.project?.name || selected.equipment.project?.name || "—"}
              </td>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">تاريخ الدخول</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono">
                {selected.entryDate?.slice(0, 10) || "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">الكود</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono font-bold">
                {selected.equipment.code}
              </td>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">القطاع</td>
              <td className="border border-black px-2 py-1.5 text-center">
                {selected.sector?.name || selected.equipment.sector?.name || "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">اسم القطعة</td>
              <td className="border border-black px-2 py-1.5 text-center font-bold">
                {selected.itemName || selected.parts?.[0]?.name || selected.equipment.name}
              </td>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">كود الصنف</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono">
                {selected.itemCode || selected.parts?.[0]?.code || "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">موديل القطعة</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono">
                {selected.partModel || "—"}
              </td>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">الحالة / الكمية</td>
              <td className="border border-black px-2 py-1.5 text-center">
                {selected.itemCondition || "عاطلة"} · {selected.quantity ?? 1} {selected.unit || "عدد"}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">مقدم الطلب</td>
              <td className="border border-black px-2 py-1.5 text-center">
                {selected.requesterName || selected.createdBy?.name || "—"}
              </td>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">هاتف الفني</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono">
                {selected.technicianPhone || "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">الساعات</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono">
                {selected.hours ?? "—"}
              </td>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">الكيلومترات</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono">{selected.km ?? "—"}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">الورشة</td>
              <td className="border border-black px-2 py-1.5 text-center">{selected.workshop || "—"}</td>
              <td className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">تاريخ الخروج</td>
              <td className="border border-black px-2 py-1.5 text-center font-mono">
                {selected.exitDate?.slice(0, 10) || "—"}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="border border-black mb-2 px-2 py-1.5 min-h-[85px]">
          <p className="text-[11px]">
            <span className="font-extrabold">وصف العطل :</span>{" "}
            <span className="whitespace-pre-wrap">{selected.faultDescription}</span>
          </p>
        </div>

        <div className="border border-black mb-2 px-2 py-1.5 min-h-[85px]">
          <p className="text-[11px]">
            <span className="font-extrabold">الاجراء المتخذ :</span>{" "}
            <span className="whitespace-pre-wrap">{selected.actionTaken || ""}</span>
          </p>
        </div>

        {selected.notes && (
          <div className="border border-black mb-2 px-2 py-1.5">
            <p className="text-[11px]">
              <span className="font-extrabold">ملاحظات :</span>{" "}
              <span className="whitespace-pre-wrap">{selected.notes}</span>
            </p>
          </div>
        )}

        <p className="text-[11px] font-extrabold mb-1 text-right">قطع الغيار والمستهلكات :</p>
        <table className="w-full border-collapse text-[11px] mb-3">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1 bg-[#eeeae7] font-bold w-8">م</th>
              <th className="border border-black px-2 py-1 bg-[#eeeae7] font-bold">الصنف</th>
              <th className="border border-black px-2 py-1 bg-[#eeeae7] font-bold w-28">الكود</th>
              <th className="border border-black px-2 py-1 bg-[#eeeae7] font-bold w-24">الكمية</th>
              <th className="border border-black px-2 py-1 bg-[#eeeae7] font-bold">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => {
              const p = selected.parts?.[i];
              return (
                <tr key={i}>
                  <td className="border border-black px-2 py-1.5 text-center font-mono">{i + 1}</td>
                  <td className="border border-black px-2 py-1.5">{p?.name || ""}</td>
                  <td className="border border-black px-2 py-1.5 text-center font-mono">{p?.code || ""}</td>
                  <td className="border border-black px-2 py-1.5 text-center font-mono">{p?.qty ?? ""}</td>
                  <td className="border border-black px-2 py-1.5">{p?.notes || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">مهندس الصيانة بالمووقع</th>
              <th className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">مسؤول قسم المتابعة</th>
              <th className="border border-black px-2 py-1.5 bg-[#eeeae7] font-bold">مسؤول الورشة</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-2 py-6 text-center">التوقيع :</td>
              <td className="border border-black px-2 py-6 text-center">التوقيع :</td>
              <td className="border border-black px-2 py-6 text-center">التوقيع :</td>
            </tr>
          </tbody>
        </table>

        <div className="text-center text-[9px] text-slate-500 mt-3">build by Gen Code</div>
      </div>
    )}
    </>
  );
}
