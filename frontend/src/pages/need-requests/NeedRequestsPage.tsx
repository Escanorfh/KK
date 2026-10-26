import { useCallback, useEffect, useState } from "react";
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
import { projectOptions } from "@/services/projects";
import {
  createNeedRequest,
  updateNeedRequest,
  sendNeedRequest,
  syncNeedRequest,
  deleteNeedRequest,
  listNeedRequests,
  getNeedRequest,
  NEED_STATUS_LABELS,
  NEED_STATUS_CLS,
  NEED_STATUS_FLOW,
  type NeedRequest,
  type NeedRequestPayload,
  type NeedRequestItem,
  type NeedRequestStatus,
} from "@/services/needRequests";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";
const tdCls = "border-b border-slate-100 px-3 py-2 text-sm";

const printCell = "border border-black px-1.5 py-1.5";
const printLabel = "border border-black px-1.5 py-1.5 font-extrabold text-center";

function emptyItem(): NeedRequestItem {
  return {
    itemName: "",
    itemCode: null,
    unit: null,
    qty: null,
    equipmentRef: null,
    currentBalance: null,
    localSupply: null,
    foreignSupply: null,
    notes: null,
  };
}

const emptyForm: NeedRequestPayload = {
  projectId: null,
  department: "",
  requestDate: todayLocal(),
  items: [emptyItem()],
};

function StatusBadge({ status }: { status: NeedRequestStatus }) {
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap", NEED_STATUS_CLS[status])}>
      {NEED_STATUS_LABELS[status]}
    </span>
  );
}

function fmtDate(v?: string | null) {
  return v ? v.slice(0, 10).replace(/-/g, "/") : "—";
}

function fmtNum(v?: number | null) {
  return v === null || v === undefined ? "" : String(v);
}

