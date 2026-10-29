import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Save,
  Loader2,
  Plus,
  FilePlus2,
  Pencil,
  Trash2,
  Wrench,
  FolderKanban,
  AlertTriangle,
} from "lucide-react";
import {
  cn,
  todayLocal,
  formatDate,
  MAINT_STATUS_LABELS as STATUS_LABELS,
  MAINT_STATUS_CLS as STATUS_CLS,
  ORDER_TYPES,
  MAINT_TYPES,
  WORKSHOPS,
  isEngineOilPart,
  isOilFilterPart,
  isPeriodicMaintenance,
  TRACKING_MODE_LABELS,
  trackingModeAppliesHours,
  trackingModeAppliesKm,
} from "@/lib/utils";
import { getApiError, getApiFieldErrors } from "@/lib/api";
import { lookupEquipment } from "@/services/equipments";
import { isQueued } from "@/lib/offline/queue";
import { listDailyLogs } from "@/services/dailylogs";
import {
  createMaintenance,
  updateMaintenance,
  deleteMaintenance,
  listMaintenance,
} from "@/services/maintenance";
import {
  listPartSchedules,
  createPartSchedule,
  updatePartSchedule,
  deletePartSchedule,
  getPartAlerts,
  type EquipmentAlert,
} from "@/services/partSchedules";
import { projectOptions } from "@/services/projects";
import type { Maintenance, Project, TrackingMode } from "@/types";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";
const textareaCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 min-h-[70px] resize-y";

const PART_NAMES = ["زيت محرك", "زيت هيدروليك", "زيت فتيس", "فلتر زيت", "فلتر محرك", "فلتر جاز", "فلتر فاصل"];
const SCHED_UNITS = ["ساعة", "كم", "يوم", "شهر"];
const SCHED_DEFAULTS = new Set(["150", "300", "10000"]);

function defaultSchedInterval(partName: string, unit: string): string | null {
  if (isEngineOilPart(partName)) return unit === "كم" ? "10000" : "150";
  if (isOilFilterPart(partName)) return "300";
  return null;
}

const MAINT_TEMPLATES: Record<string, { description: string; action: string }> = {
  "صيانة دورية": {
    description:
      "إجراء الفحص الدوري المجدول للمعدة بناءً على ساعات التشغيل الحالية المسجلة بالعداد، لضمان كفاءة الأداء وتفادي الأعطال المفاجئة.",
    action:
      "تم عمل الصيانة الوقائية بالكامل وإجراء اللازم (شاملاً الفحص، التنظيف، والتشحيم) لضمان جاهزية المعدة للعمل بكفاءة و تغير قطع الغيار المطلوبة.",
  },
  "صيانة طارئة": {
    description:
      "حدوث عطل مفاجئ(.......... ) أدى إلى توقف المعدة عن العمل أو تراجع كفاءتها بشكل حاد، مما تطلب تدخلاً فورياً لإصلاح العطل .",
    action:
      "فحص المعدة لتشخيص السبب الرئيسي للعطل وتحديد الأجزاء التالفة.\nاستبدال القطع المتضررة وعمل الإصلاحات اللازمة فوراً لضمان عودة المعدة للخدمة بأسرع وقت.تم عمل الصيانة اللازمة و تغير قطع الغيار المطلوبة.",
  },
  "رفع كفاءة": {
    description:
      "تراجع الأداء العام للمعدة نتيجة استهلاك قطع الغيار وتقادمها بعد تخطيها ساعات تشغيل طويلة، مما تطلب تدخلاً شاملاً لاستعادة كفاءتها التشغيلية القياسية (عمرة جزئية أو شاملة).",
    action:
      "فحص واختبار جميع المكونات الحيوية (الميكانيكية والكهربائية) وتحديد الأجزاء المستهلكة.\nاستبدال الأجزاء الرئيسية التالفة بقطع غيار جديدة، وإعادة ضبط ومعايرة الأنظمة الداخلية.\nتشغيل المعدة واختبارها تحت الحمل للتأكد من استعادة كفاءتها الكاملة، وتصفير أو جدولة العداد للصيانة الرئيسية القادمة.",
  },
};

