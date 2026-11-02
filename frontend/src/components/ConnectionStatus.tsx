import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CloudOff, Cloud, RefreshCw, Wifi, X, Trash2, Settings2, Server, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRoot, getServerUrl, setServerUrl } from "@/lib/serverUrl";
import { kvLatestAt, type OutboxItem } from "@/lib/offline/db";
import { discardQueued, flushOutbox, retryQueued, subscribeOutbox } from "@/lib/offline/queue";

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function StatusRow({ ok, label, path, Icon }: { ok: boolean | null; label: string; path: string; Icon: typeof Wifi }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold">
      <Icon size={14} className={ok ? "text-emerald-600" : "text-red-600"} />
      <span className={ok ? "text-emerald-700" : "text-red-700"}>
        {label} — {ok ? "سليم" : "فشل"}
      </span>
      <span className="text-[10px] text-slate-400 font-mono" dir="ltr">{path}</span>
    </div>
  );
}

// Wasmer بيقطع الاتصال أحيانًا من غير رد، والمنصة بتصحى من النوم في ثواني — فمهلة 15 ثانية وإعادة محاولة واحدة
async function probeEndpoint(base: string, path: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return true;
      // 503 من /api/health/db معناه السيرفر شغال والقاعدة واقعة — يستاهل المحاولة التانية
      if (res.status !== 503) return false;
    } catch {
      // انقطاع أو انتهاء المهلة
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

export default function ConnectionStatus() {
  const online = useOnline();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(getServerUrl());
  const [testing, setTesting] = useState(false);
  const [lastCache, setLastCache] = useState<number | null>(null);
  const [checks, setChecks] = useState<{ server: boolean | null; db: boolean | null }>({ server: null, db: null });

  useEffect(() => subscribeOutbox(setItems), []);

  const pending = items.length;
  const failed = items.filter((i) => i.error).length;

  const testConnection = useCallback(async (nextUrl: string) => {
    setTesting(true);
    const base = nextUrl.replace(/\/+$/, "");
    const server = await probeEndpoint(base, "/api/health");
    const db = server ? await probeEndpoint(base, "/api/health/db") : null;
    setChecks({ server, db });
    setTesting(false);
    if (!server) toast.error("لا يمكن الوصول للسيرفر — تأكد من العنوان والمنفذ");
    else if (!db) toast("السيرفر يرد لكن قاعدة البيانات لا تتصل", { icon: "⚠️" });
    else toast.success("الاتصال بالسيرفر وقاعدة البيانات سليم");
    return { server, db };
  }, []);

  const openModal = useCallback(() => {
    setOpen(true);
    setUrl(getServerUrl());
    void kvLatestAt().then(setLastCache);
    void testConnection(getServerUrl());
  }, [testConnection]);

  const saveUrl = async () => {
    const clean = url.trim();
    // العنوان يتحفظ لو السيرفر برد: القاعدة النايمة أو المتعطلة مش سبب يمنع الضبط
    if (clean && !(await testConnection(clean)).server) return;
    setServerUrl(clean);
    toast.success(clean ? "تم ضبط عنوان السيرفر" : "سيُستخدم نفس العنوان الحالي للتطبيق");
    await flushOutbox();
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors",
          !online
            ? "bg-red-50 text-red-700 border-red-200"
            : failed
              ? "bg-amber-50 text-amber-800 border-amber-300"
              : pending
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
        )}
        title="حالة الاتصال والعمليات المعلّقة"
      >
        {!online ? <CloudOff size={14} /> : pending || failed ? <RefreshCw size={14} /> : <Cloud size={14} />}
        {!online ? "غير متصل" : pending || failed ? `${pending} في الانتظار` : "متصل"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                <Settings2 size={16} /> حالة الاتصال والمزامنة
              </h3>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold">
                {online ? <Wifi size={14} className="text-emerald-600" /> : <CloudOff size={14} className="text-red-600" />}
                <span className={online ? "text-emerald-700" : "text-red-700"}>
                  {online ? "الاتصال بالشبكة متاح" : "لا يوجد اتصال بالشبكة — الشاشات تعمل من آخر بيانات مخزّنة"}
                </span>
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1.5">عنوان السيرفر</label>
                <div className="flex items-end gap-2">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={`مثال: http://192.168.1.20:5000 — أو اتركه فارغًا لاستخدام ${apiRoot()}`}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                    dir="ltr"
                  />
                  <button
                    onClick={saveUrl}
                    disabled={testing}
                    className="rounded-lg bg-primary-600 text-white text-xs font-bold px-4 py-2.5 hover:bg-primary-700 disabled:opacity-60"
                  >
                    {testing ? "جارٍ الفحص..." : "حفظ وفحص"}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  العنوان الحالي للطلبات: <b className="font-mono" dir="ltr">{apiRoot()}/api</b>
                </p>

                {testing ? (
                  <p className="text-[11px] text-slate-500 mt-2">جارٍ الفحص (حتى 15 ثانية لكل نقطة)...</p>
                ) : (
                  checks.server !== null && (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <StatusRow ok={checks.server} label="الاتصال بالسيرفر" path="/api/health" Icon={Server} />
                      {checks.db !== null ? (
                        <StatusRow ok={checks.db} label="الاتصال بقاعدة البيانات" path="/api/health/db" Icon={Database} />
                      ) : (
                        <p className="text-[11px] text-slate-500">لم يُفحص اتصال القاعدة لأن السيرفر لا يرد.</p>
                      )}
                      <button
                        onClick={() => void testConnection(url.trim() || getServerUrl())}
                        className="text-[11px] font-bold text-primary-700 hover:bg-primary-50 rounded px-2 py-1"
                      >
                        إعادة الفحص
                      </button>
                    </div>
                  )
                )}
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[13px] font-bold text-slate-700">
                    عمليات محفوظة على الجهاز ({pending})
                  </h4>
                  {pending > 0 && (
                    <button
                      onClick={() => flushOutbox()}
                      className="text-[11px] font-bold text-primary-700 hover:bg-primary-50 rounded-lg px-3 py-1.5"
                    >
                      إرسال الآن
                    </button>
                  )}
                </div>

                {pending === 0 ? (
                  <p className="text-xs text-slate-500">
                    لا توجد عمليات معلّقة — كل ما تم إدخاله وصل للسيرفر.
                    {lastCache && <> آخر قراءة مخزّنة للبيانات: {fmtWhen(lastCache)}</>}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((it) => (
                      <li key={it.id} className="border border-slate-200 rounded-lg px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-700">{it.kind}</span>
                          <span className="text-[10px] text-slate-400 whitespace-nowrap">{fmtWhen(it.createdAt)}</span>
                        </div>
                        {it.error ? (
                          <p className="text-[11px] text-red-700 mt-1">رفض السيرفر: {it.error}</p>
                        ) : (
                          <p className="text-[11px] text-slate-500 mt-1">
                            {online ? "في انتظار الإرسال" : "سيُرسل تلقائيًا عند عودة الاتصال"}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          {it.error && (
                            <button
                              onClick={() => retryQueued(it.id!)}
                              className="text-[11px] font-bold text-primary-700 hover:bg-primary-50 rounded px-2 py-1"
                            >
                              إعادة المحاولة
                            </button>
                          )}
                          <button
                            onClick={() => discardQueued(it.id!)}
                            className="text-[11px] font-bold text-slate-500 hover:bg-slate-100 rounded px-2 py-1 flex items-center gap-1"
                          >
                            <Trash2 size={12} /> تجاهل
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 leading-5">
                يعمل أوفلاين: إدخال اليومي، أوامر الشغل، طلبات الإصلاح وطلبات الاحتياج تُحفظ على الجهاز وتُرسل
                بالترتيب. استيراد Excel، مسح البيانات، وأزرار الإرسال لـManagers تحتاج اتصالًا مباشرًا.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
