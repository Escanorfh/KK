import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Plus, Search, Truck, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiError } from "@/lib/api";
import {
  listTransfers,
  getTransferStats,
  createTransfer,
  approveTransfer,
  rejectTransfer,
  type Transfer,
} from "@/services/transfers";
import { listSectors, projectOptions } from "@/services/projects";
import { lookupEquipment } from "@/services/equipments";
import type { Project } from "@/types";

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "قيد المراجعة",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغى",
};
const STATUS_CLS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, completed: 0, rejected: 0 });
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [projectFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [approving, setApproving] = useState<Transfer | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([
        listTransfers({ q: q || undefined, status: statusFilter || undefined, projectId: projectFilter ? Number(projectFilter) : undefined, page: 1, pageSize: 50 }),
        getTransferStats(),
      ]);
      setTransfers(list.data);
      setStats(s);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, projectFilter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">نقل المعدات</h1>
          <p className="text-sm text-slate-500 mt-0.5">إدارة طلبات نقل المعدات بين المشاريع والقطاعات</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
        >
          <Plus size={16} /> نقل معدة جديدة
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "إجمالي العمليات", value: stats.total, color: "text-slate-800" },
          { label: "معلقة", value: stats.pending, color: "text-amber-600" },
          { label: "مكتملة", value: stats.completed, color: "text-emerald-600" },
          { label: "مرفوضة", value: stats.rejected, color: "text-rose-600" },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className={`text-2xl font-extrabold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-slate-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بكود المعدة أو اسمها أو رقم العملية..."
            className="rounded-lg border border-slate-300 pr-9 pl-3 py-2 text-sm bg-white w-72"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
          <option value="">كل الحالات</option>
          <option value="PENDING">قيد المراجعة</option>
          <option value="APPROVED">معتمد</option>
          <option value="COMPLETED">مكتمل</option>
          <option value="REJECTED">مرفوض</option>
          <option value="CANCELLED">ملغى</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500"><Loader2 className="inline animate-spin" size={20} /> جاري التحميل...</div>
        ) : transfers.length === 0 ? (
          <div className="p-8 text-center text-slate-500">لا توجد عمليات نقل</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {["#", "كود المعدة", "اسم المعدة", "من مشروع", "من قطاع", "إلى مشروع", "إلى قطاع", "التاريخ", "مقدم الطلب", "الحالة", "إجراءات"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-right text-xs font-bold text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5">{t.id}</td>
                    <td className="px-3 py-2.5 font-mono">{t.equipment?.code}</td>
                    <td className="px-3 py-2.5">{t.equipment?.name}</td>
                    <td className="px-3 py-2.5">{t.fromProject?.name ?? "—"}</td>
                    <td className="px-3 py-2.5">{t.fromSector?.name ?? "—"}</td>
                    <td className="px-3 py-2.5">{t.toProject?.name ?? "—"}</td>
                    <td className="px-3 py-2.5">{t.toSector?.name ?? "—"}</td>
                    <td className="px-3 py-2.5">{t.transferDate?.slice(0, 10)}</td>
                    <td className="px-3 py-2.5">{t.submittedBy?.name}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-block px-2 py-0.5 rounded border text-xs font-semibold", STATUS_CLS[t.status])}>
                        {STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {t.status === "PENDING" && (
                        <div className="flex gap-1">
                          <button onClick={() => setApproving(t)} className="text-emerald-600 text-xs font-semibold hover:underline">اعتماد</button>
                          <button onClick={async () => { const r = prompt("سبب الرفض:"); if (r) { await rejectTransfer(t.id, r); toast.success("تم الرفض"); void load(); } }} className="text-rose-600 text-xs font-semibold hover:underline">رفض</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateTransferModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); toast.success("تم إنشاء طلب النقل"); }}
        />
      )}

      {approving && (
        <ApproveTransferModal
          transfer={approving}
          onClose={() => setApproving(null)}
          onApproved={() => { setApproving(null); void load(); toast.success("تم اعتماد النقل"); }}
        />
      )}
    </div>
  );
}

function CreateTransferModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const [equipment, setEquipment] = useState<any>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const searchEq = async () => {
    if (!equipmentQuery.trim()) return;
    try {
      const res = await lookupEquipment(equipmentQuery.trim());
      if (res.length) setEquipment(res[0]);
      else toast.error("لم يتم العثور على المعدة");
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const submit = async () => {
    if (!equipment) {
      toast.error("أكمل البيانات المطلوبة");
      return;
    }
    setSaving(true);
    try {
      await createTransfer({
        equipmentId: equipment.id,
        transferDate: date,
        reason: reason || null,
        notes: notes || null,
      });
      onCreated();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-slate-800">نقل معدة جديدة</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>

        <div className="space-y-2">
          <label className="block text-[13px] font-semibold text-slate-600">بحث عن المعدة</label>
          <div className="flex gap-2">
            <input value={equipmentQuery} onChange={(e) => setEquipmentQuery(e.target.value)} className={inputCls} placeholder="كود أو اسم المعدة" />
            <button onClick={searchEq} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold">بحث</button>
          </div>
        </div>

        {equipment && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
            <div><span className="font-semibold text-slate-600">كود:</span> {equipment.code}</div>
            <div><span className="font-semibold text-slate-600">اسم:</span> {equipment.name}</div>
            <div><span className="font-semibold text-slate-600">المشروع الحالي:</span> {equipment.project?.name ?? "—"}</div>
            <div><span className="font-semibold text-slate-600">القطاع الحالي:</span> {equipment.sector?.name ?? "—"}</div>
          </div>
        )}

        <div>
          <label className="block text-[13px] font-semibold text-slate-600 mb-1.5">تاريخ النقل</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-600 mb-1.5">سبب النقل</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-600 mb-1.5">ملاحظات</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls + " min-h-[60px]"} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold" disabled={saving}>إغلاق</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />}
            تأكيد طلب النقل
          </button>
        </div>
      </div>
    </div>
  );
}

function ApproveTransferModal({ transfer, onClose, onApproved }: { transfer: Transfer; onClose: () => void; onApproved: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sectors, setSectors] = useState<any[]>([]);
  const [toProjectId, setToProjectId] = useState("");
  const [toSectorId, setToSectorId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(transfer.transferDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    projectOptions().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (!toProjectId) { setSectors([]); return; }
    listSectors(Number(toProjectId)).then(setSectors).catch(() => setSectors([]));
  }, [toProjectId]);

  const submit = async () => {
    if (!toProjectId) {
      toast.error("اختر المشروع المستهدف");
      return;
    }
    setSaving(true);
    try {
      await approveTransfer(transfer.id, { toProjectId: Number(toProjectId), toSectorId: toSectorId ? Number(toSectorId) : null, effectiveDate });
      onApproved();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-slate-800">اعتماد نقل المعدة</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm">
          <div><span className="font-semibold text-slate-600">المعدة:</span> {transfer.equipment?.code} — {transfer.equipment?.name}</div>
          <div><span className="font-semibold text-slate-600">من:</span> {transfer.fromProject?.name ?? "—"} / {transfer.fromSector?.name ?? "—"}</div>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-600 mb-1.5">المشروع المستهدف</label>
          <select value={toProjectId} onChange={(e) => setToProjectId(e.target.value)} className={inputCls}>
            <option value="">اختر المشروع</option>
            {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-600 mb-1.5">القطاع المستهدف</label>
          <select value={toSectorId} onChange={(e) => setToSectorId(e.target.value)} className={inputCls}>
            <option value="">اختر القطاع (اختياري)</option>
            {sectors.map((s: any) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-600 mb-1.5">تاريخ سريان النقل</label>
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputCls} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold" disabled={saving}>إغلاق</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            اعتماد
          </button>
        </div>
      </div>
    </div>
  );
}