const TEMPLATE_TEXTS = new Set(
  Object.values(MAINT_TEMPLATES).flatMap((t) => [t.description, t.action])
);

const isUntouched = (v: string) => v.trim() === "" || TEMPLATE_TEXTS.has(v.trim());

interface PartForm {
  name: string;
  code: string;
  qty: string;
  notes: string;
}

interface SchedRow {
  id: number;
  partName: string;
  interval: string;
  unit: string;
}

interface FormState {
  id: number | null;
  workOrderNo: string;
  equipmentId: number | null;
  code: string;
  equipmentName: string;
  projectName: string;
  sectorName: string;
  trackingMode: TrackingMode;
  orderType: string;
  maintenanceType: string;
  workshop: string;
  endDate: string;
  meterReading: string;
  kmMeter: string;
  status: string;
  description: string;
  action: string;
  notes: string;
  parts: PartForm[];
}

const emptyForm: FormState = {
  id: null,
  workOrderNo: "",
  equipmentId: null,
  code: "",
  equipmentName: "",
  projectName: "",
  sectorName: "",
  trackingMode: "BOTH",
  orderType: "",
  maintenanceType: MAINT_TYPES[0],
  workshop: WORKSHOPS[0],
  endDate: "",
  meterReading: "",
  kmMeter: "",
  status: "DONE",
  description: MAINT_TEMPLATES[MAINT_TYPES[0]].description,
  action: MAINT_TEMPLATES[MAINT_TYPES[0]].action,
  notes: "",
  parts: [],
};

const emptyPart: PartForm = { name: "", code: "", qty: "", notes: "" };