export default function NeedRequestsPage() {
  const [rows, setRows] = useState<NeedRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listQ, setListQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | NeedRequestStatus>("");
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<{ id: number; name: string; code?: string | null }[]>([]);

  const [view, setView] = useState<"list" | "form" | "detail">("list");
  const [form, setForm] = useState<NeedRequestPayload>(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [lockProject, setLockProject] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<NeedRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const err = (k: string) => {
    const v = fieldErrors[k]?.[0];
    return typeof v === "string" ? v : undefined;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNeedRequests({
        page,
        pageSize: 20,
        q: listQ || undefined,
        status: statusFilter || undefined,
      });
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
    projectOptions()
      .then(setProjects)
      .catch(() => undefined);
  }, []);

  const openForm = (rec?: NeedRequest) => {
    setFieldErrors({});
    setLockProject(Boolean(rec?.managersId));
    if (rec) {
      setEditId(rec.id);
      setForm({
        projectId: rec.projectId ?? rec.project?.id ?? null,
        department: rec.department,
        requestDate: rec.requestDate.slice(0, 10),
        items: (rec.items ?? []).map((it) => ({ ...it })),
      });
    } else {
      setEditId(null);
      setForm(emptyForm);
    }
    setView("form");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string[]> = {};
    if (!form.projectId) fe.projectId = ["اختر المشروع"];
    if (!form.department.trim()) fe.department = ["الجهة الطالبة مطلوبة"];
    const items = form.items.filter((it) => it.itemName.trim());
    if (!items.length) fe.items = ["أضف صنفًا واحدًا على الأقل"];
    if (Object.keys(fe).length) {
      setFieldErrors(fe);
      return;
    }
    setSaving(true);
    setFieldErrors({});
    try {
      const payload: NeedRequestPayload = {
        projectId: form.projectId ?? null,
        department: form.department.trim(),
        requestDate: form.requestDate,
        items: items.map((it) => ({
          itemName: it.itemName.trim(),
          itemCode: it.itemCode || null,
          unit: it.unit || null,
          qty: it.qty,
          equipmentRef: it.equipmentRef || null,
          currentBalance: it.currentBalance,
          localSupply: it.localSupply,
          foreignSupply: it.foreignSupply,
          notes: it.notes || null,
        })),
      };
      const res = editId ? await updateNeedRequest(editId, payload) : await createNeedRequest(payload);
      if (isQueued(res)) {
        toast("تم حفظ الطلب على الجهاز — سيُرسل للسيرفر تلقائيًا عند عودة الاتصال", { icon: "📴" });
        setView("list");
        setEditId(null);
        load();
        return;
      }
      toast.success(editId ? "تم تعديل الطلب" : `تم إنشاء طلب الاحتياج رقم ${res.record.requestNoText}`);
      setView("detail");
      setSelected(res.record);
      load();
    } catch (e) {
      const fe2 = getApiFieldErrors(e);
      if (Object.keys(fe2).length) setFieldErrors(fe2);
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
      const res = await getNeedRequest(id);
      setSelected(res.record);
    } catch (e) {
      toast.error(getApiError(e));
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSend = async () => {
    if (!selected) return;
    if (!selected.projectId) {
      toast.error("اختر المشروع أولًا من شاشة التعديل قبل الإرسال");
      return;
    }
    setSending(true);
    try {
      const res = await sendNeedRequest(selected.id);
      setSelected(res.record);
      toast.success(`تم إرسال الطلب رقم ${res.record.requestNoText} إلى نظام المدرين`);
      load();
    } catch (e) {
      toast.error(getApiError(e));
      getNeedRequest(selected.id)
        .then((res) => setSelected(res.record))
        .catch(() => undefined);
      load();
    } finally {
      setSending(false);
    }
  };

  const handleSync = async () => {
    if (!selected) return;
    setSyncing(true);
    try {
      const res = await syncNeedRequest(selected.id);
      setSelected(res.record);
      toast.success("تم تحديث حالة الطلب من نظام المدرين");
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
    if (!confirm(`حذف طلب الاحتياج رقم ${selected.requestNoText}؟${extra}`)) return;
    try {
      await deleteNeedRequest(selected.id);
      toast.success("تم الحذف");
      setView("list");
      load();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const addItemRow = () => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));

  const setItem = (i: number, patch: Partial<NeedRequestItem>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));

  const removeItem = (i: number) => setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const linked = Boolean(selected?.managersId);
  const canEdit = Boolean(selected && (selected.status !== "SENT" || linked));
  const canSend = Boolean(selected && !linked && selected.status !== "SENT");
  const printRows = selected?.items ?? [];
  const padCount = Math.max(0, 9 - printRows.length);

  return (
    <>
      <div className="no-print space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-slate-800">طلبات الاحتياج</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              نموذج طلب احتياج المواد والأصناف — يُرسل إلى نظام المدرين
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
                  placeholder="بحث برقم الطلب أو المشروع أو الجهة أو اسم الصنف..."
                  className={cn(inputCls, "pr-9 w-full")}
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as "" | NeedRequestStatus);
                  setPage(1);
                }}
                className={cn(inputCls, "w-48")}
              >
                <option value="">كل الحالات</option>
                {NEED_STATUS_FLOW.map((s) => (
                  <option key={s} value={s}>
                    {NEED_STATUS_LABELS[s]}
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
                      <th className="px-3 py-2.5 font-semibold">المشروع</th>
                      <th className="px-3 py-2.5 font-semibold">الجهة الطالبة</th>
                      <th className="px-3 py-2.5 font-semibold">التاريخ</th>
                      <th className="px-3 py-2.5 font-semibold">عدد الأصناف</th>
                      <th className="px-3 py-2.5 font-semibold">الحالة</th>
                      <th className="px-3 py-2.5 font-semibold">الإنشاء</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="text-center py-14">
                          <Loader2 className="animate-spin text-slate-400 mx-auto" size={26} />
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-14 text-slate-400 text-sm">
                          لا توجد طلبات احتياج
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(r.id)}>
                          <td className={cn(tdCls, "font-mono font-bold text-slate-700")}>{r.requestNoText}</td>
                          <td className={cn(tdCls, "text-xs text-slate-600")}>{r.project?.name || "—"}</td>
                          <td className={cn(tdCls, "text-xs text-slate-600")}>{r.department}</td>
                          <td className={cn(tdCls, "text-xs text-slate-500 font-mono")}>{fmtDate(r.requestDate)}</td>
                          <td className={cn(tdCls, "text-center font-mono text-xs")}>{r._count?.items ?? "—"}</td>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>
                  المشروع <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.projectId ?? ""}
                  disabled={lockProject}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, projectId: e.target.value ? Number(e.target.value) : null }));
                    setFieldErrors((fe) => ({ ...fe, projectId: [] }));
                  }}
                  className={cn(inputCls, "w-full disabled:bg-slate-100 disabled:text-slate-500", err("projectId") && "border-red-400")}
                >
                  <option value="">اختر المشروع...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {lockProject && (
                  <p className="text-[11px] text-amber-600 mt-1">لا يمكن تغيير المشروع بعد ربط الطلب بنظام المدرين</p>
                )}
                {err("projectId") && <p className="text-xs text-red-600 mt-1">{err("projectId")}</p>}
              </div>
              <div>
                <label className={labelCls}>
                  الجهة الطالبة <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  placeholder="اسم الجهة/الموقع الطالب..."
                  className={cn(inputCls, "w-full", err("department") && "border-red-400")}
                />
                {err("department") && <p className="text-xs text-red-600 mt-1">{err("department")}</p>}
              </div>
              <div>
                <label className={labelCls}>
                  التاريخ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.requestDate}
                  onChange={(e) => setForm((f) => ({ ...f, requestDate: e.target.value }))}
                  className={cn(inputCls, "w-full", err("requestDate") && "border-red-400")}
                />
                {err("requestDate") && <p className="text-xs text-red-600 mt-1">{err("requestDate")}</p>}
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-slate-700">الأصناف المطلوبة</h3>
                <button
                  type="button"
                  onClick={addItemRow}
                  className="text-xs font-bold text-primary-600 hover:text-primary-700"
                >
                  + إضافة صنف
                </button>
              </div>
              {err("items") && <p className="text-xs text-red-600 mb-2">{err("items")}</p>}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-right text-[11px] text-slate-500">
                      <th className="py-1.5 font-semibold w-7">م</th>
                      <th className="py-1.5 font-semibold">اسم الصنف/الطراز</th>
                      <th className="py-1.5 font-semibold w-28">كود الصنف</th>
                      <th className="py-1.5 font-semibold w-24">الوحدة</th>
                      <th className="py-1.5 font-semibold w-24">الكمية المطلوبة</th>
                      <th className="py-1.5 font-semibold w-36">اسم/كود المعدة</th>
                      <th className="py-1.5 font-semibold w-28">الرصيد الحالي</th>
                      <th className="py-1.5 font-semibold w-28">توريد محلي</th>
                      <th className="py-1.5 font-semibold w-28">توريد خارجي</th>
                      <th className="py-1.5 font-semibold">ملاحظات</th>
                      <th className="w-7"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, i) => (
                      <tr key={i}>
                        <td className="py-1 text-xs text-slate-400 text-center font-mono">{i + 1}</td>
                        <td className="py-1 pr-1">
                          <input
                            value={it.itemName}
                            onChange={(e) => setItem(i, { itemName: e.target.value })}
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            dir="ltr"
                            value={it.itemCode ?? ""}
                            onChange={(e) => setItem(i, { itemCode: e.target.value || null })}
                            className={cn(inputCls, "w-full text-xs py-1.5 font-mono")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            value={it.unit ?? ""}
                            onChange={(e) => setItem(i, { unit: e.target.value || null })}
                            placeholder="كرد / بر..."
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            type="number"
                            min={0}
                            value={it.qty ?? ""}
                            onChange={(e) =>
                              setItem(i, { qty: e.target.value === "" ? null : Number(e.target.value) })
                            }
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            dir="ltr"
                            value={it.equipmentRef ?? ""}
                            onChange={(e) => setItem(i, { equipmentRef: e.target.value || null })}
                            placeholder="EX216 / بنش..."
                            className={cn(inputCls, "w-full text-xs py-1.5 font-mono")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            type="number"
                            min={0}
                            value={it.currentBalance ?? ""}
                            onChange={(e) =>
                              setItem(i, { currentBalance: e.target.value === "" ? null : Number(e.target.value) })
                            }
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            type="number"
                            min={0}
                            value={it.localSupply ?? ""}
                            onChange={(e) =>
                              setItem(i, { localSupply: e.target.value === "" ? null : Number(e.target.value) })
                            }
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            type="number"
                            min={0}
                            value={it.foreignSupply ?? ""}
                            onChange={(e) =>
                              setItem(i, { foreignSupply: e.target.value === "" ? null : Number(e.target.value) })
                            }
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 pr-1">
                          <input
                            value={it.notes ?? ""}
                            onChange={(e) => setItem(i, { notes: e.target.value || null })}
                            className={cn(inputCls, "w-full text-xs py-1.5")}
                          />
                        </td>
                        <td className="py-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(i)}
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
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 text-sm font-bold rounded-lg bg-primary-600 text-white px-5 py-2.5 hover:bg-primary-700 disabled:opacity-60"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {editId ? "حفظ التعديلات" : "إنشاء طلب الاحتياج"}
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
                    <span className="font-mono font-extrabold text-slate-800">{selected.requestNoText}</span>
                    <StatusBadge status={selected.status} />
                    <span className="text-xs text-slate-400">{selected.department}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && (
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
                    {canSend && (
                      <button
                        onClick={handleSend}
                        disabled={sending}
                        className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} إرسال إلى
                        نظام المدرين
                      </button>
                    )}
                    {linked && (
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
                      <Printer size={14} /> طباعة النموذج
                    </button>
                  </div>
                </div>

                <div className="px-5 py-4 space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-400 font-semibold">رقم الطلب</p>
                      <p className="font-bold text-slate-700 font-mono">{selected.requestNoText}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-400 font-semibold">المشروع</p>
                      <p className="font-bold text-slate-700">{selected.project?.name || "—"}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-400 font-semibold">الجهة الطالبة</p>
                      <p className="font-bold text-slate-700">{selected.department}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-400 font-semibold">تاريخ الطلب</p>
                      <p className="font-bold text-slate-700 font-mono">{fmtDate(selected.requestDate)}</p>
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

                  {selected.status === "FAILED" && selected.sendError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                      <p className="text-xs font-bold text-red-700 mb-1">فشل الإرسال الأخير إلى نظام المدرين</p>
                      <p className="text-[11px] text-red-600 font-mono whitespace-pre-wrap">{selected.sendError}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-2">الأصناف المطلوبة</p>
                    <div className="overflow-x-auto">
                      <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                        <thead className="bg-slate-50">
                          <tr className="text-right text-[11px] text-slate-500">
                            <th className="px-2 py-2 font-semibold w-7">م</th>
                            <th className="px-2 py-2 font-semibold">اسم الصنف/الطراز</th>
                            <th className="px-2 py-2 font-semibold">كود الصنف</th>
                            <th className="px-2 py-2 font-semibold">الوحدة</th>
                            <th className="px-2 py-2 font-semibold">الكمية</th>
                            <th className="px-2 py-2 font-semibold">اسم/كود المعدة</th>
                            <th className="px-2 py-2 font-semibold">الرصيد الحالي</th>
                            <th className="px-2 py-2 font-semibold">توريد محلي</th>
                            <th className="px-2 py-2 font-semibold">توريد خارجي</th>
                            <th className="px-2 py-2 font-semibold">ملاحظات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selected.items ?? []).map((it, i) => (
                            <tr key={it.id ?? i}>
                              <td className={cn(tdCls, "text-center font-mono text-xs text-slate-400")}>{i + 1}</td>
                              <td className={cn(tdCls, "font-semibold text-xs")}>{it.itemName}</td>
                              <td className={cn(tdCls, "font-mono text-xs")}>{it.itemCode || "—"}</td>
                              <td className={cn(tdCls, "text-center text-xs")}>{it.unit || "—"}</td>
                              <td className={cn(tdCls, "text-center font-mono text-xs")}>{fmtNum(it.qty) || "—"}</td>
                              <td className={cn(tdCls, "font-mono text-xs")}>{it.equipmentRef || "—"}</td>
                              <td className={cn(tdCls, "text-center font-mono text-xs")}>
                                {fmtNum(it.currentBalance) || "—"}
                              </td>
                              <td className={cn(tdCls, "text-center font-mono text-xs")}>{fmtNum(it.localSupply) || "—"}</td>
                              <td className={cn(tdCls, "text-center font-mono text-xs")}>
                                {fmtNum(it.foreignSupply) || "—"}
                              </td>
                              <td className={cn(tdCls, "text-xs text-slate-500")}>{it.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="text-xs text-slate-400">
                    أُنشئ بواسطة {selected.createdBy?.name || "—"} ·{" "}
                    <span className="font-mono">{selected.createdAt.slice(0, 16).replace("T", " ")}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {selected && (
        <div className="print-area hidden print:block print-need bg-white text-slate-900">
          <div className="flex items-center justify-between mb-1">
            <div className="text-right">
              <p className="text-[13px] font-extrabold leading-tight">شركة قاصد خير للتوريدات العمومية</p>
              <p className="text-[13px] font-extrabold leading-tight">والمقاولات ش.م.م</p>
            </div>
            <img src="/kased-logo.png" alt="KASED KHAIR" className="h-11" />
          </div>

          <div className="text-right text-[12px] font-extrabold mb-1.5">
            نموذج طلب احتياج رقم : <span className="text-red-600 font-mono">{selected.requestNoText}</span>
          </div>

          <table className="w-full border-collapse text-[11px] mb-1.5">
            <tbody>
              <tr>
                <td className={printLabel}>الجهة الطالبة</td>
                <td className={cn(printCell, "text-center font-bold")}>{selected.department}</td>
                <td className={cn(printLabel, "w-28")}>التاريخ</td>
                <td className={cn(printCell, "text-center font-mono font-bold")}>{fmtDate(selected.requestDate)}</td>
              </tr>
              <tr>
                <td className={printLabel}>المشروع</td>
                <td className={cn(printCell, "text-center font-bold")} colSpan={3}>
                  {selected.project?.name || "—"}
                </td>
              </tr>
            </tbody>
          </table>

          <table className="w-full border-collapse text-[9.5px] mb-2">
            <thead>
              <tr>
                <th className={cn(printLabel, "w-7")} rowSpan={2}>
                  م
                </th>
                <th className={printLabel} rowSpan={2}>
                  اسم الصنف/الطراز
                </th>
                <th className={cn(printLabel, "w-24")} rowSpan={2}>
                  كود الصنف
                </th>
                <th className={cn(printLabel, "w-16")} rowSpan={2}>
                  الوحدة
                </th>
                <th className={cn(printLabel, "w-20")} rowSpan={2}>
                  الكمية المطلوبة
                </th>
                <th className={cn(printLabel, "w-28")} rowSpan={2}>
                  اسم/كود المعدة
                </th>
                <th className={cn(printLabel, "w-20")} rowSpan={2}>
                  الرصيد الحالي
                </th>
                <th className={cn(printLabel, "w-32")} colSpan={2}>
                  مرافقاة المورد
                </th>
                <th className={printLabel} rowSpan={2}>
                  ملاحظات
                </th>
              </tr>
              <tr>
                <th className={cn(printLabel, "w-16")}>توريد محلي</th>
                <th className={cn(printLabel, "w-16")}>توريد خارجي</th>
              </tr>
            </thead>
            <tbody>
              {printRows.map((it, i) => (
                <tr key={it.id ?? i}>
                  <td className={cn(printCell, "text-center font-mono")}>{i + 1}</td>
                  <td className={cn(printCell, "font-bold")}>{it.itemName}</td>
                  <td className={cn(printCell, "text-center font-mono")}>{it.itemCode || ""}</td>
                  <td className={cn(printCell, "text-center")}>{it.unit || ""}</td>
                  <td className={cn(printCell, "text-center font-mono")}>{fmtNum(it.qty)}</td>
                  <td className={cn(printCell, "text-center font-mono")}>{it.equipmentRef || ""}</td>
                  <td className={cn(printCell, "text-center font-mono")}>{fmtNum(it.currentBalance)}</td>
                  <td className={cn(printCell, "text-center font-mono")}>{fmtNum(it.localSupply)}</td>
                  <td className={cn(printCell, "text-center font-mono")}>{fmtNum(it.foreignSupply)}</td>
                  <td className={printCell}>{it.notes || ""}</td>
                </tr>
              ))}
              {Array.from({ length: padCount }).map((_, i) => (
                <tr key={`pad-${i}`}>
                  <td className={cn(printCell, "text-center font-mono")}>{printRows.length + i + 1}</td>
                  <td className={printCell}>&nbsp;</td>
                  <td className={printCell}></td>
                  <td className={printCell}></td>
                  <td className={printCell}></td>
                  <td className={printCell}></td>
                  <td className={printCell}></td>
                  <td className={printCell}></td>
                  <td className={printCell}></td>
                  <td className={printCell}></td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="w-full border-collapse text-[10px]">
            <tbody>
              <tr>
                <td className={cn(printCell, "w-1/3 text-center align-top")}>
                  <p className="font-extrabold">المختص/الجهة الطالبة</p>
                  <p className="mt-6">الاسم : ........................</p>
                  <p className="mt-3 mb-2">التوقيع : ........................</p>
                </td>
                <td className={cn(printCell, "w-1/3 text-center align-top")}>
                  <p className="font-extrabold">مرفاقاة المورد</p>
                  <p className="mt-6">الاسم : ........................</p>
                  <p className="mt-3 mb-2">التوقيع : ........................</p>
                </td>
                <td className={cn(printCell, "w-1/3 text-center align-top")}>
                  <p className="font-extrabold">اعتماد الإدارة العليا</p>
                  <p className="mt-16 mb-6">&nbsp;</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
