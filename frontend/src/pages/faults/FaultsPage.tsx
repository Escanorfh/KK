import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Printer, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiError } from "@/lib/api";
import { projectOptions } from "@/services/projects";
import { getFaultReport, type FaultReport } from "@/services/faults";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";

export default function FaultsPage() {
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof projectOptions>>>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [date, setDate] = useState("");
  const [data, setData] = useState<FaultReport | null>(null);
  const [loading, setLoading] = useState(false);
  const firstLoad = useRef(true);

  useEffect(() => {
    projectOptions()
      .then(setProjects)
      .catch((err) => toast.error(getApiError(err)));
  }, []);

  const loadReport = useCallback(
    async (dateArg?: string) => {
      setLoading(true);
      try {
        const res = await getFaultReport({
          projectId: projectId === "" ? undefined : projectId,
          date: dateArg || undefined,
        });
        setData(res);
        if (!dateArg) setDate(res.date);
      } catch (err) {
        toast.error(getApiError(err));
      } finally {
        setLoading(false);
        firstLoad.current = false;
      }
    },
    [projectId]
  );

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handlePrint = () => window.print();

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">جدول الأعطال</h1>
          <p className="text-xs text-slate-500 mt-0.5">تقرير حالة المعدات — المعدات العاطلة حسب المشروع والتاريخ</p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className={labelCls}>المشروع</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value === "" ? "" : Number(e.target.value))}
              className={cn(inputCls, "min-w-[180px]")}
            >
              <option value="">كل المشاريع</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>التاريخ</label>
            <input
              type="date"
              dir="ltr"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={cn(inputCls, "font-mono")}
            />
          </div>
          <button
            onClick={() => loadReport(date)}
            disabled={loading}
            className="flex items-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            عرض
          </button>
          <button
            onClick={handlePrint}
            disabled={!data}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
          >
            <Printer size={16} />
            طباعة
          </button>
        </div>
      </div>

      <div className="print-area bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <img src="/logo.jpeg" alt="شركة قاصد خير" className="w-full block select-none" draggable={false} />

        <div className="px-6 pb-6 pt-4">
          <h2 className="text-center text-2xl font-extrabold text-emerald-800 mb-4">تقرير حالة المعدات</h2>

          <div dir="ltr" className="flex items-stretch justify-center border border-slate-800 mb-5 text-sm font-semibold">
            <div className="px-4 py-2 border-l border-slate-800 min-w-[110px] text-center font-mono">
              {data?.date ? data.date.split("-").reverse().join("/") : "—"}
            </div>
            <div className="px-4 py-2 border-l border-slate-800 min-w-[70px] text-center">بتاريخ</div>
            <div className="px-4 py-2 border-l border-slate-800 min-w-[160px] text-center">{data?.project?.name || "كل المشاريع"}</div>
            <div className="px-4 py-2 min-w-[140px] text-center">بيان حالة معدات</div>
          </div>

          <div dir="ltr" className="grid grid-cols-4 border border-slate-800 mb-5 text-sm max-w-2xl mx-auto">
            <div className="px-3 py-2 border-l border-slate-800 font-bold text-center bg-slate-100">عاطل</div>
            <div className="px-3 py-2 border-l border-slate-800 font-bold text-center bg-slate-100">متوقف</div>
            <div className="px-3 py-2 border-l border-slate-800 font-bold text-center bg-slate-100">صالح</div>
            <div className="px-3 py-2 font-bold text-center bg-slate-100">الإجمالي</div>
            <div className="px-3 py-2 border-l border-t border-slate-800 font-extrabold text-center">
              {data?.summary.broken ?? 0}
            </div>
            <div className="px-3 py-2 border-l border-t border-slate-800 font-extrabold text-center">
              {data?.summary.stopped ?? 0}
            </div>
            <div className="px-3 py-2 border-l border-t border-slate-800 font-extrabold text-center">
              {data?.summary.good ?? 0}
            </div>
            <div className="px-3 py-2 border-t border-slate-800 font-extrabold text-center">
              {data?.summary.total ?? 0}
            </div>
          </div>

          <h3 className="text-center font-bold text-slate-800 mb-2">بيان بالمعدات المطلوب صيانتها</h3>

          {loading && firstLoad.current ? (
            <div className="p-8 text-center text-slate-400 text-sm">جاري التحميل...</div>
          ) : !data || data.rows.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">لا توجد معدات عاطلة في هذا التاريخ</div>
          ) : (
            <table dir="ltr" className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-slate-800 px-3 py-2 font-bold text-center w-[70%]">وصف العطل</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold text-center w-[110px]">الكود</th>
                  <th className="border border-slate-800 px-3 py-2 font-bold text-center w-[45px]">م</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.equipmentId}>
                    <td className="border border-slate-800 px-3 py-2 text-right align-top whitespace-pre-line">
                      {row.note || "—"}
                    </td>
                    <td className="border border-slate-800 px-3 py-2 text-center align-top font-mono font-semibold">
                      {row.code}
                    </td>
                    <td className="border border-slate-800 px-3 py-2 text-center align-top font-semibold">{i + 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="no-print text-center text-xs text-slate-400 mt-4">
            التاريخ يُضبط تلقائيًا على أحدث يوم مسجل — عدد المعدات العاطلة: <b>{data?.rows.length ?? 0}</b>
          </div>

          <div className="text-center text-[10px] text-slate-400 mt-5 print:text-slate-500">build by Gen Code</div>
        </div>
      </div>
    </div>
  );
}
