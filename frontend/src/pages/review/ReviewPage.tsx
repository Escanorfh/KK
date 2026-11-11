import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  XCircle,
  Eye,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  listReviews,
  getReview,
  updateReview,
  approveReview,
  rejectReview,
} from "@/services/review";
import type { ReviewRequest } from "@/types";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";

const ENTITY_LABELS: Record<string, string> = {
  dailylog: "سركال (Daily Log)",
  maintenance: "أمر شغل (Work Order)",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "قيد المراجعة",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
};

const STATUS_CLS: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function ReviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ROOT" || user?.role === "ADMIN";

  const [reviews, setReviews] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [entityFilter, setEntityFilter] = useState<"" | "dailylog" | "maintenance">("");
  const [statusFilter, setStatusFilter] = useState<"PENDING_REVIEW" | "APPROVED" | "REJECTED" | "">("PENDING_REVIEW");
  const [selected, setSelected] = useState<ReviewRequest | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [showReject, setShowReject] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listReviews({
        entity: entityFilter || undefined,
        status: (statusFilter || undefined) as any,
        page: 1,
        pageSize: 100,
      });
      setReviews(res.data);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [entityFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (r: ReviewRequest) => {
    try {
      const full = await getReview(r.id);
      setSelected(full);
      setEditData({ ...(full.reviewedData ?? full.submittedData) });
      setRejectReason("");
      setShowReject(false);
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const handleApprove = async () => {
    if (!selected) return;
    if (!window.confirm("اعتماد هذا السجل وإدخاله في الجداول الأساسية؟")) return;
    setSaving(true);
    try {
      // persist edits first if any
      const original = selected.reviewedData ?? selected.submittedData;
      const changed = JSON.stringify(editData) !== JSON.stringify(original);
      if (changed) {
        await updateReview(selected.id, editData);
      }
      await approveReview(selected.id);
      toast.success("تم اعتماد السجل");
      setSelected(null);
      void load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    if (!rejectReason.trim()) {
      toast.error("سبب الرفض مطلوب");
      return;
    }
    setSaving(true);
    try {
      await rejectReview(selected.id, rejectReason.trim());
      toast.success("تم رفض السجل");
      setSelected(null);
      setShowReject(false);
      void load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const setField = (k: string, v: unknown) => setEditData((d) => ({ ...d, [k]: v }));

  const renderEditFields = () => {
    if (!selected) return null;
    const isDaily = selected.entity === "dailylog";
    const fields = isDaily
      ? ["date", "endMeter", "operatingHours", "diesel", "productivityType", "productivityCount", "condition", "notes"]
      : ["date", "endDate", "workType", "maintenanceType", "workshop", "description", "action", "meterReading", "kmMeter", "status", "notes"];
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f}>
            <label className={labelCls}>{f}</label>
            <input
              className={inputCls}
              value={editData[f] == null ? "" : String(editData[f])}
              onChange={(e) => setField(f, e.target.value === "" ? null : e.target.value)}
              disabled={!isAdmin}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">مراجعة البيانات — Data Review</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isAdmin ? "مراجعة واعتماد بيانات المستخدمين" : "حالة البيانات التي أرسلتها"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value as any)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">كل الأنواع</option>
            <option value="dailylog">سراكي</option>
            <option value="maintenance">أوامر شغل</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">كل الحالات</option>
            <option value="PENDING_REVIEW">قيد المراجعة</option>
            <option value="APPROVED">معتمد</option>
            <option value="REJECTED">مرفوض</option>
          </select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500">
            <Loader2 className="inline animate-spin" size={20} /> جاري التحميل...
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-8 text-center text-slate-500">لا توجد سجلات</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">#</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">النوع</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">الحالة</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">المرسل</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">المعدة</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">المشروع/القطاع</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">تاريخ الإرسال</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5">{r.id}</td>
                    <td className="px-3 py-2.5">{ENTITY_LABELS[r.entity] ?? r.entity}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-block px-2 py-0.5 rounded border text-xs font-semibold", STATUS_CLS[r.status])}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">{r.submittedBy?.name ?? r.submittedById}</td>
                    <td className="px-3 py-2.5">{r.equipmentCode ?? r.equipmentId ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {r.projectName ?? "—"}
                      {r.sectorName ? ` · ${r.sectorName}` : ""}
                    </td>
                    <td className="px-3 py-2.5">{new Date(r.submittedAt).toLocaleString("ar-EG")}</td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => openDetail(r)}
                        className="inline-flex items-center gap-1 text-primary-700 hover:underline text-xs font-semibold"
                      >
                        <Eye size={14} /> عرض
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-800">
                تفاصيل السجل #{selected.id}
              </h2>
              <span className={cn("inline-block px-2 py-0.5 rounded border text-xs font-semibold", STATUS_CLS[selected.status])}>
                {STATUS_LABELS[selected.status]}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="font-semibold text-slate-600">النوع:</span> {ENTITY_LABELS[selected.entity]}</div>
              <div><span className="font-semibold text-slate-600">المرسل:</span> {selected.submittedBy?.name ?? selected.submittedById}</div>
              <div><span className="font-semibold text-slate-600">المعدة:</span> {selected.equipmentCode ?? selected.equipmentId ?? "—"}</div>
              <div><span className="font-semibold text-slate-600">المشروع:</span> {selected.projectName ?? "—"}</div>
              <div><span className="font-semibold text-slate-600">القطاع:</span> {selected.sectorName ?? "—"}</div>
              <div><span className="font-semibold text-slate-600">السياق:</span> {selected.contextSource ?? "—"}</div>
              <div><span className="font-semibold text-slate-600">تاريخ الإرسال:</span> {new Date(selected.submittedAt).toLocaleString("ar-EG")}</div>
              {selected.reviewedAt && (
                <div><span className="font-semibold text-slate-600">تاريخ المراجعة:</span> {new Date(selected.reviewedAt).toLocaleString("ar-EG")}</div>
              )}
              {selected.reviewedBy && (
                <div><span className="font-semibold text-slate-600">المراجع:</span> {selected.reviewedBy.name}</div>
              )}
              {selected.rejectionReason && (
                <div className="col-span-2"><span className="font-semibold text-slate-600">سبب الرفض:</span> {selected.rejectionReason}</div>
              )}
            </div>

            {isAdmin && selected.status === "PENDING_REVIEW" && (
              <>
                <div className="border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-bold text-slate-700 mb-2">تعديل قبل الاعتماد</h3>
                  {renderEditFields()}
                </div>

                {showReject && (
                  <div>
                    <label className={labelCls}>سبب الرفض (إلزامي)</label>
                    <textarea
                      className={inputCls + " min-h-[80px]"}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setSelected(null)}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold"
                    disabled={saving}
                  >
                    إغلاق
                  </button>
                  {!showReject ? (
                    <>
                      <button
                        onClick={() => setShowReject(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold"
                        disabled={saving}
                      >
                        <XCircle size={15} /> رفض
                      </button>
                      <button
                        onClick={handleApprove}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                        disabled={saving}
                      >
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                        اعتماد
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowReject(false)}
                        className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold"
                        disabled={saving}
                      >
                        تراجع
                      </button>
                      <button
                        onClick={handleReject}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold"
                        disabled={saving}
                      >
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
                        تأكيد الرفض
                      </button>
                    </>
                  )}
                </div>
              </>
            )}

            {!isAdmin && (
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setSelected(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold"
                >
                  إغلاق
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
