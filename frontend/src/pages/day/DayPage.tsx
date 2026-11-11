import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Save, Loader2, Plus, FilePlus2, Copy, Search, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn, todayLocal, toNumberOrNull, formatDate, CONDITION_LABELS, TRACKING_MODE_LABELS, trackingModeAppliesHours } from "@/lib/utils";
import { getApiError, getApiFieldErrors } from "@/lib/api";
import { isQueued } from "@/lib/offline/queue";
import { lookupEquipment, createEquipment, getLastMeter, type LastMeter } from "@/services/equipments";
import { saveDailyLog, listDailyLogs, listAllDailyLogs, productivityTypes } from "@/services/dailylogs";
import { projectOptions, listSectors } from "@/services/projects";
import type { SectorRow } from "@/services/projects";
import type { DailyLog, Equipment, Project, TrackingMode } from "@/types";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";

interface FormState {
  id: number | null;
  equipmentId: number | null;
  code: string;
  equipmentName: string;
  projectId: number | null;
  projectCode: string | null;
  sectorId: number | null;
  projectName: string;
  attestation: string | null;
  sectorName: string;
  trackingMode: TrackingMode;
  endMeter: string;
  operatingHours: string;
  diesel: string;
  productivityType: string;
  productivityCount: string;
  condition: "GOOD" | "BROKEN" | "STOPPED" | "";
  notes: string;
}

const emptyForm: FormState = {
  id: null,
  equipmentId: null,
  code: "",
  equipmentName: "",
  projectId: null,
  projectCode: null,
  sectorId: null,
  projectName: "",
  attestation: null,
  sectorName: "",
  trackingMode: "BOTH",
  endMeter: "",
  operatingHours: "",
  diesel: "",
  productivityType: "",
  productivityCount: "",
  condition: "",
  notes: "",
};

