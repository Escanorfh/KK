import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Gauge,
  HardHat,
  Loader2,
  PlusCircle,
  RotateCcw,
  Save,
} from "lucide-react";
import {
  cn,
  toNumberOrNull,
  TRACKING_MODE_LABELS,
  trackingModeAppliesHours,
  trackingModeAppliesKm,
} from "@/lib/utils";
import { getApiError, getApiFieldErrors } from "@/lib/api";
import type { EquipmentCategory, TrackingMode } from "@/types";
import {
  listCategories,
  registerEquipment,
  type RegisterEquipmentResponse,
} from "@/services/equipments";
import { listSectors, projectOptions } from "@/services/projects";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-slate-50 disabled:text-slate-400";
const cardCls = "bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden";

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: typeof HardHat;
  children: ReactNode;
}) {
  return (
    <section className={cardCls}>
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-slate-200 bg-slate-50/60">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-700 shrink-0">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          {description && <p className="text-[11px] text-slate-500">{description}</p>}
        </div>
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[11px] font-semibold text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

function meterSummary(reset: RegisterEquipmentResponse["meterReset"]) {
  if (!reset) return "لم تُسجل قراءة";
  const parts: string[] = [];
  if (reset.hours != null) parts.push(`${reset.hours} ساعة`);
  if (reset.km != null) parts.push(`${reset.km} كم`);
  return parts.length ? parts.join(" — ") : "لم تُسجل قراءة";
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400">{label}</div>
      <div
        className={cn(
          "text-[13px] font-semibold text-slate-800 break-words",
          mono && "font-mono"
        )}
        dir={mono ? "ltr" : undefined}
      >
        {value}
      </div>
    </div>
  );
}

export default function RegisterEquipmentPage() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [trackingMode, setTrackingMode] = useState<TrackingMode>("BOTH");
  const [projectId, setProjectId] = useState<number | "">("");
  const [sectorId, setSectorId] = useState<number | "">("");
  const [meterHours, setMeterHours] = useState("");
  const [meterKm, setMeterKm] = useState("");

  const [projects, setProjects] = useState<{ id: number; code?: string | null; name: string }[]>([]);
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);
  const [sectors, setSectors] = useState<{ id: number; name: string }[]>([]);

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingSectors, setLoadingSectors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<RegisterEquipmentResponse | null>(null);

  const hoursApplicable = trackingModeAppliesHours(trackingMode);
  const kmApplicable = trackingModeAppliesKm(trackingMode);

  useEffect(() => {
    let cancelled = false;
    setLoadingOptions(true);
    Promise.all([projectOptions(), listCategories()])
      .then(([projectRows, categoryRows]) => {
        if (cancelled) return;
        setProjects(projectRows);
        setCategories(categoryRows);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // القطاعات تُحمّل فقط من روابط ProjectSector النشطة للمشروع المختار،
  // وتُعاد للصفر عند تغيير المشروع.
  useEffect(() => {
    setSectorId("");
    setSectors([]);

    if (projectId === "") return;

    const pid = Number(projectId);
    let cancelled = false;
    setLoadingSectors(true);

    listSectors(pid)
      .then((rows) => {
        if (cancelled) return;
        const seen = new Set<number>();
        const options: { id: number; name: string }[] = [];
        for (const row of rows) {
          const isLinked = (row.projects ?? []).some(
            (link) => link.projectId === pid && link.active
          );
          if (!isLinked || seen.has(row.id)) continue;
          seen.add(row.id);
          options.push({ id: row.id, name: row.name });
        }
        setSectors(options);
      })
      .catch((err) => {
        if (cancelled) return;
        setSectors([]);
        setError(getApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingSectors(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleCategoryChange = (value: string) => {
    if (value === "") {
      setCategoryId("");
      return;
    }
    const id = Number(value);
    setCategoryId(id);
    const category = categories.find((c) => c.id === id);
    if (category) setTrackingMode(category.defaultTrackingMode);
  };

  const handleTrackingModeChange = (mode: TrackingMode) => {
    setTrackingMode(mode);
    if (!trackingModeAppliesHours(mode)) setMeterHours("");
    if (!trackingModeAppliesKm(mode)) setMeterKm("");
  };

  const applyApiErrors = (err: unknown) => {
    const apiErrors = getApiFieldErrors(err);
    const mapped: Record<string, string> = {};
    for (const [key, messages] of Object.entries(apiErrors)) {
      if (messages && messages.length) mapped[key] = messages[0];
    }
    if (Object.keys(mapped).length) {
      setFieldErrors((prev) => ({ ...prev, ...mapped }));
      setError("راجع الحقول المظللة — هناك بيانات غير صحيحة.");
      return true;
    }
    return false;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const errors: Record<string, string> = {};
    if (!code.trim()) errors.code = "كود المعدة مطلوب";
    if (!name.trim()) errors.name = "اسم المعدة مطلوب";
    if (projectId === "") errors.projectId = "يجب اختيار المشروع";

    if (hoursApplicable && meterHours.trim() !== "") {
      const parsed = toNumberOrNull(meterHours);
      if (parsed == null) errors.meterHours = "أدخل رقمًا صحيحًا";
      else if (parsed < 0) errors.meterHours = "لا يمكن أن تكون القراءة سالبة";
    }
    if (kmApplicable && meterKm.trim() !== "") {
      const parsed = toNumberOrNull(meterKm);
      if (parsed == null) errors.meterKm = "أدخل رقمًا صحيحًا";
      else if (parsed < 0) errors.meterKm = "لا يمكن أن تكون القراءة سالبة";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const hours = hoursApplicable ? toNumberOrNull(meterHours) : null;
    const km = kmApplicable ? toNumberOrNull(meterKm) : null;

    setSaving(true);
    setError(null);
    try {
      const result = await registerEquipment({
        code: code.trim(),
        name: name.trim(),
        categoryId: categoryId === "" ? null : Number(categoryId),
        trackingMode,
        projectId: Number(projectId),
        sectorId: sectorId === "" ? null : Number(sectorId),
        meterHours: hours,
        meterKm: km,
      });
      setSuccess(result);
      toast.success(`تمت إضافة المعدة ${result.equipment.code}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (!applyApiErrors(err)) setError(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSuccess(null);
    setError(null);
    setFieldErrors({});
    setCode("");
    setName("");
    setCategoryId("");
    setTrackingMode("BOTH");
    setProjectId("");
    setSectorId("");
    setSectors([]);
    setMeterHours("");
    setMeterKm("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (success) {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        <div className={cn(cardCls, "border-emerald-200")}>
          <div className="flex items-start gap-3 px-5 py-4 bg-emerald-50 border-b border-emerald-200">
            <CheckCircle2 size={20} className="text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <h1 className="text-sm font-bold text-emerald-800">تمت إضافة المعدة بنجاح</h1>
              <p className="text-[12px] text-emerald-700 mt-0.5">
                تم حفظ بيانات المعدة والتخصيص الأولي وقراءة العداد في قاعدة البيانات.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 p-5">
            <InfoRow label="كود المعدة" value={success.equipment.code} mono />
            <InfoRow label="اسم المعدة" value={success.equipment.name} />
            <InfoRow label="المشروع" value={success.equipment.project?.name || "—"} />
            <InfoRow
              label="القطاع"
              value={success.equipment.sector?.name || "بدون قطاع"}
            />
            <InfoRow
              label="نوع العداد"
              value={TRACKING_MODE_LABELS[success.equipment.trackingMode] || success.equipment.trackingMode}
            />
            <InfoRow
              label="فئة المعدة"
              value={success.equipment.category?.name || "غير مصنفة"}
            />
            <InfoRow label="آخر قراءة محفوظة" value={meterSummary(success.meterReset)} />
            <InfoRow
              label="تاريخ نقطة البداية"
              value={success.baselineDate || "لم تُسجل قراءة"}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50/60">
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white text-[13px] font-semibold px-4 py-2 transition-colors"
            >
              <RotateCcw size={15} />
              إضافة معدة أخرى
            </button>
            <Link
              to="/equipment"
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-[13px] font-semibold px-4 py-2 transition-colors"
            >
              <HardHat size={15} />
              عرض سجل المعدات
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">إضافة معدة جديدة</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            تسجيل معدة مع تحديد المشروع والقطاع وآخر قراءة فعلية للعداد.
          </p>
        </div>
        <Link
          to="/equipment"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white text-[13px] font-semibold px-3 py-2 transition-colors"
        >
          <HardHat size={15} />
          سجل المعدات
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Section
          title="بيانات المعدة"
          description="الحقول الأساسية الموجودة في سجل المعدات."
          icon={HardHat}
        >
          <Field label="كود المعدة" required error={fieldErrors.code}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="مثال: EX-105"
              dir="ltr"
              className={cn(inputCls, "font-mono text-left")}
              disabled={saving}
            />
          </Field>

          <Field label="اسم المعدة" required error={fieldErrors.name}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: حفار كاتربيلر"
              className={inputCls}
              disabled={saving}
            />
          </Field>

          <Field
            label="فئة المعدة"
            error={fieldErrors.categoryId}
            hint="اختيارية — تُستخدم لتحديد نوع العداد الافتراضي."
          >
            <select
              value={categoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className={inputCls}
              disabled={saving || loadingOptions}
            >
              <option value="">بدون فئة</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="نوع العداد"
            error={fieldErrors.trackingMode}
            hint="يُحدد الوحدات المطلوبة في قراءة العداد."
          >
            <select
              value={trackingMode}
              onChange={(e) => handleTrackingModeChange(e.target.value as TrackingMode)}
              className={inputCls}
              disabled={saving}
            >
              {(Object.keys(TRACKING_MODE_LABELS) as TrackingMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {TRACKING_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section
          title="التخصيص"
          description="المشروع إلزامي، والقطاعات تُعرض من روابط المشروع النشطة فقط."
          icon={Building2}
        >
          <Field label="المشروع" required error={fieldErrors.projectId}>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}
              className={inputCls}
              disabled={saving || loadingOptions}
            >
              <option value="">
                {loadingOptions ? "جارٍ تحميل المشاريع..." : "اختر المشروع"}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="القطاع"
            error={fieldErrors.sectorId}
            hint="اختياري — لا يظهر إلا القطاعات المرتبطة بالمشروع برابط ProjectSector نشط."
          >
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value ? Number(e.target.value) : "")}
              className={inputCls}
              disabled={saving || projectId === "" || loadingSectors}
            >
              <option value="">
                {projectId === ""
                  ? "اختر المشروع أولًا"
                  : loadingSectors
                    ? "جارٍ تحميل القطاعات..."
                    : sectors.length === 0
                      ? "لا توجد قطاعات مرتبطة بهذا المشروع"
                      : "بدون قطاع"}
              </option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
            لا يتم إنشاء أو تفعيل أي ربط قطاع/مشروع تلقائيًا من هذه الصفحة.
          </div>
        </Section>

        <Section
          title="آخر قراءة للعداد عند الإضافة"
          description="تُحفظ كنقطة بداية للمعدة، ولا تُنشئ سجلًا يوميًا."
          icon={Gauge}
        >
          {hoursApplicable && (
            <Field label="عداد الساعات" error={fieldErrors.meterHours} hint="ساعة">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={meterHours}
                onChange={(e) => setMeterHours(e.target.value)}
                placeholder="اتركه فارغًا إذا لم تتوفر قراءة"
                className={cn(inputCls, "text-left")}
                dir="ltr"
                disabled={saving}
              />
            </Field>
          )}

          {kmApplicable && (
            <Field label="عداد الكيلومترات" error={fieldErrors.meterKm} hint="كم">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={meterKm}
                onChange={(e) => setMeterKm(e.target.value)}
                placeholder="اتركه فارغًا إذا لم تتوفر قراءة"
                className={cn(inputCls, "text-left")}
                dir="ltr"
                disabled={saving}
              />
            </Field>
          )}

          <div className="sm:col-span-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
            تُحفظ القراءة في سجل عدادات المعدة كنقطة بداية فعلية. لا تُسجَّل قيمة صفر
            تلقائيًا، والحقل الفارغ يبقى بدون قراءة. لا يُنشئ هذا الإجراء سجل Data Day
            ولا Transfer.
          </div>
        </Section>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            to="/equipment"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white text-[13px] font-semibold px-4 py-2.5 transition-colors"
          >
            إلغاء
          </Link>
          <button
            type="submit"
            disabled={saving || loadingOptions}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-semibold px-5 py-2.5 transition-colors"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            {saving ? "جارٍ الحفظ..." : "حفظ المعدة"}
          </button>
        </div>

        <p className="flex items-center gap-2 text-[11px] text-slate-400">
          <PlusCircle size={13} />
          هذه الصفحة متاحة لحساب ROOT فقط.
        </p>
      </form>
    </div>
  );
}
