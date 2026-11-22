import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ClipboardCheck,
  Loader2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  bulkApproveReviews,
  deleteReview,
  getReview,
  listReviews,
  approveReview,
  updateReview,
} from "@/services/review";
import type { ReviewEntity, ReviewRequest } from "@/types";

const ENTITY_LABELS: Record<ReviewEntity, string> = {
  dailylog: "سراكي",
  maintenance: "أعمال صيانة",
  repairorder: "أمر إصلاح",
  needrequest: "طلب احتياج",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "قيد المراجعة",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
};

const STATUS_DOT: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-500",
  APPROVED: "bg-emerald-600",
  REJECTED: "bg-rose-600",
};

interface Column {
  key: string;
  label: string;
  /** الأرقام والرموز تظهر بخط أحادي المسافة. */
  mono?: boolean;
  /** حقل ثابت (مثل رقم الطلب) لا يُعدّل — يُعرض في الجدول فقط. */
  noEdit?: boolean;
}

const COLUMNS: Record<ReviewEntity, Column[]> = {
  dailylog: [
    { key: "equipmentCode", label: "كود المعدة", mono: true, noEdit: true },
    { key: "date", label: "التاريخ", mono: true },
    { key: "endMeter", label: "قراءة العداد", mono: true },
    { key: "operatingHours", label: "ساعات التشغيل", mono: true },
    { key: "diesel", label: "الديزل", mono: true },
    { key: "productivityType", label: "نوع الإنتاج" },
    { key: "productivityCount", label: "الكمية", mono: true },
    { key: "condition", label: "الحالة" },
    { key: "notes", label: "ملاحظات" },
  ],
  maintenance: [
    { key: "equipmentCode", label: "كود المعدة", mono: true, noEdit: true },
    { key: "date", label: "التاريخ", mono: true },
    { key: "endDate", label: "تاريخ الانتهاء", mono: true },
    { key: "workType", label: "نوع العمل" },
    { key: "maintenanceType", label: "نوع الصيانة" },
    { key: "workshop", label: "الورشة" },
    { key: "description", label: "الوصف" },
    { key: "action", label: "الإجراء" },
    { key: "meterReading", label: "قراءة الساعات", mono: true },
    { key: "kmMeter", label: "قراءة الكيلومترات", mono: true },
    { key: "status", label: "الحالة" },
    { key: "notes", label: "ملاحظات" },
  ],
  repairorder: [
    { key: "equipmentCode", label: "كود المعدة", mono: true, noEdit: true },
    { key: "requestNo", label: "رقم الطلب", mono: true, noEdit: true },
    { key: "type", label: "النوع", noEdit: true },
    { key: "entryDate", label: "تاريخ الدخول", mono: true },
    { key: "exitDate", label: "تاريخ الخروج", mono: true },
    { key: "workshop", label: "الورشة" },
    { key: "faultDescription", label: "وصف العطل" },
    { key: "itemName", label: "الصنف" },
    { key: "partModel", label: "الموديل" },
    { key: "itemCode", label: "كود الصنف", mono: true },
    { key: "quantity", label: "الكمية", mono: true },
    { key: "unit", label: "الوحدة" },
    { key: "itemCondition", label: "حالة الصنف" },
    { key: "siteName", label: "الموقع" },
    { key: "requesterName", label: "مقدم الطلب" },
    { key: "estimatedCost", label: "التكلفة التقديرية", mono: true },
    { key: "actualCost", label: "التكلفة الفعلية", mono: true },
    { key: "notes", label: "ملاحظات" },
  ],
  needrequest: [
    { key: "requestNo", label: "رقم الطلب", mono: true, noEdit: true },
    { key: "requestDate", label: "التاريخ", mono: true },
    { key: "department", label: "القسم" },
    { key: "items", label: "الأصناف" },
  ],
};

const NUMBER_FORMAT = new Intl.NumberFormat("ar-EG", { numberingSystem: "latn" });

function formatValue(value: unknown, mono?: boolean) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return `${NUMBER_FORMAT.format(value.length)} سطر`;
  if (typeof value === "number") return NUMBER_FORMAT.format(value);
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  const text = String(value);
  if (mono && /^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  return text;
}

/**
 * كود المعدة بيتخزن في سياق الطلب (ReviewRequest.equipmentCode) مش جوّه submittedData،
 * فبنقرأه من هناك أولًا مع fallback للبيانات القديمة اللي كانت بتبعته جوّه الـ payload.
 */
