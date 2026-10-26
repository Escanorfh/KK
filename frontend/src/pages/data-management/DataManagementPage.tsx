import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import {
  Loader2,
  Download,
  Upload,
  Trash2,
  Database,
  FolderKanban,
  HardHat,
  CalendarDays,
  ClipboardList,
  Droplets,
  Users,
  AlertTriangle,
} from "lucide-react";
import { cn, todayLocal } from "@/lib/utils";
import { api, getApiError } from "@/lib/api";

type ImportEntity = "projects" | "equipments" | "dailylogs" | "maintenance" | "partschedules";

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

interface Stats {
  projects: number;
  sectors: number;
  equipment: number;
  dailyLogs: number;
  maintenance: number;
  workParts: number;
  partSchedules: number;
  faults: number;
  users: number;
}

interface SheetDialog {
  entity: ImportEntity;
  file: File;
  sheets: string[];
  chosen: string;
}

const normH = (v: unknown): string =>
  String(v ?? "")
    .replace(/[:：]/g, "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function pickDefaultSheet(wb: XLSX.WorkBook, entity: ImportEntity, sheets: string[]): string {
  if (entity !== "dailylogs" && entity !== "maintenance") return sheets[0];
  for (const name of sheets) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: "",
      range: "A1:AB8",
    }) as unknown[][];
    const hIdx = rows.findIndex((row) =>
      row.some((c) => {
        const n = normH(c);
        return n === "كود المعده" || n === "الكود" || n === "رقم امر الشغل";
      })
    );
    if (hIdx === -1) continue;
    const cells = new Set<string>();
    for (const row of [rows[hIdx], rows[hIdx + 1]]) {
      if (!row) continue;
      for (const c of row) {
        const n = normH(c);
        if (n) cells.add(n);
      }
    }
    const has = (sub: string) => [...cells].some((c) => c.includes(sub));
    const hasDate = cells.has("التاريخ") || cells.has("تاريخ");
    const hasPart = has("صنف");
    const hasWO = has("امر الشغل") || has("نوع الصيانه") || has("الورشه");
    const ok = entity === "dailylogs" ? hasDate && !hasPart : hasPart || hasWO;
    if (ok) return name;
  }
  return sheets[0];
}

const ENTITY_CARDS: {
  entity: ImportEntity;
  title: string;
  desc: string;
  columns: string;
  icon: typeof FolderKanban;
}[] = [
  {
    entity: "projects",
    title: "المشاريع",
    desc: "تصدير و استيراد قائمة المشاريع (بتُنشأ تلقائيًا للمعدات والأوامر)",
    columns: "الكود | الاسم | الوصف",
    icon: FolderKanban,
  },
  {
    entity: "equipments",
    title: "المعدات",
    desc: "تصدير و استيراد سجل المعدات — لو المشروع مش موجود بيتعمل بنفس الاسم",
    columns: "الكود | الاسم | المشروع | القطاع",
    icon: HardHat,
  },
  {
    entity: "dailylogs",
    title: "السجل اليومي (DAY)",
    desc: "يقبل صيغة النظام الحالية وصيغة إكسل القديمة (Sheet2/يومي: الصلاحية، الساعة، الكيلو، المشروع، التاريخ، القطاع) — الكود لو مش موجود بيتعمل معدة بنفس الكود",
    columns: "النظام: التاريخ | كود المعدة | العداد النهاية | ساعات التشغيل | الديزل | نوع الإنتاجية | عدد الإنتاجية | الحالة | ملاحظة الحالة | ملاحظات — أو صيغة قديمة: كود المعدة | الصلاحية | عداد ساعات | الساعة | الكيلو | المشروع: | التاريخ | القطاع",
    icon: CalendarDays,
  },
  {
    entity: "maintenance",
    title: "أوامر الشغل (WORK)",
    desc: "يقبل صيغة النظام الحالية وصيغة الشيت القديمة Sheet3 (RecordID كرقم أمر شغل + الصنف/الكمية بالأعمدة) — رقم أمر الشغل موجود بيتحدّث وإلا بيتعمل جديد",
    columns: "النظام: رقم أمر الشغل | التاريخ | تاريخ الانتهاء | كود المعدة | نوع الأمر | نوع الصيانة | الورشة | العداد | كم العداد | الحالة | نوع العمل | وصف العطل | الإجراء | ملاحظات | الأصناف — أو صيغة قديمة Sheet3 كاملة",
    icon: ClipboardList,
  },
  {
    entity: "partschedules",
    title: "مواعيد الأصناف",
    desc: "فترات تغيير زيت المحرك وفلتر الزيت — تُستخدم في صفحة تنبيهات الزيوت (زيت المحرك افتراضيًا 150 ساعة أو 10,000 كم، فلتر الزيت 300 ساعة)",
    columns: "كود المعدة | الصنف | الفترة | الوحدة | ملاحظات",
    icon: Droplets,
  },
];

