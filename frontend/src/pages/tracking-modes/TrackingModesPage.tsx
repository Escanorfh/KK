import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Loader2,
  SlidersHorizontal,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Trash2,
  Plus,
  X,
  Save,
} from "lucide-react";
import { cn, TRACKING_MODE_LABELS, TRACKING_MODE_CLS } from "@/lib/utils";
import { getApiError } from "@/lib/api";
import type { EquipmentCategory, TrackingMode } from "@/types";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  updateEquipment,
  getTrackingReview,
  type TrackingReview,
  type TrackingReviewRow,
} from "@/services/equipments";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const thCls =
  "px-3 py-2 text-right text-xs font-bold text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap";
const tdCls = "px-3 py-2 text-[13px] text-slate-700 border-b border-slate-100";

const MODE_OPTIONS: { value: TrackingMode; label: string }[] = [
  { value: "HOURS", label: "ساعات التشغيل" },
  { value: "KM", label: "الكيلومترات" },
  { value: "BOTH", label: "ساعات + كيلومترات" },
];

function parsePrefixes(value: string): string[] {
  return value
    .split(/[,،\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
}

export default function TrackingModesPage() {
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);
  const [review, setReview] = useState<TrackingReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);

  const [newName, setNewName] = useState("");
  const [newPrefixes, setNewPrefixes] = useState("");
  const [newMode, setNewMode] = useState<TrackingMode>("BOTH");

  const [editing, setEditing] = useState<{
    id: number;
    name: string;
    prefixes: string;
    mode: TrackingMode;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [cats, rev] = await Promise.all([listCategories(), getTrackingReview()]);
      setCategories(cats);
      setReview(rev);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveRow = async (
    row: TrackingReviewRow,
    payload: {
      categoryId?: number | null;
      trackingMode?: TrackingMode;
      trackingModeConfirmed?: boolean;
    }
  ) => {
    setSavingId(row.equipmentId);
    try {
      await updateEquipment(row.equipmentId, payload);
      toast.success("تم حفظ إعدادات وضع التتبع");
      await load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSavingId(null);
    }
  };

  const addCategory = async () => {
    if (!newName.trim()) {
      toast.error("اكتب اسم الفئة");
      return;
    }
    setCategorySaving(true);
    try {
      await createCategory({
        name: newName.trim(),
        codePrefixes: parsePrefixes(newPrefixes),
        defaultTrackingMode: newMode,
      });
      setNewName("");
      setNewPrefixes("");
      setNewMode("BOTH");
      toast.success("تمت إضافة الفئة");
      await load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setCategorySaving(false);
    }
  };

  const saveCategory = async (
    category: EquipmentCategory,
    payload: Partial<{ name: string; codePrefixes: string[]; defaultTrackingMode: TrackingMode }>
  ) => {
    setCategorySaving(true);
    try {
      await updateCategory(category.id, payload);
      setEditing(null);
      toast.success("تم تحديث الفئة");
      await load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setCategorySaving(false);
    }
  };

  const changeDefaultMode = async (category: EquipmentCategory, mode: TrackingMode) => {
    if (
      !window.confirm(
        "تغيير الوضع الافتراضي يسري على معدات الفئة التي لم تتجاوز الوضع، ويعيد تأكيد أوضاعها. متابعة؟"
      )
    ) {
      return;
    }
    await saveCategory(category, { defaultTrackingMode: mode });
  };

  const removeCategory = async (category: EquipmentCategory) => {
    if (!window.confirm(`حذف فئة «${category.name}»؟`)) return;
    setCategorySaving(true);
    try {
      await deleteCategory(category.id);
      toast.success("تم حذف الفئة");
      await load();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setCategorySaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <SlidersHorizontal size={19} className="text-primary-700" />
          أوضاع التتبع وفئات المعدات
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          وضع التتبع يحدد العدادات المعتمدة لتنبيهات الزيت والفلتر. المعدات التي لم يُؤكد وضعها
          لا تُفعَّل تنبيهاتها. راجع التعارضات أدناه، واختر الفئة والوضع ثم أكّد.
        </p>
      </div>

      {review && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-2xl font-extrabold text-slate-800">{review.summary.total}</div>
            <div className="text-[11px] font-semibold text-slate-500">إجمالي المعدات</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-2xl font-extrabold text-amber-700">{review.summary.review}</div>
            <div className="text-[11px] font-semibold text-amber-700">بحاجة إلى مراجعة</div>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <div className="text-2xl font-extrabold text-red-700">{review.summary.unconfirmed}</div>
            <div className="text-[11px] font-semibold text-red-700">وضع تتبع غير مؤكد</div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-amber-600" />
            قائمة المراجعة والتعارضات
          </span>
          <span className="text-xs text-slate-400">
            {review?.rows.length ?? 0} معدة بحاجة إلى مراجعة
          </span>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> جاري التحميل...
          </div>
        ) : !review || review.rows.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2" />
            <p className="text-sm font-bold text-slate-700">لا توجد تعارضات — كل المعدات مؤكدة</p>
            <p className="text-xs text-slate-400 mt-1">
              يمكنك تعديل فئات المعدات وافتراضيات التتبع من الجدول أدناه.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] border-collapse">
              <thead>
                <tr>
                  <th className={thCls}>الكود</th>
                  <th className={thCls}>المعدة</th>
                  <th className={thCls}>الفئة</th>
                  <th className={thCls}>البيانات المتاحة</th>
                  <th className={thCls}>وضع التتبع</th>
                  <th className={thCls}>الحالة</th>
                  <th className={thCls}>الملاحظات</th>
                  <th className={cn(thCls, "text-center")}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row) => (
                  <tr key={row.equipmentId} className="hover:bg-slate-50/50">
                    <td className={cn(tdCls, "font-mono text-xs font-bold text-primary-700")} dir="ltr">
                      {row.code}
                    </td>
                    <td className={tdCls}>
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-[11px] text-slate-400">{row.projectName || "بدون مشروع"}</div>
                    </td>
                    <td className={tdCls}>
                      <select
                        value={row.categoryId ?? ""}
                        onChange={(e) =>
                          saveRow(row, {
                            categoryId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        disabled={savingId === row.equipmentId}
                        className={cn(inputCls, "text-xs py-1.5 min-w-[130px]")}
                      >
                        <option value="">— بدون فئة —</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span
                          className={cn(
                            "text-[10px] font-bold rounded-full px-1.5 py-0.5",
                            row.hasHoursData
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          )}
                        >
                          ساعات {row.hasHoursData ? "✓" : "✗"}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-bold rounded-full px-1.5 py-0.5",
                            row.hasKmData ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                          )}
                        >
                          كم {row.hasKmData ? "✓" : "✗"}
                        </span>
                      </div>
                    </td>
                    <td className={tdCls}>
                      <select
                        value={row.trackingMode}
                        onChange={(e) =>
                          saveRow(row, {
                            trackingMode: e.target.value as TrackingMode,
                            trackingModeConfirmed: true,
                          })
                        }
                        disabled={savingId === row.equipmentId}
                        className={cn(inputCls, "text-xs py-1.5 min-w-[145px]")}
                      >
                        {MODE_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {row.trackingModeOverridden ? "مخصص لهذه المعدة" : "موروث من الفئة"}
                      </div>
                    </td>
                    <td className={tdCls}>
                      <span
                        className={cn(
                          "text-[10px] font-bold rounded-full px-1.5 py-0.5 whitespace-nowrap",
                          row.trackingModeConfirmed
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                        )}
                      >
                        {row.trackingModeConfirmed ? "مؤكد" : "غير مؤكد"}
                      </span>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {TRACKING_MODE_LABELS[row.trackingMode]}
                      </div>
                    </td>
                    <td className={cn(tdCls, "text-red-700 text-[11px] max-w-[220px]")}>
                      {row.issues.join("، ")}
                    </td>
                    <td className={cn(tdCls, "text-center")}>
                      {savingId === row.equipmentId ? (
                        <Loader2 size={15} className="animate-spin inline text-slate-400" />
                      ) : row.trackingModeConfirmed ? (
                        <CheckCircle2 size={16} className="inline text-emerald-500" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => saveRow(row, { trackingModeConfirmed: true })}
                          className="text-[11px] font-bold rounded-lg bg-emerald-600 text-white px-2.5 py-1.5 hover:bg-emerald-700 transition-colors"
                        >
                          تأكيد
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60">
          <span className="text-sm font-bold text-slate-700">فئات المعدات وافتراضيات التتبع</span>
          <p className="text-[11px] text-slate-500 mt-0.5">
            بادئات الأكواد تُستخدم لتعيين الفئة تلقائيًا للمعدات الجديدة وعند المزامنة.
          </p>
        </div>

        <div className="p-3 border-b border-slate-200 bg-slate-50/30">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">اسم الفئة</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="مثال: قلاب"
                className={cn(inputCls, "text-xs py-1.5")}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                بادئات الأكواد (مفصولة بفاصلة)
              </label>
              <input
                value={newPrefixes}
                onChange={(e) => setNewPrefixes(e.target.value)}
                placeholder="مثال: QB, QL"
                dir="ltr"
                className={cn(inputCls, "text-xs py-1.5 font-mono")}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                الوضع الافتراضي
              </label>
              <select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as TrackingMode)}
                className={cn(inputCls, "text-xs py-1.5")}
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={addCategory}
              disabled={categorySaving}
              className="flex items-center justify-center gap-1.5 text-xs font-bold rounded-lg bg-primary-700 text-white px-3 py-2 hover:bg-primary-800 disabled:opacity-60 transition-colors"
            >
              {categorySaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              إضافة فئة
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr>
                <th className={thCls}>الفئة</th>
                <th className={thCls}>بادئات الأكواد</th>
                <th className={thCls}>الوضع الافتراضي</th>
                <th className={cn(thCls, "text-center")}>المعدات</th>
                <th className={cn(thCls, "text-center")}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td className={tdCls}>
                    {editing?.id === cat.id ? (
                      <input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        className={cn(inputCls, "text-xs py-1.5")}
                      />
                    ) : (
                      <span className="font-semibold">{cat.name}</span>
                    )}
                  </td>
                  <td className={tdCls}>
                    {editing?.id === cat.id ? (
                      <input
                        value={editing.prefixes}
                        onChange={(e) => setEditing({ ...editing, prefixes: e.target.value })}
                        dir="ltr"
                        className={cn(inputCls, "text-xs py-1.5 font-mono")}
                      />
                    ) : cat.codePrefixes.length ? (
                      <span className="font-mono text-xs" dir="ltr">
                        {cat.codePrefixes.join(", ")}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className={tdCls}>
                    <select
                      value={cat.defaultTrackingMode}
                      onChange={(e) => changeDefaultMode(cat, e.target.value as TrackingMode)}
                      disabled={categorySaving}
                      className={cn(inputCls, "text-xs py-1.5 min-w-[130px]")}
                    >
                      {MODE_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={cn(tdCls, "text-center font-mono text-xs")}>
                    {cat._count?.equipment ?? 0}
                  </td>
                  <td className={cn(tdCls, "text-center")}>
                    {editing?.id === cat.id ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            saveCategory(cat, {
                              name: editing.name.trim(),
                              codePrefixes: parsePrefixes(editing.prefixes),
                              defaultTrackingMode: editing.mode,
                            })
                          }
                          disabled={categorySaving}
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                          title="حفظ"
                        >
                          <Save size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
                          title="إلغاء"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({
                              id: cat.id,
                              name: cat.name,
                              prefixes: cat.codePrefixes.join(", "),
                              mode: cat.defaultTrackingMode,
                            })
                          }
                          className="p-1.5 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-50"
                          title="تعديل"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCategory(cat)}
                          disabled={categorySaving || (cat._count?.equipment ?? 0) > 0}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent"
                          title={
                            (cat._count?.equipment ?? 0) > 0
                              ? "لا يمكن حذف فئة مرتبطة بمعدات"
                              : "حذف"
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
          الأوضاع المتاحة:{" "}
          {MODE_OPTIONS.map((m) => (
            <span key={m.value} className={cn("inline-block rounded-full px-2 py-0.5 mx-0.5", TRACKING_MODE_CLS[m.value])}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