function cellValue(review: ReviewRequest, data: Record<string, unknown>, key: string): unknown {
  if (key === "equipmentCode") {
    return review.equipmentCode ?? data.equipmentCode ?? data.equipmentId ?? null;
  }
  return data[key];
}

function toInput(value: unknown) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** يحافظ على نوع القيمة الأصلية (رقم يفضل رقم) بدل ما كل حاجة تبقى نص. */
function coerceValue(original: unknown, text: string) {
  if (text === "") return null;
  if (typeof original === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

function recordDay(review: ReviewRequest) {
  const data = review.submittedData as Record<string, unknown> | null | undefined;
  const candidate = data?.date ?? data?.entryDate ?? data?.requestDate;
  if (typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  return (review.submittedAt ?? "").slice(0, 10);
}

interface ReviewGroup {
  key: string;
  day: string;
  userId: number;
  userName: string;
  entity: ReviewEntity;
  projectName: string;
  items: ReviewRequest[];
  pendingIds: number[];
  approvedCount: number;
}

function buildGroups(reviews: ReviewRequest[]): ReviewGroup[] {
  const map = new Map<string, ReviewGroup>();
  for (const review of reviews) {
    const day = recordDay(review);
    const entity = review.entity;
    const projectName = review.projectName ?? "بدون مشروع";
    const key = `${day}|${review.submittedById}|${entity}|${projectName}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        day,
        userId: review.submittedById,
        userName: review.submittedBy?.name ?? `مستخدم ${review.submittedById}`,
        entity,
        projectName,
        items: [],
        pendingIds: [],
        approvedCount: 0,
      };
      map.set(key, group);
    }
    group.items.push(review);
    if (review.status === "PENDING_REVIEW") group.pendingIds.push(review.id);
    if (review.status === "APPROVED") group.approvedCount += 1;
  }
  return [...map.values()].sort((a, b) => b.day.localeCompare(a.day) || a.userName.localeCompare(b.userName));
}

/** ختم الدفعة — التوقيع البصري الذي يتكرر في البطاقة والتفاصيل. */
function BatchStamp({ group }: { group: ReviewGroup }) {
  return (
    <div className="font-mono text-[12px] leading-5 text-stone-500">
      <bdi dir="ltr">{group.day}</bdi>
      <span className="mx-1 text-stone-300">·</span>
      <bdi dir="auto">{group.userName}</bdi>
      <span className="mx-1 text-stone-300">·</span>
      <span>{ENTITY_LABELS[group.entity]}</span>
    </div>
  );
}

function ItemsCell({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return <span className="text-stone-400">—</span>;
  return (
    <table className="w-full min-w-[280px] border-collapse text-[12px]">
      <thead>
        <tr className="text-stone-500">
          <th className="border-b border-stone-200 py-1 text-start font-normal">الصنف</th>
          <th className="border-b border-stone-200 py-1 text-start font-normal">الكمية</th>
          <th className="border-b border-stone-200 py-1 text-start font-normal">الوحدة</th>
        </tr>
      </thead>
      <tbody>
        {value.map((item: any, i: number) => (
          <tr key={i}>
            <td className="border-b border-stone-100 py-1 text-start"><bdi dir="auto">{item.itemName ?? "—"}</bdi></td>
            <td className="border-b border-stone-100 py-1 text-start font-mono tabular-nums">
              <bdi dir="ltr">{item.qty ?? "—"}</bdi>
            </td>
            <td className="border-b border-stone-100 py-1 text-start">{item.unit ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ROOT" || user?.role === "ADMIN";

  const [reviews, setReviews] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [entityFilter, setEntityFilter] = useState<ReviewEntity | "">("");
  const [statusFilter, setStatusFilter] = useState<"PENDING_REVIEW" | "APPROVED" | "REJECTED" | "">(
    "PENDING_REVIEW",
  );
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: number; key: string } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const cellInputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listReviews({
        entity: entityFilter || undefined,
        status: statusFilter || undefined,
        page: 1,
        pageSize: 200,
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

  const groups = useMemo(() => buildGroups(reviews), [reviews]);
  const group = openedKey ? (groups.find((g) => g.key === openedKey) ?? null) : null;
  const active = group?.items.find((r) => r.id === activeId) ?? null;

  const openGroup = async (g: ReviewGroup) => {
    const first = g.items.find((r) => r.status === "PENDING_REVIEW") ?? g.items[0];
    setOpenedKey(g.key);
    setActiveId(first?.id ?? null);
    setEditing(false);
    setEditingCell(null);
    // initializing synchronously avoids empty cells while the detail request is in flight
    setEditData({ ...((first?.reviewedData ?? first?.submittedData ?? {}) as Record<string, unknown>) });
    try {
      const full = await getReview(first.id);
      setEditData({ ...((full.reviewedData ?? full.submittedData) as Record<string, unknown>) });
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const chooseRow = async (review: ReviewRequest) => {
    setActiveId(review.id);
    setEditing(false);
    setEditingCell(null);
    setEditData({ ...((review.reviewedData ?? review.submittedData ?? {}) as Record<string, unknown>) });
    try {
      const full = await getReview(review.id);
      setEditData({ ...((full.reviewedData ?? full.submittedData) as Record<string, unknown>) });
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const closeDetail = () => {
    setOpenedKey(null);
    setActiveId(null);
    setEditing(false);
    setEditingCell(null);
  };

  const beginCellEdit = (review: ReviewRequest, key: string, value: unknown) => {
    if (!editing || !isAdmin || review.status !== "PENDING_REVIEW") return;
    setEditingCell({ rowId: review.id, key });
    setCellDraft(toInput(value));
    requestAnimationFrame(() => {
      cellInputRef.current?.focus();
      cellInputRef.current?.select();
    });
  };

  const commitCell = (review: ReviewRequest, key: string) => {
    const original = cellValue(
      review,
      (review.reviewedData ?? review.submittedData ?? {}) as Record<string, unknown>,
      key,
    );
    setEditData((d) => ({ ...d, [key]: coerceValue(original, cellDraft) }));
    setEditingCell(null);
  };

  const persistEdits = async (review: ReviewRequest) => {
    const original = review.reviewedData ?? review.submittedData;
    if (JSON.stringify(editData) !== JSON.stringify(original)) {
      await updateReview(review.id, editData);
    }
  };

  const handleApprove = async () => {
    if (!active || !isAdmin) return;
    setSaving(true);
    try {
      await persistEdits(active);
      const res = await approveReview(active.id);
      if (res.sent === false) {
        toast.error(`تم اعتماد السجل، لكن فشل الإرسال إلى نظام المدرين: ${res.sendError ?? ""}`);
      } else if (res.sent === true) {
        toast.success("تم اعتماد السجل وإرساله إلى نظام المدرين");
      } else {
        toast.success("تم اعتماد السجل");
      }
      setEditing(false);
      setEditingCell(null);
      await load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleBulk = async (g: ReviewGroup) => {
    if (!isAdmin || g.pendingIds.length === 0) return;
    setBulkSaving(g.key);
    try {
      const result = await bulkApproveReviews(g.pendingIds);
      const failed = result.failed ?? [];
      const sendFailed = result.sendFailed ?? [];
      if (failed.length > 0) {
        toast.error(
          `تم اعتماد ${NUMBER_FORMAT.format(result.approved)} سجل، وتعذّر اعتماد ${NUMBER_FORMAT.format(
            failed.length,
          )}: ${failed[0].message}`,
        );
      } else if (sendFailed.length > 0) {
        toast.error(
          `تم اعتماد ${NUMBER_FORMAT.format(result.approved)} سجل، لكن تعذّر إرسال ${NUMBER_FORMAT.format(
            sendFailed.length,
          )} إلى نظام المدرين: ${sendFailed[0].message}`,
        );
      } else {
        toast.success(
          `تم اعتماد ${NUMBER_FORMAT.format(result.approved)} سجل${
            result.skipped ? ` وتجاهل ${NUMBER_FORMAT.format(result.skipped)} سجل معتمد بالفعل` : ""
          }${result.approved > 0 ? " — تم الإرسال إلى نظام المدرين" : ""}`,
        );
      }
      await load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setBulkSaving(null);
    }
  };

  const handleDelete = async () => {
    if (!active || !isAdmin || active.status !== "PENDING_REVIEW") return;
    setSaving(true);
    try {
      await deleteReview(active.id);
      toast.success("تم حذف الطلب المعلّق");
      setEditing(false);
      setEditingCell(null);
      await load();
      if (group?.items.length === 1) closeDetail();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    if (!active) return;
    setEditData({ ...((active.reviewedData ?? active.submittedData ?? {}) as Record<string, unknown>) });
    setEditing(false);
    setEditingCell(null);
  };

  const selectCls =
    "rounded-lg border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-700 focus:outline-none focus:ring-2 focus:ring-primary-500/40";

  return (
    <div className="flex min-h-full flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium leading-snug text-stone-900">مراجعة البيانات</h1>
          <p className="mt-1 text-[13px] leading-6 text-stone-500">
            {isAdmin ? "اعتماد ما أرسله المستخدمون، مجموعة بمجموعة" : "حالة البيانات التي أرسلتها"}
          </p>
        </div>
        {!group && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="نوع السجل"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value as ReviewEntity | "")}
              className={selectCls}
            >
              <option value="">كل الأنواع</option>
              {(Object.keys(ENTITY_LABELS) as ReviewEntity[]).map((key) => (
                <option key={key} value={key}>{ENTITY_LABELS[key]}</option>
              ))}
            </select>
            <select
              aria-label="حالة السجل"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className={selectCls}
            >
              <option value="">كل الحالات</option>
              <option value="PENDING_REVIEW">قيد المراجعة</option>
              <option value="APPROVED">معتمد</option>
              <option value="REJECTED">مرفوض</option>
            </select>
          </div>
        )}
      </header>

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-[13px] text-stone-500">
          <Loader2 size={18} className="animate-spin" /> جاري تحميل السجلات
        </div>
      ) : group ? (
        <section className="flex flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-5 py-4">
            <div>
              <BatchStamp group={group} />
              <h2 className="mt-1 text-[15px] font-medium text-stone-900">{group.projectName}</h2>
            </div>
            <button
              onClick={closeDetail}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-[13px] text-stone-600 transition-colors hover:bg-stone-50"
            >
              <ArrowRight size={16} strokeWidth={1.5} /> رجوع للقائمة
            </button>
          </div>

          <div className="flex-1 overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full min-w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-stone-50">
                <tr>
                  <th className="w-16 border-b border-stone-200 px-3 py-3 text-start text-[12px] font-normal text-stone-500">
                    #
                  </th>
                  {COLUMNS[group.entity].map((col) => (
                    <th
                      key={col.key}
                      className="whitespace-nowrap border-b border-stone-200 px-3 py-3 text-start text-[12px] font-normal text-stone-500"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.items.map((review) => {
                  const data = (review.reviewedData ?? review.submittedData ?? {}) as Record<string, unknown>;
                  const selected = review.id === activeId;
                  const rowEditable = editing && isAdmin && selected && review.status === "PENDING_REVIEW";
                  return (
                    <tr
                      key={review.id}
                      tabIndex={editing ? -1 : 0}
                      onClick={() => {
                        if (!editing) void chooseRow(review);
                      }}
                      onKeyDown={(e) => {
                        if (!editing && (e.key === "Enter" || e.key === " ")) void chooseRow(review);
                      }}
                      aria-selected={selected}
                      className={cn(
                        "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500",
                        editing ? "cursor-default" : "cursor-pointer hover:bg-stone-50",
                        selected ? "bg-primary-50/70" : "",
                        review.status !== "PENDING_REVIEW" && "text-stone-500",
                      )}
                    >
                      <td className="border-b border-stone-100 px-3 py-3 align-top">
                        <span className="flex items-center gap-2">
                          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[review.status])} title={STATUS_LABELS[review.status]} />
                          <span className="font-mono text-[12px] tabular-nums text-stone-500">
                            <bdi dir="ltr">{review.id}</bdi>
                          </span>
                        </span>
                      </td>
                      {COLUMNS[group.entity].map((col) => {
                        const value = cellValue(review, data, col.key);
                        const isCellEditing = editingCell?.rowId === review.id && editingCell.key === col.key;
                        const canEdit = rowEditable && !col.noEdit && col.key !== "items";
                        return (
                          <td
                            key={col.key}
                            onClick={(e) => {
                              if (!canEdit || isCellEditing) return;
                              e.stopPropagation();
                              beginCellEdit(review, col.key, value);
                            }}
                            title={canEdit ? "اضغط للتعديل" : undefined}
                            className={cn(
                              "border-b border-stone-100 px-3 py-3 align-top",
                              col.mono && "font-mono tabular-nums",
                              canEdit && "cursor-text transition-colors hover:bg-primary-100/60",
                              isCellEditing && "bg-white ring-2 ring-inset ring-primary-500",
                            )}
                          >
                            {col.key === "items" ? (
                              <ItemsCell value={value} />
                            ) : isCellEditing ? (
                              <input
                                ref={cellInputRef}
                                dir={col.mono ? "ltr" : "auto"}
                                value={cellDraft}
                                onChange={(e) => setCellDraft(e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => commitCell(review, col.key)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitCell(review, col.key);
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditingCell(null);
                                  }
                                }}
                                className="w-full min-w-[80px] rounded border border-primary-400 bg-white px-1.5 py-1 text-[13px] text-stone-800 outline-none"
                              />
                            ) : (
                              <bdi dir="auto">{formatValue(value, col.mono)}</bdi>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editing && active && isAdmin && active.status === "PENDING_REVIEW" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-[12px] leading-5 text-primary-800">
              <Pencil size={14} strokeWidth={1.5} />
              وضع التعديل مفعّل — اضغط على أي خلية في الصف المحدد وعدّلها، ثم Enter أو اضغط خارج الخلية للحفظ.
              <span className="text-primary-600">Esc لإلغاء الخلية.</span>
            </div>
          )}

          <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-3 border-t border-stone-200 bg-white/95 px-5 py-4 backdrop-blur-sm">
            <span className="me-auto text-[12px] text-stone-500">
              {active
                ? `${STATUS_LABELS[active.status]} · سجل ${NUMBER_FORMAT.format(active.id)}${editing ? " · وضع التعديل" : ""}`
                : ""}
            </span>
            <button
              onClick={() => void handleDelete()}
              disabled={saving || !isAdmin || active?.status !== "PENDING_REVIEW"}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-4 py-2.5 text-[13px] text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={16} strokeWidth={1.5} /> حذف
            </button>
            <button
              onClick={() => (editing ? cancelEdit() : setEditing(true))}
              disabled={saving || !isAdmin || active?.status !== "PENDING_REVIEW"}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                editing
                  ? "border-stone-300 bg-stone-100 text-stone-700"
                  : "border-stone-200 text-stone-700 hover:bg-stone-50",
              )}
            >
              {editing ? <X size={16} strokeWidth={1.5} /> : <Pencil size={16} strokeWidth={1.5} />}
              {editing ? "إلغاء التعديل" : "تعديل"}
            </button>
            <button
              onClick={() => void handleApprove()}
              disabled={saving || !isAdmin || active?.status !== "PENDING_REVIEW"}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-5 py-2.5 text-[13px] text-white transition-colors hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} strokeWidth={1.5} />}
              اعتماد
            </button>
          </div>
        </section>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-stone-200 bg-white py-20 text-center">
          <ClipboardCheck size={24} strokeWidth={1.5} className="text-stone-400" />
          <p className="text-[13px] text-stone-500">لا توجد سجلات مطابقة</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => {
            const total = g.items.length;
            const percent = total ? Math.round((g.approvedCount / total) * 100) : 0;
            const canApprove = isAdmin && g.pendingIds.length > 0;
            return (
              <article
                key={g.key}
                className="rounded-2xl border border-stone-200 bg-white p-5 transition-colors hover:border-stone-300"
              >
                <button onClick={() => void openGroup(g)} className="block w-full text-start">
                  <BatchStamp group={g} />
                  <h2 className="mt-3 text-[15px] font-medium leading-6 text-stone-900">{g.projectName}</h2>
                  <p className="mt-1 text-[13px] text-stone-500">
                    <bdi dir="auto">{g.userName}</bdi>
                    <span className="mx-1 text-stone-300">·</span>
                    {ENTITY_LABELS[g.entity]}
                  </p>
                </button>

                <div className="mt-5 flex items-end justify-between gap-3">
                  <div>
                    <div className="font-mono text-[15px] tabular-nums text-stone-800">
                      <bdi dir="ltr">
                        {NUMBER_FORMAT.format(g.approvedCount)}/{NUMBER_FORMAT.format(total)}
                      </bdi>
                    </div>
                    <div className="mt-0.5 text-[12px] text-stone-500">معتمد من المجموعة</div>
                  </div>
                  <button
                    onClick={() => void handleBulk(g)}
                    disabled={!canApprove || bulkSaving === g.key}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-3 py-2 text-[12px] text-white transition-colors hover:bg-primary-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
                  >
                    {bulkSaving === g.key ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Check size={16} strokeWidth={1.5} />
                    )}
                    اعتماد المجموعة
                  </button>
                </div>

                <div className="mt-4 h-1 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-primary-700 transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
                </div>

                <button
                  onClick={() => void openGroup(g)}
                  className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-primary-700 transition-colors hover:text-primary-800"
                >
                  عرض البيانات <ChevronLeft size={16} strokeWidth={1.5} />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