export default function DataManagementPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ entity: string; result: ImportResult } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [sheetDialog, setSheetDialog] = useState<SheetDialog | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingEntity = useRef<ImportEntity | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get<Stats>("/data/stats");
      setStats(data);
    } catch (err) {
      toast.error(getApiError(err));
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleExport = async (entity: string) => {
    setBusy(`export:${entity}`);
    try {
      const res = await api.get(`/data/export/${entity}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}-${todayLocal()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("تم تنزيل الملف");
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const openImport = (entity: ImportEntity) => {
    pendingEntity.current = entity;
    fileRef.current?.click();
  };

  const doImport = async (entity: ImportEntity, file: File, sheet?: string) => {
    setBusy(`import:${entity}`);
    try {
      const form = new FormData();
      form.append("file", file);
      if (sheet) form.append("sheet", sheet);
      const { data } = await api.post<ImportResult>(`/data/import/${entity}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setLastResult({ entity, result: data });
      toast.success(`تم الاستيراد: ${data.created} جديد — ${data.updated} تحديث — ${data.skipped} تخطي`);
      loadStats();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const entity = pendingEntity.current;
    if (!file || !entity) return;
    if (/\.csv$/i.test(file.name)) {
      await doImport(entity, file);
      return;
    }
    setBusy(`import:${entity}`);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheets = wb.SheetNames;
      if (sheets.length > 1) {
        setSheetDialog({ entity, file, sheets, chosen: pickDefaultSheet(wb, entity, sheets) });
      } else {
        await doImport(entity, file, sheets[0]);
      }
    } catch {
      await doImport(entity, file);
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async (entity: string, label: string) => {
    if (!window.confirm(`مسح كل بيانات "${label}" نهائيًا؟ لا يمكن التراجع.`)) return;
    setBusy(`clear:${entity}`);
    try {
      const { data } = await api.post<{ deleted: number }>(`/data/clear/${entity}`);
      toast.success(`تم مسح ${label} (${data.deleted} سجل)`);
      setLastResult(null);
      loadStats();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleClearAll = async () => {
    if (confirmText.trim() !== "امسح") {
      toast.error('اكتب "امسح" في الخانة أولاً للتأكيد');
      return;
    }
    setBusy("clear-all");
    try {
      const { data } = await api.post<{ deleted: Record<string, number> }>("/data/clear-all");
      const total = Object.values(data.deleted).reduce((a, b) => a + b, 0);
      toast.success(`تم مسح كل البيانات (${total} سجل) — المستخدمون محفوظون`);
      setConfirmText("");
      setLastResult(null);
      loadStats();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const statCards = [
    { label: "المشاريع", value: stats?.projects ?? null, icon: FolderKanban },
    { label: "المعدات", value: stats?.equipment ?? null, icon: HardHat },
    { label: "السجل اليومي", value: stats?.dailyLogs ?? null, icon: CalendarDays },
    { label: "أوامر الشغل", value: stats?.maintenance ?? null, icon: ClipboardList },
    { label: "مواعيد الأصناف", value: stats?.partSchedules ?? null, icon: Droplets },
    { label: "المستخدمون", value: stats?.users ?? null, icon: Users },
  ];

  return (
    <div className="space-y-5">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv"
        className="hidden"
        onChange={handleFile}
      />

      <div>
        <h1 className="text-lg font-bold text-slate-800">إدارة البيانات</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          استيراد وتصدير ملفات Excel (xlsx / xls / xlsm) و CSV لكل الجداول + مسح البيانات — لو الملف فيه شيتات
          متعددة بتختار الشيت قبل الاستيراد — صلاحية ROOT فقط
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
            <c.icon size={16} className="text-primary-600 mb-1" />
            <div className="text-xl font-extrabold text-slate-800 leading-tight">
              {c.value == null ? "—" : c.value}
            </div>
            <div className="text-[11px] font-semibold text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {ENTITY_CARDS.map((card) => (
          <div key={card.entity} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center shrink-0">
                  <card.icon size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 text-sm">{card.title}</h3>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">{card.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleExport(card.entity)}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {busy === `export:${card.entity}` ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  تصدير
                </button>
                <button
                  onClick={() => openImport(card.entity)}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white px-3 py-2 hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  {busy === `import:${card.entity}` ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  استيراد
                </button>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 font-mono leading-relaxed" dir="ltr">
                {card.columns}
              </p>
            </div>
            <div className="mt-2">
              <button
                onClick={() => handleClear(card.entity, card.title)}
                disabled={busy !== null}
                className="flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg px-2 py-1 transition-colors disabled:opacity-50"
              >
                <Trash2 size={12} /> مسح بيانات {card.title}
              </button>
            </div>
          </div>
        ))}

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                <Users size={18} />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">المستخدمون</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  تصدير فقط — المستخدمون لا يُمسحون ولا يُستوردون من Excel
                </p>
              </div>
            </div>
            <button
              onClick={() => handleExport("users")}
              disabled={busy !== null}
              className="flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {busy === "export:users" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              تصدير
            </button>
          </div>
        </div>
      </div>

      {lastResult && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <h3 className="font-bold text-slate-800 text-sm mb-2 flex items-center gap-2">
            <Database size={15} className="text-primary-600" />
            آخر استيراد: {ENTITY_CARDS.find((c) => c.entity === lastResult.entity)?.title ?? lastResult.entity}
          </h3>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-100 text-emerald-700 font-bold px-3 py-1">
              جديد: {lastResult.result.created}
            </span>
            <span className="rounded-full bg-sky-100 text-sky-700 font-bold px-3 py-1">
              تحديث: {lastResult.result.updated}
            </span>
            <span className="rounded-full bg-amber-100 text-amber-700 font-bold px-3 py-1">
              تخطي: {lastResult.result.skipped}
            </span>
          </div>
          {lastResult.result.errors.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
              <p className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                <AlertTriangle size={13} /> أخطاء (أول {lastResult.result.errors.length}):
              </p>
              {lastResult.result.errors.map((e, i) => (
                <p key={i} className="text-[11px] text-red-700">
                  سطر {e.row}: {e.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-red-200 rounded-xl p-4 shadow-sm">
        <h3 className="font-bold text-red-700 text-sm mb-1 flex items-center gap-2">
          <AlertTriangle size={15} /> منطقة الخطر — مسح كل البيانات
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">
          يمسح المشاريع والمعدات والسجل اليومي وأوامر الشغل والمواعيد والأعطال وسجل التدقيق —{" "}
          <b className="text-slate-700">المستخدمين محفوظون</b>. لا يمكن التراجع.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='اكتب "امسح" للتأكيد'
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white w-48 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <button
            onClick={handleClearAll}
            disabled={busy !== null || confirmText.trim() !== "امسح"}
            className={cn(
              "flex items-center gap-1.5 text-xs font-bold rounded-lg px-4 py-2 transition-colors",
              confirmText.trim() === "امسح"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-red-100 text-red-400 cursor-not-allowed"
            )}
          >
            {busy === "clear-all" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            امسح كل البيانات
          </button>
        </div>
      </div>

      {sheetDialog && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={() => setSheetDialog(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <Upload size={15} className="text-primary-600" /> اختر الشيت للاستيراد
            </h3>
            <p className="text-[11px] text-slate-500 truncate" dir="ltr">
              {sheetDialog.file.name}
            </p>
            <select
              value={sheetDialog.chosen}
              onChange={(e) => setSheetDialog({ ...sheetDialog, chosen: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              {sheetDialog.sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              الشيت المناسب للجدول ده متحدد تلقائيًا — لو عايز شيت تاني (مثلاً Sheet2 للسجل التاريخي القديم)
              غيّره من القائمة واستورد كل شيت على حدة.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setSheetDialog(null)}
                className="text-xs font-semibold rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => {
                  const d = sheetDialog;
                  setSheetDialog(null);
                  void doImport(d.entity, d.file, d.chosen);
                }}
                disabled={busy !== null}
                className="flex items-center gap-1.5 text-xs font-bold rounded-lg bg-primary-600 text-white px-4 py-2 hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {busy === `import:${sheetDialog.entity}` ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                استيراد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