/** اليوم السابق لتاريخ الاختيار بالتوقيت المحلي — لجلب آخر سجل متسجل قبل هذا اليوم */
function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(
    prev.getDate()
  ).padStart(2, "0")}`;
}

export default function DayPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayLocal());
  const [form, setForm] = useState<FormState>(emptyForm);
  const [suggestions, setSuggestions] = useState<Equipment[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [records, setRecords] = useState<DailyLog[]>([]);
  const [recordedToday, setRecordedToday] = useState<Set<number>>(new Set());
  const [recordsDate, setRecordsDate] = useState<string | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [projects, setProjects] = useState<Pick<Project, "id" | "code" | "name">[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newEqName, setNewEqName] = useState("");
  const [newEqProject, setNewEqProject] = useState("");
  const [creatingEq, setCreatingEq] = useState(false);
  const [baseline, setBaseline] = useState<LastMeter | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [lastCondition, setLastCondition] = useState<{ value: NonNullable<DailyLog["condition"]>; date: string } | null>(null);

  const setField = (key: keyof FormState, value: string | number | null) =>
    setForm((f) => ({ ...f, [key]: value }));

  // اليوم المختار بيكون لسه ما اتسجلش فيه — النافع للسراجي هو آخر يوم مسجّل قبله
  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    const projectId = projectFilter ? Number(projectFilter) : undefined;
    const sectorId = sectorFilter ? Number(sectorFilter) : undefined;
    try {
      const [probe, today] = await Promise.all([
        listDailyLogs({ dateTo: dayBefore(date), projectId, sectorId, pageSize: 1 }),
        listAllDailyLogs({ dateFrom: date, dateTo: date, projectId, sectorId }),
      ]);
      setRecordedToday(new Set(today.data.map((r) => r.equipmentId)));
      const prevDay = probe.data[0]?.date.slice(0, 10) ?? null;
      setRecordsDate(prevDay);
      if (!prevDay) {
        setRecords([]);
        return;
      }
      const res = await listAllDailyLogs({ dateFrom: prevDay, dateTo: prevDay, projectId, sectorId });
      setRecords(res.data);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setRecordsLoading(false);
    }
  }, [date, projectFilter, sectorFilter]);

  useEffect(() => {
    const pid = projectFilter ? Number(projectFilter) : undefined;
    listSectors(pid)
      .then((s) => {
        setSectors(s);
        if (sectorFilter && !s.some((x) => String(x.id) === sectorFilter)) {
          setSectorFilter("");
        }
      })
      .catch(() => setSectors([]));
  }, [projectFilter]);

  // Re-resolve project context once Projects finish loading.
  useEffect(() => {
    if (!form.equipmentId || form.projectName) return;
    if (!form.projectId) return;
    const resolved = projects.find((p) => p.id === form.projectId);
    if (resolved) {
      setForm((f) => ({
        ...f,
        projectCode: f.projectCode ?? resolved.code ?? null,
        projectName: resolved.name,
      }));
    }
  }, [projects]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  /** معدات اليوم اللي قبله اللي لسه ما اتسجلتش النهارده — دي اللي بتفضل في الجدول وبيعملها التنبيه */
  const pending = useMemo(
    () => records.filter((r) => !recordedToday.has(r.equipmentId)),
    [records, recordedToday]
  );

  const prevDayLabel = recordsDate ? formatDate(recordsDate) : "—";

  useEffect(() => {
    projectOptions()
      .then(setProjects)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const edit = (location.state as { edit?: DailyLog } | null)?.edit;
    if (edit) {
      editRecord(edit);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!form.equipmentId || !trackingModeAppliesHours(form.trackingMode)) {
      setBaseline(null);
      setBaselineLoading(false);
      return;
    }
    setBaselineLoading(true);
    getLastMeter(form.equipmentId, date)
      .then((b) => {
        if (cancelled) return;
        setBaseline(b);
        if (!form.id) {
          setForm((f) =>
            f.equipmentId === form.equipmentId
              ? { ...f, endMeter: b ? String(b.meter) : "" }
              : f
          );
        }
      })
      .catch(() => {
        if (!cancelled) setBaseline(null);
      })
      .finally(() => {
        if (!cancelled) setBaselineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.equipmentId, form.trackingMode, date, form.id]);

  useEffect(() => {
    productivityTypes()
      .then(setTypeOptions)
      .catch(() => {});
  }, []);

  /** الصلاحية من آخر سجل سابق لنفس المعدة — تُملأ تلقائيًا عند إنشاء سجل جديد */
  useEffect(() => {
    if (!form.equipmentId) {
      setLastCondition(null);
      return;
    }
    let cancelled = false;
    listDailyLogs({ equipmentId: form.equipmentId, dateTo: dayBefore(date), pageSize: 1 })
      .then((res) => {
        if (cancelled) return;
        const last = res.data[0];
        setLastCondition(last?.condition ? { value: last.condition, date: last.date.slice(0, 10) } : null);
        if (!form.id) {
          setForm((f) =>
            f.equipmentId === form.equipmentId ? { ...f, condition: last?.condition ?? "" } : f
          );
        }
      })
      .catch(() => {
        if (!cancelled) setLastCondition(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.equipmentId, form.id, date]);

  useEffect(() => {
    const code = form.code.trim();
    if (!form.id && form.equipmentId === null && code.length >= 2) {
      setLookupLoading(true);
      const timer = setTimeout(async () => {
        try {
          const results = await lookupEquipment(code);
          setSuggestions(results);
          setShowSuggestions(true);
          setShowCreate(results.length === 0);
        } catch {
          setSuggestions([]);
        } finally {
          setLookupLoading(false);
        }
      }, 350);
      return () => clearTimeout(timer);
    }
    setSuggestions([]);
    setShowSuggestions(false);
    if (!form.id) setShowCreate(false);
    return;
  }, [form.code, form.equipmentId, form.id]);

  const selectEquipment = (eq: Equipment) => {
    const resolvedProject =
      eq.project ?? projects.find((p) => p.id === (eq.projectId ?? eq.project?.id ?? null)) ?? null;
    setForm((f) => ({
      ...f,
      equipmentId: eq.id,
      code: eq.code,
      equipmentName: eq.name,
      projectId: eq.projectId ?? resolvedProject?.id ?? null,
      projectCode: eq.project?.code ?? resolvedProject?.code ?? null,
      sectorId: eq.sectorId ?? eq.sector?.id ?? null,
      attestation: eq.attestation ?? f.attestation ?? null,
      projectName: eq.project?.name || resolvedProject?.name || "",
      sectorName: eq.sector?.name || "",
      trackingMode: eq.trackingMode,
    }));
    setSuggestions([]);
    setShowSuggestions(false);
    setShowCreate(false);
    setFieldErrors({});
  };

  const resetForm = () => {
    setForm(emptyForm);
    setFieldErrors({});
    setShowCreate(false);
    setSuggestions([]);
  };

  const onHoursChange = (value: string) => {
    setForm((f) => {
      const next = { ...f, operatingHours: value };
      if (baseline) {
        if (value.trim() === "") {
          next.endMeter = String(baseline.meter);
        } else {
          const h = Number(value);
          if (!Number.isNaN(h)) next.endMeter = String(baseline.meter + h);
        }
      }
      return next;
    });
  };

  const onEndMeterChange = (value: string) => {
    setForm((f) => {
      const next = { ...f, endMeter: value };
      if (baseline && value.trim() !== "") {
        const m = Number(value);
        if (!Number.isNaN(m)) next.operatingHours = String(m - baseline.meter);
      }
      return next;
    });
  };

  const meterNum =
    form.endMeter.trim() === "" || Number.isNaN(Number(form.endMeter))
      ? null
      : Number(form.endMeter);
  const isNegative =
    trackingModeAppliesHours(form.trackingMode) &&
    baseline != null &&
    meterNum != null &&
    meterNum < baseline.meter;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.equipmentId) {
      toast.error("اختر المعدة من القائمة التي تظهر بكتابة الكود");
      return;
    }
    if (isNegative) {
      toast.error("⚠️ ساعات العمل بالسالب — العداد أقل من آخر قراءة مسجلة، لا يمكن الحفظ");
      return;
    }
    setSaving(true);
    setFieldErrors({});
    const hoursApplicable = trackingModeAppliesHours(form.trackingMode);
    try {
      const res = await saveDailyLog({
        ...(form.id ? { id: form.id } : {}),
        date,
        equipmentId: form.equipmentId,
        endMeter: hoursApplicable ? toNumberOrNull(form.endMeter) : null,
        operatingHours: hoursApplicable ? toNumberOrNull(form.operatingHours) : null,
        diesel: toNumberOrNull(form.diesel),
        productivityType: form.productivityType || null,
        productivityCount: toNumberOrNull(form.productivityCount),
        condition: form.condition || null,
        notes: form.notes || null,
        clientRequestId: crypto.randomUUID(),
        context: {
          projectId: form.projectId,
          projectCode: form.projectCode,
          sectorId: form.sectorId,
          projectName: form.projectName || null,
          sectorName: form.sectorName || null,
          equipmentCode: form.code,
          equipmentName: form.equipmentName,
          contextSource: (form.projectId != null || form.sectorId != null ? "SNAPSHOT" : "UNKNOWN") as "SNAPSHOT" | "UNKNOWN",
          capturedAt: new Date().toISOString(),
          attestation: form.attestation,
        },
      });
      if (isQueued(res)) {
        toast("تم حفظ اليومية على الجهاز — ستُرسل للسيرفر تلقائيًا عند عودة الاتصال", { icon: "📴" });
        resetForm();
        return;
      }
      if ("pendingReview" in res && res.pendingReview) {
        toast("تم إرسال السجل للمراجعة — بانتظار اعتماد ROOT/ADMIN", { icon: "⏳" });
        resetForm();
        loadRecords();
        return;
      }
      toast.success(
        (res as { updated?: boolean }).updated
          ? "تم تحديث السجل الموجود بنفس التاريخ والمعدة"
          : "تم حفظ السجل في قاعدة البيانات"
      );
      resetForm();
      loadRecords();
    } catch (err) {
      setFieldErrors(getApiFieldErrors(err));
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const editRecord = (rec: DailyLog) => {
    setDate(rec.date.slice(0, 10));
    setForm({
      id: rec.id,
      equipmentId: rec.equipmentId,
      code: rec.equipment.code,
      equipmentName: rec.equipment.name,
      projectId: rec.equipment.project?.id ?? null,
      projectCode: rec.equipment.project?.code ?? null,
      sectorId: rec.equipment.sector?.id ?? null,
      projectName: rec.equipment.project?.name || "",
      sectorName: rec.equipment.sector?.name || "",
      attestation: null,
      trackingMode: rec.equipment.trackingMode,
      endMeter: rec.endMeter != null ? String(rec.endMeter) : "",
      operatingHours: rec.operatingHours != null ? String(rec.operatingHours) : "",
      diesel: rec.diesel != null ? String(rec.diesel) : "",
      productivityType: rec.productivityType || "",
      productivityCount: rec.productivityCount != null ? String(rec.productivityCount) : "",
      condition: rec.condition || "",
      notes: rec.notes || "",
    });
    setFieldErrors({});
    setShowSuggestions(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** نسخ بيانات معدة من اليوم اللي قبله في فورم اليوم الجديد — بدون id عشان الحفظ يسجّل جديد مش يعدّل */
  const copyRecordToNewDay = (rec: DailyLog) => {
    setForm({
      id: null,
      equipmentId: rec.equipmentId,
      code: rec.equipment.code,
      equipmentName: rec.equipment.name,
      projectId: rec.equipment.project?.id ?? null,
      projectCode: rec.equipment.project?.code ?? null,
      sectorId: rec.equipment.sector?.id ?? null,
      projectName: rec.equipment.project?.name || "",
      sectorName: rec.equipment.sector?.name || "",
      attestation: null,
      trackingMode: rec.equipment.trackingMode,
      endMeter: rec.endMeter != null ? String(rec.endMeter) : "",
      operatingHours: rec.operatingHours != null ? String(rec.operatingHours) : "",
      diesel: rec.diesel != null ? String(rec.diesel) : "",
      productivityType: rec.productivityType || "",
      productivityCount: rec.productivityCount != null ? String(rec.productivityCount) : "",
      condition: rec.condition || "",
      notes: rec.notes || "",
    });
    setFieldErrors({});
    setShowSuggestions(false);
    toast(`تم نسخ بيانات ${rec.equipment.code} — عدّل القراءة الجديدة واحفظها لليوم ${formatDate(date)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCreateEquipment = async () => {
    if (!newEqName.trim()) {
      toast.error("اكتب اسم المعدة");
      return;
    }
    setCreatingEq(true);
    try {
      const eq = await createEquipment({
        code: form.code.trim(),
        name: newEqName.trim(),
        projectId: newEqProject ? Number(newEqProject) : null,
      });
      selectEquipment(eq);
      setNewEqName("");
      setNewEqProject("");
      toast.success("تم تسجيل المعدة الجديدة");
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setCreatingEq(false);
    }
  };

  const err = (key: string) => fieldErrors[key]?.[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">السراكي اليومية — DAY</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            تسجيل ساعات التشغيل والعدادات والديزل والإنتاجية لكل معدة
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-white border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2">
            <label className="text-[13px] font-semibold text-slate-600" htmlFor="day-project-filter">
              المشروع
            </label>
            <select
              id="day-project-filter"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="text-sm outline-none bg-transparent max-w-[170px]"
            >
              <option value="">كل المشاريع</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="bg-white border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2">
            <label className="text-[13px] font-semibold text-slate-600" htmlFor="day-sector-filter">
              القطاع
            </label>
            <select
              id="day-sector-filter"
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="text-sm outline-none bg-transparent max-w-[170px]"
            >
              <option value="">كل القطاعات</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="bg-white border border-slate-300 rounded-lg px-3 py-2 flex items-center gap-2">
            <label className="text-[13px] font-semibold text-slate-600">التاريخ</label>
            <input
              type="date"
              value={date}
              max={todayLocal()}
              onChange={(e) => {
                setDate(e.target.value);
                resetForm();
              }}
              dir="ltr"
              className="text-sm outline-none"
            />
          </div>
          <button
            onClick={resetForm}
            className="flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors"
          >
            <FilePlus2 size={15} />
            سجل جديد
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <form onSubmit={handleSave} className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <label className={labelCls}>
                كود المعدة <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  value={form.code}
                  onChange={(e) => setField("code", e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  dir="ltr"
                  placeholder="اكتب الكود أو اسم المعدة..."
                  className={cn(inputCls, "pr-9", err("equipmentId") && "border-red-400")}
                />
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                {lookupLoading && (
                  <Loader2
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-primary-600"
                    style={{ left: "auto", right: "0.6rem" }}
                  />
                )}
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-auto">
                  {suggestions.map((eq) => (
                    <button
                      type="button"
                      key={eq.id}
                      onClick={() => selectEquipment(eq)}
                      className="w-full text-right px-3 py-2.5 hover:bg-primary-50 border-b border-slate-100 last:border-0 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800 text-sm">{eq.name}</span>
                        <span dir="ltr" className="font-mono text-xs text-primary-700 bg-primary-50 rounded px-1.5 py-0.5">
                          {eq.code}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {eq.project?.name || "بدون مشروع"}
                        {eq.sector ? ` — ${eq.sector.name}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {showCreate && !form.equipmentId && form.code.trim().length >= 2 && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                  <div className="text-[13px] font-semibold text-amber-800">
                    المعدة غير مسجلة — تسجيلها الآن؟
                  </div>
                  <input
                    value={newEqName}
                    onChange={(e) => setNewEqName(e.target.value)}
                    placeholder="اسم المعدة"
                    className={inputCls}
                  />
                  <select
                    value={newEqProject}
                    onChange={(e) => setNewEqProject(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">بدون مشروع (يُحدد لاحقًا)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleCreateEquipment}
                    disabled={creatingEq}
                    className="w-full flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg py-2"
                  >
                    {creatingEq ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    تسجيل المعدة
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>اسم المعدة</label>
              <input
                value={form.equipmentName}
                readOnly
                placeholder="يُملأ تلقائيًا من الكود"
                className={cn(inputCls, "bg-slate-50 text-slate-600")}
              />
              {form.equipmentId && (
                <p className="text-[11px] text-slate-500 mt-1">
                  وضع التتبع: <b>{TRACKING_MODE_LABELS[form.trackingMode]}</b>
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>المشروع</label>
              <input
                value={form.projectName}
                readOnly
                placeholder="يُملأ تلقائيًا"
                className={cn(inputCls, "bg-slate-50 text-slate-600")}
              />
            </div>

            <div>
              <label className={labelCls}>القطاع</label>
              <input
                value={form.sectorName}
                readOnly
                placeholder="يُملأ تلقائيًا"
                className={cn(inputCls, "bg-slate-50 text-slate-600")}
              />
            </div>

            <div>
              <label className={labelCls}>الصلاحية</label>
              <select
                value={form.condition}
                onChange={(e) =>
                  setField("condition", e.target.value as FormState["condition"])
                }
                className={inputCls}
              >
                <option value="">— اختر —</option>
                <option value="GOOD">صالح</option>
                <option value="BROKEN">عاطل</option>
                <option value="STOPPED">متوقف</option>
              </select>
              {!form.id && lastCondition && (
                <p className="text-[11px] text-slate-500 mt-1">
                  مُلءة تلقائيًا من آخر سجل بتاريخ{" "}
                  <bdi dir="ltr" className="font-mono">{lastCondition.date}</bdi>
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {trackingModeAppliesHours(form.trackingMode) ? (
              <>
                <div>
                  <label className={labelCls}>نهاية العداد</label>
                  <input
                    type="number"
                    step="any"
                    dir="ltr"
                    value={form.endMeter}
                    onChange={(e) => onEndMeterChange(e.target.value)}
                    placeholder="0"
                    className={cn(
                      inputCls,
                      (err("endMeter") || isNegative) && "border-red-400 focus:ring-red-400 focus:border-red-400"
                    )}
                  />
                  {err("endMeter") && <p className="text-xs text-red-600 mt-1">{err("endMeter")}</p>}
                  {!err("endMeter") && baseline && (
                    <p className="text-xs text-slate-500 mt-1">
                      {baselineLoading ? (
                        "جاري جلب العداد السابق..."
                      ) : (
                        <>
                          العداد السابق: <bdi className="font-semibold">{baseline.meter}</bdi> بتاريخ{" "}
                          <bdi dir="ltr" className="font-mono">{baseline.date}</bdi>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>ساعات التشغيل</label>
                  <input
                    type="number"
                    step="any"
                    dir="ltr"
                    value={form.operatingHours}
                    onChange={(e) => onHoursChange(e.target.value)}
                    placeholder="0"
                    className={cn(
                      inputCls,
                      (err("operatingHours") || isNegative) && "border-red-400 focus:ring-red-400 focus:border-red-400"
                    )}
                  />
                  {err("operatingHours") && (
                    <p className="text-xs text-red-600 mt-1">{err("operatingHours")}</p>
                  )}
                </div>
              </>
            ) : (
              <div className="md:col-span-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px] text-sky-800">
                هذه المعدة تتبع الكيلومترات فقط — لا تُدخل عدادات الساعات هنا. قراءات الكيلومترات
                تُسجَّل من أوامر الصيانة.
              </div>
            )}
            <div>
              <label className={labelCls}>الديزل (لتر)</label>
              <input
                type="number"
                step="any"
                dir="ltr"
                value={form.diesel}
                onChange={(e) => setField("diesel", e.target.value)}
                placeholder="0"
                className={cn(inputCls, err("diesel") && "border-red-400")}
              />
              {err("diesel") && <p className="text-xs text-red-600 mt-1">{err("diesel")}</p>}
            </div>
          </div>

          {isNegative && (
            <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-2.5 flex items-start gap-2">
              <span className="text-red-600 text-sm font-bold shrink-0">⚠️ تنبيه</span>
              <span className="text-red-700 text-[13px]">
                العداد المُدخل <bdi className="font-mono">{meterNum}</bdi> أقل من آخر قراءة مسجلة{" "}
                <bdi className="font-mono">{baseline?.meter}</bdi> — ساعات العمل بالسالب (
                <bdi className="font-mono">{form.operatingHours}</bdi>) ولا يمكن الحفظ.
                {baseline && (
                  <>
                    {" "}أدخل عدادًا لا يقل عن{" "}
                    <bdi className="font-mono font-bold">{baseline.meter}</bdi>
                  </>
                )}
              </span>
            </div>
          )}

          {!isNegative && form.equipmentId && !baseline && !baselineLoading && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-[13px] text-slate-500">
              لا يوجد عداد سابق مسجل لهذه المعدة قبل هذا التاريخ — أدخل العداد يدويًا.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>نوع الإنتاجية</label>
              <input
                value={form.productivityType}
                onChange={(e) => setField("productivityType", e.target.value)}
                list="productivity-type-options"
                placeholder="مثال: رحلات / م3 / طن أسفلت"
                className={cn(inputCls, err("productivityType") && "border-red-400")}
              />
              <datalist id="productivity-type-options">
                {typeOptions.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {err("productivityType") && <p className="text-xs text-red-600 mt-1">{err("productivityType")}</p>}
            </div>
            <div>
              <label className={labelCls}>عدد الإنتاجية</label>
              <input
                type="number"
                step="any"
                dir="ltr"
                value={form.productivityCount}
                onChange={(e) => setField("productivityCount", e.target.value)}
                placeholder="0"
                className={cn(inputCls, err("productivityCount") && "border-red-400")}
              />
              {err("productivityCount") && <p className="text-xs text-red-600 mt-1">{err("productivityCount")}</p>}
            </div>
            <div>
              <label className={labelCls}>ملاحظات</label>
              <input
                value={form.notes}
                onChange={(e) => setField("notes", e.target.value)}
                placeholder="أي ملاحظات..."
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition-colors"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {form.id ? "تحديث السجل" : "حفظ في قاعدة البيانات"}
            </button>
            {form.id && (
              <span className="text-xs text-slate-500">
                تعديل السجل رقم <bdi className="font-mono">#{form.id}</bdi>
              </span>
            )}
          </div>
        </form>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-700">بيانات معدات اليوم اللي قبله</h2>
            <span className="text-xs text-slate-400">
              {recordsDate ? formatDate(recordsDate) : "—"}
            </span>
          </div>

          {!recordsLoading && pending.length > 0 && (
            <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <span>
                <b>{pending.length}</b> معدة لم تُسجَّل في{" "}
                <b>{formatDate(date)}</b> — آخر قراءة لها مسجلة في {prevDayLabel}:{" "}
                <span dir="ltr" className="font-mono">
                  {pending
                    .slice(0, 8)
                    .map((r) => r.equipment.code)
                    .join("، ")}
                  {pending.length > 8 ? " …" : ""}
                </span>
              </span>
            </div>
          )}

          {!recordsLoading && records.length > 0 && pending.length === 0 && (
            <div className="mx-4 mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-[13px] font-semibold text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0" />
              كل معدات {prevDayLabel} تم تسجيلها في {formatDate(date)}
            </div>
          )}

          <div className="max-h-[540px] overflow-y-auto">
            {recordsLoading ? (
              <div className="p-6 text-center text-slate-400 text-sm">جاري التحميل...</div>
            ) : records.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm">
                لا توجد سجلات مسجلة قبل هذا التاريخ
              </div>
            ) : pending.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm">
                لا توجد معدات متبقّية — كل ما تسجّل بالأمس اتسجّل النهارده
              </div>
            ) : (
              pending.map((rec) => (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => copyRecordToNewDay(rec)}
                  className="w-full text-right px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-primary-50 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate flex items-center gap-2">
                        <span className="truncate">{rec.equipment.name}</span>
                        {rec.condition && (
                          <span
                            title={rec.conditionNote || undefined}
                            className={cn(
                              "shrink-0 text-[11px] font-bold rounded-full px-2 py-0.5",
                              rec.condition === "GOOD" && "bg-emerald-100 text-emerald-700",
                              rec.condition === "BROKEN" && "bg-red-100 text-red-700",
                              rec.condition === "STOPPED" && "bg-amber-100 text-amber-700"
                            )}
                          >
                            {CONDITION_LABELS[rec.condition]}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span dir="ltr" className="font-mono text-primary-700">
                          {rec.equipment.code}
                        </span>
                        <span>
                          ساعات: {rec.operatingHours ?? "—"} | ديزل: {rec.diesel ?? "—"}
                        </span>
                        {rec.conditionNote && (
                          <span className="text-slate-400 truncate max-w-[180px]" title={rec.conditionNote}>
                            {rec.conditionNote}
                          </span>
                        )}
                      </div>
                    </div>
                    <Copy
                      size={14}
                      className="text-slate-300 group-hover:text-primary-600 shrink-0"
                    />
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 rounded-b-xl">
            {recordsLoading ? (
              "جاري الحساب..."
            ) : (
              <>
                مسجّل اليوم <b className="text-emerald-700">{records.length - pending.length}</b> — متبقّي{" "}
                <b className="text-amber-700">{pending.length}</b> من {records.length} — اضغط على أي معدة لنسخ
                بياناتها إلى اليوم الحالي وتسجيلها من جديد
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
