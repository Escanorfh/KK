import { useCallback, useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  Pencil,
  Search,
  FolderKanban,
  Layers,
  ChevronRight,
  ChevronLeft,
  X,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiError, getApiFieldErrors } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { Project } from "@/types";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  syncProjectsFromManagers,
  listSectors,
  createSector,
  updateSector,
  deleteSector,
  managersSectorOptions,
  linkSectorManagersRoom,
  type SectorRow,
  type ManagersSectorOption,
} from "@/services/projects";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";
const thCls = "px-3 py-2.5 text-right text-xs font-bold text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap";
const tdCls = "px-3 py-2.5 text-[13px] text-slate-700 border-b border-slate-100";

const PAGE_SIZE = 20;

interface FormState {
  code: string;
  name: string;
  description: string;
}

const emptyForm: FormState = { code: "", name: "", description: "" };

export default function ProjectsPage() {
  const { user } = useAuth();
  const canManage = user?.role === "ROOT" || user?.role === "ADMIN";

  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastLogDate, setLastLogDate] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [sectorProject, setSectorProject] = useState<Project | null>(null);
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [sectorsLoading, setSectorsLoading] = useState(false);
  const [newSector, setNewSector] = useState("");
  const [editSector, setEditSector] = useState<{ id: number; name: string } | null>(null);
  const [sectorSaving, setSectorSaving] = useState(false);
  const [managersRooms, setManagersRooms] = useState<ManagersSectorOption[]>([]);
  const [managersWarning, setManagersWarning] = useState<string | null>(null);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [linkingSectorId, setLinkingSectorId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listProjects({ q: q.trim() || undefined, page, pageSize: PAGE_SIZE });
      setProjects(res.data);
      setTotal(res.total);
      setLastLogDate(res.lastLogDate ?? null);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const err = (k: string) => fieldErrors[k]?.[0];

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFieldErrors({});
  };

  const startEdit = (p: Project) => {
    setEditingId(p.id);
    setForm({ code: p.code ?? "", name: p.name, description: p.description ?? "" });
    setFieldErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      toast.error("اسم المشروع مطلوب (حرفان على الأقل)");
      return;
    }
    setSaving(true);
    setFieldErrors({});
    try {
      const payload = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
      };
      if (editingId) {
        await updateProject(editingId, payload);
        toast.success("تم تحديث المشروع");
      } else {
        await createProject(payload);
        toast.success("تم إنشاء المشروع");
      }
      resetForm();
      load();
    } catch (err2) {
      setFieldErrors(getApiFieldErrors(err2));
      toast.error(getApiError(err2));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Project) => {
    if (!window.confirm(`حذف المشروع "${p.name}"؟ لا يمكن التراجع.`)) return;
    try {
      await deleteProject(p.id);
      toast.success("تم حذف المشروع");
      if (editingId === p.id) resetForm();
      load();
    } catch (err2) {
      toast.error(getApiError(err2));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await syncProjectsFromManagers();
      toast.success(
        `تم جلب ${r.fetched} مشروع من نظام المدرين — ${r.created} جديد، ${r.updated} تحديث، ${r.unchanged} بدون تغيير | قطاعات: ${r.sectors.created} جديد، ${r.sectors.linked} ربط${
          r.sectors.error ? ` — تعذرت مزامنة القطاعات: ${r.sectors.error}` : ""
        }`
      );
      load();
    } catch (err2) {
      toast.error(getApiError(err2));
    } finally {
      setSyncing(false);
    }
  };

  const openSectors = async (p: Project) => {
    setSectorProject(p);
    setNewSector("");
    setEditSector(null);
    setManagersRooms([]);
    setManagersWarning(null);
    setSectorsLoading(true);
    // القطاعات بتتجلب أوتوماتيك مع المزامنة — هنا لسه بنجيبها للمراجعة اليدوية وإدارة الربط
    setRoomsLoading(true);
    managersSectorOptions(p.id)
      .then((r) => {
        setManagersRooms(r.rooms);
        setManagersWarning(r.warning);
      })
      .catch(() => setManagersWarning("تعذر جلب قطاعات نظام المدرين لهذا المشروع"))
      .finally(() => setRoomsLoading(false));
    try {
      setSectors(await listSectors(p.id));
    } catch (err2) {
      toast.error(getApiError(err2));
      setSectorProject(null);
    } finally {
      setSectorsLoading(false);
    }
  };

  const linkSector = async (s: SectorRow, managersRoomId: number | null) => {
    if (!sectorProject) return;
    setLinkingSectorId(s.id);
    try {
      await linkSectorManagersRoom(s.id, managersRoomId);
      toast.success(
        managersRoomId === null
          ? `تم إلغاء ربط القطاع «${s.name}»`
          : `تم ربط القطاع «${s.name}» بقطاع المدرين`
      );
      setSectors(await listSectors(sectorProject.id));
    } catch (err2) {
      toast.error(getApiError(err2));
    } finally {
      setLinkingSectorId(null);
    }
  };

  const addSector = async () => {
    if (!sectorProject) return;
    if (newSector.trim().length < 2) {
      toast.error("اسم القطاع مطلوب (حرفان على الأقل)");
      return;
    }
    setSectorSaving(true);
    try {
      await createSector({ projectId: sectorProject.id, name: newSector.trim() });
      toast.success("تمت إضافة القطاع");
      setNewSector("");
      setSectors(await listSectors(sectorProject.id));
      load();
    } catch (err2) {
      toast.error(getApiError(err2));
    } finally {
      setSectorSaving(false);
    }
  };

  const saveSector = async () => {
    if (!sectorProject || !editSector) return;
    if (editSector.name.trim().length < 2) {
      toast.error("اسم القطاع مطلوب (حرفان على الأقل)");
      return;
    }
    setSectorSaving(true);
    try {
      await updateSector(editSector.id, editSector.name.trim());
      toast.success("تم تحديث القطاع");
      setEditSector(null);
      setSectors(await listSectors(sectorProject.id));
    } catch (err2) {
      toast.error(getApiError(err2));
    } finally {
      setSectorSaving(false);
    }
  };

  const removeSector = async (s: SectorRow) => {
    if (!sectorProject) return;
    if (!window.confirm(`حذف القطاع "${s.name}"؟`)) return;
    try {
      await deleteSector(s.id);
      toast.success("تم حذف القطاع");
      setSectors(await listSectors(sectorProject.id));
      load();
    } catch (err2) {
      toast.error(getApiError(err2));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">المشاريع والقطاعات</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            إدارة المشاريع وقطاعاتها — عدّاد المعدات بيتحسب من شيت الـ day (آخر يوم مسجل) لأن المعدات بتتنقل بين
            المشاريع — المشاريع بتتزامن تلقائيًا مع نظام المدرين وكل ساعة، وزر «مزامنة من المدرين» بيجيبها فورًا
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-64">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالاسم أو الكود..."
              className={cn(inputCls, "pr-9")}
            />
          </div>
          {user?.role === "ROOT" && (
            <button
              onClick={handleSync}
              disabled={syncing}
              title="جلب مشاريع نظام المدرين (/requisitions/projects) ومزامنتها — الكود أولًا ثم الاسم"
              className="flex items-center gap-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white px-3 py-2 hover:bg-primary-700 transition-colors disabled:opacity-60"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {syncing ? "جاري المزامنة..." : "مزامنة من المدرين"}
            </button>
          )}
          <button
            onClick={() => {
              resetForm();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 transition-colors"
          >
            <Plus size={14} /> مشروع جديد
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <FolderKanban size={16} className="text-primary-700" />
          <h2 className="text-sm font-bold text-slate-700">
            {editingId ? `تعديل المشروع #${editingId}` : "إنشاء مشروع جديد"}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="mr-auto text-xs font-semibold text-slate-500 hover:text-red-600"
            >
              إلغاء التعديل
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className={labelCls}>الكود (اختياري)</label>
            <input
              dir="ltr"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="مثال: PRJ-01"
              className={cn(inputCls, err("code") && "border-red-400")}
            />
            {err("code") && <p className="text-xs text-red-600 mt-1">{err("code")}</p>}
          </div>
          <div>
            <label className={labelCls}>
              اسم المشروع <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثال: الادبية"
              className={cn(inputCls, err("name") && "border-red-400")}
            />
            {err("name") && <p className="text-xs text-red-600 mt-1">{err("name")}</p>}
          </div>
          <div>
            <label className={labelCls}>الوصف</label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="وصف مختصر (اختياري)"
              className={inputCls}
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg py-2.5 transition-colors"
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : editingId ? (
              <Save size={15} />
            ) : (
              <Plus size={15} />
            )}
            {editingId ? "حفظ التعديلات" : "إنشاء المشروع"}
          </button>
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse">
            <thead>
              <tr>
                <th className={thCls}>#</th>
                <th className={thCls}>الكود</th>
                <th className={thCls}>اسم المشروع</th>
                <th className={thCls}>الوصف</th>
                <th
                  className={cn(thCls, "text-center")}
                  title="عدّاد المعدات بيتحسب من شيت الـ day (السجل اليومي) — أي معدة ليها سجل في آخر يوم بتتعدّ لمشروعها الحالي"
                >
                  المعدات
                  {lastLogDate ? (
                    <div className="text-[10px] font-normal text-slate-400 mt-0.5">
                      من آخر يوم: {lastLogDate.slice(0, 10)}
                    </div>
                  ) : null}
                </th>
                <th className={cn(thCls, "text-center")}>القطاعات</th>
                <th className={cn(thCls, "text-center")}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                    <Loader2 size={17} className="animate-spin inline ml-2" /> جاري التحميل...
                  </td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                    لا توجد مشاريع{q ? " مطابقة للبحث" : ""}
                  </td>
                </tr>
              ) : (
                projects.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className={cn(tdCls, "font-mono text-xs text-slate-400")}>{p.id}</td>
                    <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                      {p.code || "—"}
                    </td>
                    <td className={cn(tdCls, "font-semibold")}>{p.name}</td>
                    <td className={cn(tdCls, "text-slate-500 max-w-[260px] truncate")}>
                      {p.description || "—"}
                    </td>
                    <td className={cn(tdCls, "text-center font-mono text-xs")}>
                      {p.activeEquipment ?? p._count?.equipment ?? 0}
                    </td>
                    <td className={cn(tdCls, "text-center font-mono text-xs")}>
                      {p._count?.sectors ?? 0}
                    </td>
                    <td className={cn(tdCls, "text-center")}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => startEdit(p)}
                          title="تعديل"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-100 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => openSectors(p)}
                          title="إدارة القطاعات"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                        >
                          <Layers size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          disabled={!canManage}
                          title={canManage ? "حذف" : "الحذف متاح لـ ROOT/ADMIN فقط"}
                          className={cn(
                            "p-1.5 rounded-lg transition-colors",
                            canManage
                              ? "text-slate-400 hover:text-red-600 hover:bg-red-50"
                              : "text-slate-200 cursor-not-allowed"
                          )}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap text-xs text-slate-500">
          <span>
            الإجمالي: <b>{total}</b> مشروع
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 hover:bg-white transition-colors disabled:opacity-40"
            >
              <ChevronRight size={14} /> السابق
            </button>
            <span className="font-semibold">
              صفحة {page} من {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 hover:bg-white transition-colors disabled:opacity-40"
            >
              التالي <ChevronLeft size={14} />
            </button>
          </div>
        </div>
      </div>

      {sectorProject && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={() => setSectorProject(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <Layers size={15} className="text-primary-600" />
                قطاعات مشروع {sectorProject.name}
              </h3>
              <button
                onClick={() => setSectorProject(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={newSector}
                onChange={(e) => setNewSector(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addSector();
                  }
                }}
                placeholder="اسم القطاع الجديد..."
                className={inputCls}
              />
              <button
                onClick={() => void addSector()}
                disabled={sectorSaving}
                className="flex items-center gap-1.5 shrink-0 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white text-xs font-bold rounded-lg px-4 py-2.5 transition-colors"
              >
                {sectorSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                إضافة
              </button>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 leading-relaxed">
              كل قطاع هنا لازم يتربط بقطاع نظام المدرين (room_id) عشان طلبات الاحتياج تقدر تُرسل — القطاعات بتتجلب
              وتترابط أوتوماتيك مع كل مزامنة للمشاريع (بالاعتماد على معرّف الغرفة، مش التشابه في الأسماء)، والموجود
              هنا بيدوي بيفضل زي ما هو.
              {managersWarning && (
                <span className="block mt-1 text-amber-700 font-semibold">{managersWarning}</span>
              )}
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {sectorsLoading ? (
                <div className="px-3 py-6 text-center text-slate-400 text-sm">
                  <Loader2 size={16} className="animate-spin inline ml-2" /> جاري التحميل...
                </div>
              ) : sectors.length === 0 ? (
                <div className="px-3 py-6 text-center text-slate-400 text-sm">
                  لا توجد قطاعات — أضف أول قطاع
                </div>
              ) : (
                sectors.map((s) => {
                  const editing = editSector?.id === s.id;
                  return (
                    <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                      {editing ? (
                        <input
                          value={editSector.name}
                          onChange={(e) =>
                            setEditSector((st) => (st ? { ...st, name: e.target.value } : st))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void saveSector();
                            }
                          }}
                          autoFocus
                          className={cn(inputCls, "py-1.5 text-[13px]")}
                        />
                      ) : (
                        <>
                          <span className="flex-1 text-[13px] font-semibold text-slate-700 truncate">
                            {s.name}
                          </span>
                          <select
                            value={s.managersRoomId ?? ""}
                            disabled={linkingSectorId === s.id || (!managersRooms.length && !s.managersRoomId)}
                            onChange={(e) =>
                              void linkSector(s, e.target.value ? Number(e.target.value) : null)
                            }
                            title="قطاع نظام المدرين المطابق — مطلوب لإرسال طلبات الاحتياج"
                            className={cn(
                              inputCls,
                              "w-48 py-1.5 text-[12px] shrink-0",
                              s.managersRoomId == null && "border-amber-300 bg-amber-50 text-amber-800"
                            )}
                          >
                            <option value="">
                              {roomsLoading
                                ? "جاري جلب قطاعات المدرين..."
                                : managersRooms.length
                                  ? "غير مربوط — اختر قطاعًا"
                                  : "لا توجد قطاعات عند المدرين"}
                            </option>
                            {managersRooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.title} ({r.id})
                              </option>
                            ))}
                            {/* ربط قديم اختفى من قائمة التوكن — نظهره عشان الإلغاء يفضل متاح */}
                            {s.managersRoomId != null &&
                              !managersRooms.some((r) => r.id === s.managersRoomId) && (
                                <option value={s.managersRoomId}>
                                  {s.managersRoomTitle ?? `معرّف ${s.managersRoomId}`} (لم يعد مصرّح به)
                                </option>
                              )}
                          </select>
                          {linkingSectorId === s.id && <Loader2 size={14} className="animate-spin text-slate-400 shrink-0" />}
                          <span
                            className="text-[11px] font-mono text-slate-400 shrink-0"
                            title="عدّاد المعدات من شيت الـ day (آخر يوم مسجل)"
                          >
                            {s.activeEquipment ?? s._count?.equipment ?? 0} معدة
                          </span>
                        </>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        {editing ? (
                          <>
                            <button
                              onClick={() => void saveSector()}
                              disabled={sectorSaving}
                              title="حفظ"
                              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                            >
                              <Save size={14} />
                            </button>
                            <button
                              onClick={() => setEditSector(null)}
                              title="إلغاء"
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setEditSector({ id: s.id, name: s.name })}
                              title="تعديل"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-100 transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => void removeSector(s)}
                              disabled={!canManage}
                              title={canManage ? "حذف" : "الحذف متاح لـ ROOT/ADMIN فقط"}
                              className={cn(
                                "p-1.5 rounded-lg transition-colors",
                                canManage
                                  ? "text-slate-400 hover:text-red-600 hover:bg-red-50"
                                  : "text-slate-200 cursor-not-allowed"
                              )}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              حذف المشروع/القطاع متاح لما مفيش معدات مرتبطة بيهم.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