export default function WorkPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayLocal());
  const [form, setForm] = useState<FormState>(emptyForm);
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof lookupEquipment>>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [records, setRecords] = useState<Maintenance[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [schedRows, setSchedRows] = useState<SchedRow[]>([]);
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedSavingId, setSchedSavingId] = useState<number | null>(null);
  const [meterLoading, setMeterLoading] = useState(false);
  const [equipAlert, setEquipAlert] = useState<EquipmentAlert | null>(null);
  const [projects, setProjects] = useState<Pick<Project, "id" | "name">[]>([]);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    projectOptions()
      .then(setProjects)
      .catch(() => {});
  }, []);

  const reloadSchedules = useCallback(async (equipmentId: number) => {
    setSchedLoading(true);
    try {
      const list = await listPartSchedules(equipmentId);
      setSchedRows(
        list.map((s) => ({
          id: s.id,
          partName: s.partName,
          interval: String(s.interval),
          unit: s.unit,
        }))
      );
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSchedLoading(false);
    }
  }, []);

  useEffect(() => {
    const eqId = form.equipmentId;
    if (!eqId) {
      setSchedRows([]);
      return;
    }
    reloadSchedules(eqId);
  }, [form.equipmentId, reloadSchedules]);

  useEffect(() => {
    const eqId = form.equipmentId;
    if (!eqId) {
      setEquipAlert(null);
      return;
    }
    let cancelled = false;
    getPartAlerts({ q: form.code })
      .then((res) => {
        if (!cancelled) {
          setEquipAlert(res.rows.find((r) => r.equipmentId === eqId) ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setEquipAlert(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.equipmentId]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await listMaintenance({
        date,
        pageSize: 100,
        ...(projectFilter ? { projectId: Number(projectFilter) } : {}),
      });
      setRecords(res.data);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setRecordsLoading(false);
    }
  }, [date, projectFilter]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    const edit = (location.state as { edit?: Maintenance } | null)?.edit;
    if (edit) {
      editRecord(edit);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const eqId = form.equipmentId;
    if (!eqId || form.id) return;
    let cancelled = false;
    setMeterLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await listDailyLogs({ equipmentId: eqId, dateTo: date, pageSize: 1 });
        if (cancelled) return;
        const log = res.data[0];
        setForm((f) =>
          f.equipmentId === eqId && !f.id
            ? { ...f, meterReading: log?.endMeter != null ? String(log.endMeter) : "" }
            : f
        );
      } catch {
        // لا توجد يومية — يبقى الحقل يدويًا
      } finally {
        if (!cancelled) setMeterLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      setMeterLoading(false);
      clearTimeout(timer);
    };
  }, [form.equipmentId, form.id, date]);

  useEffect(() => {
    const code = form.code.trim();
    if (code.length < 2 || code === form.equipmentName) {
      setSuggestions([]);
      return;
    }
    setLookupLoading(true);
    const timer = setTimeout(async () => {
      try {
        const list = await lookupEquipment(code);
        setSuggestions(list.slice(0, 6));
        setShowSuggestions(list.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLookupLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.code]);

  const selectEquipment = (eq: (typeof suggestions)[number]) => {
    setForm((f) => ({
      ...f,
      equipmentId: eq.id,
      code: eq.code,
      equipmentName: eq.name,
      projectName: eq.project?.name || "",
      sectorName: eq.sector?.name || "",
      trackingMode: eq.trackingMode,
      meterReading: trackingModeAppliesHours(eq.trackingMode) ? f.meterReading : "",
      kmMeter: trackingModeAppliesKm(eq.trackingMode) ? f.kmMeter : "",
    }));
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const changeMaintType = (value: string) =>
    setForm((f) => {
      const tpl = MAINT_TEMPLATES[value];
      if (!tpl) return { ...f, maintenanceType: value };
      return {
        ...f,
        maintenanceType: value,
        description: isUntouched(f.description) ? tpl.description : f.description,
        action: isUntouched(f.action) ? tpl.action : f.action,
      };
    });

  const resetForm = () => {
    setForm(emptyForm);
    setFieldErrors({});
    setShowSuggestions(false);
  };

  const addPart = () => setForm((f) => ({ ...f, parts: [...f.parts, { ...emptyPart }] }));

  const addOilFilterParts = () =>
    setForm((f) => {
      const parts = [...f.parts];
      if (!parts.some((p) => isEngineOilPart(p.name))) {
        parts.push({ ...emptyPart, name: "زيت محرك" });
      }
      if (!parts.some((p) => isOilFilterPart(p.name))) {
        parts.push({ ...emptyPart, name: "فلتر زيت" });
      }
      return { ...f, parts };
    });

  const removePart = (i: number) =>
    setForm((f) => ({ ...f, parts: f.parts.filter((_, idx) => idx !== i) }));
  const updatePart = (i: number, key: keyof PartForm, value: string) =>
    setForm((f) => ({
      ...f,
      parts: f.parts.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)),
    }));

  const addSchedRow = () => {
    if (!form.equipmentId) return;
    setSchedRows((rows) => [
      { id: -Date.now(), partName: "", interval: "", unit: "ساعة" },
      ...rows,
    ]);
  };

  const updateSchedRow = (id: number, key: keyof SchedRow, value: string) =>
    setSchedRows((rows) => rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));

  const saveSchedRow = async (row: SchedRow) => {
    if (!form.equipmentId) return;
    const name = row.partName.trim();
    if (!name) {
      toast.error("اكتب اسم الصنف");
      return;
    }
    const interval = Number(row.interval);
    if (!Number.isFinite(interval) || interval <= 0) {
      toast.error("اكتب فترة أكبر من صفر");
      return;
    }
    const payload = {
      equipmentId: form.equipmentId,
      partName: name,
      interval,
      unit: SCHED_UNITS.includes(row.unit) ? row.unit : "ساعة",
    };
    setSchedSavingId(row.id);
    try {
      if (row.id > 0) {
        await updatePartSchedule(row.id, payload);
        toast.success("تم تحديث موعد التغيير");
      } else {
        await createPartSchedule(payload);
        toast.success("تمت إضافة موعد التغيير");
      }
      await reloadSchedules(form.equipmentId);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSchedSavingId(null);
    }
  };

  const deleteSchedRow = async (row: SchedRow) => {
    if (row.id <= 0) {
      setSchedRows((rows) => rows.filter((r) => r.id !== row.id));
      return;
    }
    if (!window.confirm(`حذف موعد تغيير «${row.partName}»؟`)) return;
    try {
      await deletePartSchedule(row.id);
      toast.success("تم حذف موعد التغيير");
      if (form.equipmentId) await reloadSchedules(form.equipmentId);
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const editRecord = (rec: Maintenance) => {
    setDate(rec.date.slice(0, 10));
    setForm({
      id: rec.id,
      workOrderNo: rec.workOrderNo != null ? String(rec.workOrderNo) : "",
      equipmentId: rec.equipmentId,
      code: rec.equipment.code,
      equipmentName: rec.equipment.name,
      projectName: rec.equipment.project?.name || "",
      sectorName: rec.equipment.sector?.name || "",
      trackingMode: rec.equipment.trackingMode,
      orderType: rec.orderType || "",
      maintenanceType: rec.maintenanceType || "",
      workshop: rec.workshop || "",
      endDate: rec.endDate ? rec.endDate.slice(0, 10) : "",
      meterReading:
        trackingModeAppliesHours(rec.equipment.trackingMode) && rec.meterReading != null
          ? String(rec.meterReading)
          : "",
      kmMeter:
        trackingModeAppliesKm(rec.equipment.trackingMode) && rec.kmMeter != null
          ? String(rec.kmMeter)
          : "",
      status: rec.status,
      description: rec.description || "",
      action: rec.action || "",
      notes: rec.notes || "",
      parts: (rec.workParts || []).map((p) => ({
        name: p.name,
        code: p.code || "",
        qty: p.qty != null ? String(p.qty) : "",
        notes: p.notes || "",
      })),
    });
    setFieldErrors({});
    setShowSuggestions(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.equipmentId) {
      toast.error("اختر المعدة من القائمة التي تظهر بكتابة الكود");
      return;
    }
    setSaving(true);
    setFieldErrors({});
    try {
      const payload = {
        date,
        endDate: form.endDate || null,
        equipmentId: form.equipmentId,
        workType: (form.maintenanceType || "").includes("طارئ") ? "REPAIR" as const : "MAINTENANCE" as const,
        orderType: form.orderType || null,
        maintenanceType: form.maintenanceType || null,
        workshop: form.workshop || null,
        description: form.description || null,
        action: form.action || null,
        meterReading: trackingModeAppliesHours(form.trackingMode)
          ? numOrNull(form.meterReading)
          : null,
        kmMeter: trackingModeAppliesKm(form.trackingMode) ? numOrNull(form.kmMeter) : null,
        status: form.status as "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS",
        notes: form.notes || null,
        parts: form.parts
          .filter((p) => p.name.trim())
          .map((p) => ({
            name: p.name.trim(),
            code: p.code || null,
            qty: numOrNull(p.qty),
            notes: p.notes || null,
          })),
      };

      if (form.id) {
        const rec = await updateMaintenance(form.id, payload);
        if (isQueued(rec)) {
          toast("تم حفظ التعديل على الجهاز — سيُرسل للسيرفر تلقائيًا عند عودة الاتصال", { icon: "📴" });
        } else {
          toast.success("تم تحديث أمر الشغل");
        }
      } else {
        const rec = await createMaintenance(payload);
        if (isQueued(rec)) {
          toast("تم حفظ أمر الشغل على الجهاز — سيُرسل للسيرفر تلقائيًا عند عودة الاتصال", { icon: "📴" });
        } else {
          toast.success(
            rec.workOrderNo != null
              ? `تم حفظ أمر الشغل رقم ${rec.workOrderNo}`
              : "تم حفظ أمر الشغل"
          );
        }
      }
      resetForm();
      loadRecords();
    } catch (err) {
      setFieldErrors(getApiFieldErrors(err));
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!form.id) return;
    if (!window.confirm(`حذف أمر الشغل #${form.workOrderNo || form.id}؟`)) return;
    try {
      await deleteMaintenance(form.id);
      toast.success("تم حذف أمر الشغل");
      resetForm();
      loadRecords();
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const err = (k: string) => fieldErrors[k]?.[0];

  const filterRemainingText = (() => {
    const candidates: { remaining: number; unit: string }[] = [];
    if (trackingModeAppliesHours(form.trackingMode) && equipAlert?.filter.remaining != null) {
      candidates.push({ remaining: equipAlert.filter.remaining, unit: "ساعة" });
    }
    if (trackingModeAppliesKm(form.trackingMode) && equipAlert?.filterKm.remaining != null) {
      candidates.push({ remaining: equipAlert.filterKm.remaining, unit: "كم" });
    }
    if (!candidates.length) return "مستحق";
    const worst = candidates.reduce((a, b) => (a.remaining <= b.remaining ? a : b));
    return worst.remaining < 0
      ? `متأخر ${Math.abs(worst.remaining)} ${worst.unit}`
      : `متبقي ${worst.remaining} ${worst.unit}`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">أعمال الصيانة (WORK)</h1>
          <p className="text-xs text-slate-500 mt-0.5">نموذج أمر الشغل + قطع الغيار</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-1.5">
            <FolderKanban size={14} className="text-slate-400" />
            <label className="text-xs text-slate-500" htmlFor="work-project-filter">
              المشروع
            </label>
            <select
              id="work-project-filter"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="text-xs bg-transparent focus:outline-none max-w-[170px]"
            >
              <option value="">كل المشاريع</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-1.5">
            <Wrench size={14} className="text-slate-400" />
            <span className="text-xs text-slate-500">تاريخ الدخول</span>
            <input
              type="date"
              dir="ltr"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-xs font-mono bg-transparent focus:outline-none"
            />
          </div>
          <button
            onClick={resetForm}
            className="flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors"
          >
            <FilePlus2 size={15} />
            أمر جديد
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <form
          onSubmit={handleSave}
          className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <label className={labelCls}>
                كود المعدة <span className="text-red-500">*</span>
              </label>
              <input
                dir="ltr"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value, equipmentId: null }))}
                onFocus={() => suggestions.length && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="اكتب الكود..."
                className={cn(inputCls, "font-mono", err("equipmentId") && "border-red-400")}
              />
              {lookupLoading && (
                <Loader2
                  size={14}
                  className="absolute left-2.5 top-9 animate-spin text-slate-400"
                />
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
              {err("equipmentId") && (
                <p className="text-xs text-red-600 mt-1">{err("equipmentId")}</p>
              )}
            </div>

            <div>
              <label className={labelCls}>اسم المعدة</label>
              <input
                readOnly
                value={form.equipmentName}
                placeholder="يُملأ تلقائيًا"
                className={cn(inputCls, "bg-slate-50 text-slate-600")}
              />
              {form.equipmentId && (
                <p className="text-[11px] text-slate-500 mt-1">
                  وضع التتبع: <b>{TRACKING_MODE_LABELS[form.trackingMode]}</b>
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>رقم أمر الشغل</label>
              <input
                dir="ltr"
                readOnly
                value={form.workOrderNo}
                placeholder="يُولّد تلقائيًا عند الحفظ"
                className={cn(inputCls, "font-mono bg-slate-50 text-slate-600")}
              />
            </div>

            <div>
              <label className={labelCls}>المشروع</label>
              <input
                readOnly
                value={form.projectName}
                placeholder="يُملأ تلقائيًا"
                className={cn(inputCls, "bg-slate-50 text-slate-600")}
              />
            </div>

            <div>
              <label className={labelCls}>القطاع</label>
              <input
                readOnly
                value={form.sectorName}
                placeholder="يُملأ تلقائيًا"
                className={cn(inputCls, "bg-slate-50 text-slate-600")}
              />
            </div>

            <div>
              <label className={labelCls}>نوع أمر الشغل</label>
              <select
                value={form.orderType}
                onChange={(e) => setField("orderType", e.target.value)}
                className={inputCls}
              >
                <option value="">— اختر —</option>
                {ORDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>تاريخ الدخول</label>
              <input
                type="date"
                dir="ltr"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>تاريخ الخروج</label>
              <input
                type="date"
                dir="ltr"
                value={form.endDate}
                onChange={(e) => setField("endDate", e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>الورشة</label>
              <select
                value={form.workshop}
                onChange={(e) => setField("workshop", e.target.value)}
                className={inputCls}
              >
                <option value="">— اختر —</option>
                {WORKSHOPS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>

            {trackingModeAppliesHours(form.trackingMode) && (
              <div className="relative">
                <label className={labelCls}>العداد النهائي (ساعة)</label>
                <input
                  dir="ltr"
                  type="number"
                  step="any"
                  value={form.meterReading}
                  onChange={(e) => setField("meterReading", e.target.value)}
                  placeholder="جلب تلقائي من اليومية"
                  className={cn(inputCls, "font-mono")}
                />
                {meterLoading && (
                  <Loader2
                    size={14}
                    className="absolute left-2.5 top-9 animate-spin text-slate-400"
                  />
                )}
              </div>
            )}

            {trackingModeAppliesKm(form.trackingMode) && (
              <div>
                <label className={labelCls}>عداد الكيلومترات</label>
                <input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="any"
                  value={form.kmMeter}
                  onChange={(e) => setField("kmMeter", e.target.value)}
                  placeholder="اختياري — يُستخدم لتنبيه 10,000 كم"
                  className={cn(inputCls, "font-mono")}
                />
              </div>
            )}

            <div>
              <label className={labelCls}>نوع الصيانة</label>
              <select
                value={form.maintenanceType}
                onChange={(e) => changeMaintType(e.target.value)}
                className={inputCls}
              >
                <option value="">— اختر —</option>
                {MAINT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                الوصف والإجراء يتولّدان تلقائيًا حسب النوع — ويمكنك تعديلهما
              </p>
            </div>

            <div>
              <label className={labelCls}>الحالة</label>
              <select
                value={form.status}
                onChange={(e) => setField("status", e.target.value)}
                className={inputCls}
              >
                {Object.entries(STATUS_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>وصف الشغل</label>
            <textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="وصف العطل أو أعمال الصيانة..."
              className={textareaCls}
            />
          </div>

          <div>
            <label className={labelCls}>الإجراء المتخذ</label>
            <textarea
              value={form.action}
              onChange={(e) => setField("action", e.target.value)}
              placeholder="الإجراء اللي تم تنفيذه..."
              className={textareaCls}
            />
          </div>

          {form.equipmentId &&
            isPeriodicMaintenance(form.maintenanceType) &&
            equipAlert?.filterDue && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 flex items-start gap-2.5 flex-wrap">
                <AlertTriangle size={18} className="text-orange-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-[220px]">
                  <p className="text-xs font-bold text-orange-800">
                    فلتر الزيت مطلوب أيضًا — {filterRemainingText}
                  </p>
                  <p className="text-[11px] text-orange-700 mt-0.5">
                    يظهر الفلتر هنا حتى لو لم يبلغ الزيت 90% بعد، ويُضاف للصيانة الجارية
                    ليُسجَّل تغييره ويُصفَّر عداده. الفلتر لا يُصفَّر بمجرد العرض أو التنبيه،
                    ويُسجَّل الزيت والفلتر معًا كأمر واحد يحتوي الصنفين.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addOilFilterParts}
                  disabled={form.parts.some((p) => isOilFilterPart(p.name))}
                  className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-orange-600 text-white px-3 py-2 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {form.parts.some((p) => isOilFilterPart(p.name)) ? (
                    "الفلتر مضاف"
                  ) : (
                    <>
                      <Plus size={13} /> إضافة زيت + فلتر
                    </>
                  )}
                </button>
              </div>
            )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[13px] font-semibold text-slate-600">قطع الغيار</label>
              <button
                type="button"
                onClick={addPart}
                className="flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800 bg-primary-50 hover:bg-primary-100 rounded-lg px-2.5 py-1 transition-colors"
              >
                <Plus size={13} />
                إضافة صنف
              </button>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_80px_1fr_36px] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <span>الصنف</span>
                <span>الكود</span>
                <span>الكمية</span>
                <span>ملاحظات</span>
                <span />
              </div>
              <datalist id="part-names">
                {PART_NAMES.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              {form.parts.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-400 text-center">
                  لا توجد قطع غيار — اضغط «إضافة صنف»
                </div>
              ) : (
                form.parts.map((p, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_80px_1fr_36px] gap-2 px-3 py-2 border-b border-slate-100 last:border-0 items-center"
                  >
                    <input
                      list="part-names"
                      value={p.name}
                      onChange={(e) => updatePart(i, "name", e.target.value)}
                      placeholder="مثال: زيت محرك"
                      className={cn(inputCls, "text-xs px-2 py-1.5")}
                    />
                    <input
                      dir="ltr"
                      value={p.code}
                      onChange={(e) => updatePart(i, "code", e.target.value)}
                      placeholder="الكود"
                      className={cn(inputCls, "text-xs px-2 py-1.5 font-mono")}
                    />
                    <input
                      dir="ltr"
                      type="number"
                      step="any"
                      value={p.qty}
                      onChange={(e) => updatePart(i, "qty", e.target.value)}
                      placeholder="0"
                      className={cn(inputCls, "text-xs px-2 py-1.5 font-mono text-center")}
                    />
                    <input
                      value={p.notes}
                      onChange={(e) => updatePart(i, "notes", e.target.value)}
                      placeholder="ملاحظات"
                      className={cn(inputCls, "text-xs px-2 py-1.5")}
                    />
                    <button
                      type="button"
                      onClick={() => removePart(i)}
                      title="حذف الصنف"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors justify-self-center"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
            {err("parts") && <p className="text-xs text-red-600 mt-1">{err("parts")}</p>}
          </div>

          <div>
            <label className={labelCls}>ملاحظات</label>
            <input
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="ملاحظات عامة..."
              className={inputCls}
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition-colors"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {form.id ? "تحديث أمر الشغل" : "حفظ أمر الشغل"}
            </button>
            {form.id && (
              <>
                <span className="text-xs text-slate-500">
                  تعديل أمر الشغل رقم <bdi className="font-mono">#{form.id}</bdi>
                </span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg px-3 py-2 transition-colors mr-auto"
                >
                  <Trash2 size={14} />
                  حذف
                </button>
              </>
            )}
          </div>
        </form>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">أوامر شغل هذا اليوم</h2>
            <span className="text-xs text-slate-400">{formatDate(date)}</span>
          </div>

          <div className="max-h-[540px] overflow-y-auto">
            {recordsLoading ? (
              <div className="p-6 text-center text-slate-400 text-sm">جاري التحميل...</div>
            ) : records.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm">
                لا توجد أوامر شغل في هذا التاريخ
              </div>
            ) : (
              records.map((rec) => (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => editRecord(rec)}
                  className="w-full text-right px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-primary-50 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate flex items-center gap-2">
                        <span dir="ltr" className="font-mono text-primary-700">
                          {rec.equipment.code}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0",
                            STATUS_CLS[rec.status]
                          )}
                        >
                          {STATUS_LABELS[rec.status]}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{rec.maintenanceType || "صيانة"}</span>
                        {rec.workOrderNo && (
                          <span dir="ltr" className="font-mono text-slate-400">
                            WO {rec.workOrderNo}
                          </span>
                        )}
                        {rec.workParts && rec.workParts.length > 0 && (
                          <span>قطع: {rec.workParts.length}</span>
                        )}
                      </div>
                    </div>
                    <Pencil
                      size={14}
                      className="text-slate-300 group-hover:text-primary-600 shrink-0"
                    />
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[13px] font-semibold text-slate-600">
                مواعيد تغيير الأصناف
              </label>
              <button
                type="button"
                onClick={addSchedRow}
                disabled={!form.equipmentId}
                className="flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-800 bg-primary-50 hover:bg-primary-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-2.5 py-1 transition-colors"
              >
                <Plus size={13} />
                إضافة صنف
              </button>
            </div>
            {!form.equipmentId ? (
              <p className="text-xs text-slate-400">
                اختر المعدة (بالكود) في الفورم لعرض وتعديل مواعيد تغيير أصنافها
              </p>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr_44px_58px_54px] gap-1.5 px-2 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600">
                  <span>الصنف</span>
                  <span className="text-center">كل</span>
                  <span>الوحدة</span>
                  <span />
                </div>
                <datalist id="sched-parts">
                  {PART_NAMES.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                {schedLoading ? (
                  <div className="px-3 py-3 text-xs text-slate-400 text-center">
                    جاري التحميل...
                  </div>
                ) : schedRows.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-slate-400 text-center">
                    لا توجد مواعيد مسجلة — اضغط «إضافة صنف»
                  </div>
                ) : (
                  schedRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1fr_44px_58px_54px] gap-1.5 px-2 py-2 border-b border-slate-100 last:border-0 items-center"
                    >
                      <input
                        list="sched-parts"
                        value={row.partName}
                        onChange={(e) => {
                          const name = e.target.value;
                          updateSchedRow(row.id, "partName", name);
                          const cur = row.interval.trim();
                          const dflt = defaultSchedInterval(name, row.unit);
                          if (dflt && (cur === "" || SCHED_DEFAULTS.has(cur))) {
                            updateSchedRow(row.id, "interval", dflt);
                          }
                        }}
                        placeholder="زيت محرك"
                        className={cn(inputCls, "text-xs px-2 py-1.5")}
                      />
                      <input
                        dir="ltr"
                        type="number"
                        step="any"
                        min="0"
                        value={row.interval}
                        onChange={(e) => updateSchedRow(row.id, "interval", e.target.value)}
                        placeholder="0"
                        className={cn(inputCls, "text-xs px-1.5 py-1.5 font-mono text-center")}
                      />
                      <select
                        value={row.unit}
                        onChange={(e) => {
                          const unit = e.target.value;
                          updateSchedRow(row.id, "unit", unit);
                          const cur = row.interval.trim();
                          const dflt = defaultSchedInterval(row.partName, unit);
                          if (dflt && SCHED_DEFAULTS.has(cur)) {
                            updateSchedRow(row.id, "interval", dflt);
                          }
                        }}
                        className={cn(inputCls, "text-xs px-1.5 py-1.5")}
                      >
                        {SCHED_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-0.5 justify-center">
                        <button
                          type="button"
                          onClick={() => saveSchedRow(row)}
                          title="حفظ"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-50 transition-colors"
                        >
                          {schedSavingId === row.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Save size={13} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSchedRow(row)}
                          title="حذف"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {form.equipmentId && (
              <p className="text-[11px] text-slate-400 mt-1.5">
                القيم الافتراضية للتنبيهات: زيت المحرك = 150 ساعة أو 10,000 كم (أيهما أسبق) — فلتر الزيت = 300 ساعة. باقي الزيوت والفلاتر لا تؤثر على التنبيهات.
              </p>
            )}
          </div>

          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 rounded-b-xl">
            عدد الأوامر: <b>{records.length}</b> — اضغط على أي أمر لتعديله
          </div>
        </div>
      </div>
    </div>
  );
}
