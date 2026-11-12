import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X, Sparkles } from "lucide-react";
import { useState } from "react";

export default function ReloadPrompt() {
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (!r) return;
      // Check for a new deployment immediately on load.
      void r.update();
      // Re-check periodically (every 15 minutes) and when the tab regains focus.
      setInterval(() => {
        void r.update();
      }, 15 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void r.update();
      });
      window.addEventListener("focus", () => {
        void r.update();
      });
    },
    onRegisterError(error) {
      console.error("SW registration error:", error);
    },
  });

  const handleUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      await updateServiceWorker(true);
    } catch (err) {
      console.error("Failed to update Service Worker:", err);
      setUpdateError("تعذّر إكمال التحديث تلقائيًا. يُرجى إعادة تحميل الصفحة يدويًا.");
      setUpdating(false);
    }
  };

  const handleDismiss = () => {
    setNeedRefresh(false);
    setUpdateError(null);
  };

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-5 left-5 z-50 max-w-sm rounded-xl border border-primary-200 bg-white p-4 shadow-2xl transition-all animate-in fade-in slide-in-from-bottom-4"
      dir="rtl"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary-50 p-2 text-primary-700">
          <Sparkles size={20} />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-slate-800">تحديث جديد متوفر</h4>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            توجد نسخة جديدة ومحدثة من نظام EFMS. هل ترغب في التحديث الآن لتطبيق التحسينات؟
          </p>

          {updateError && (
            <p className="mt-2 text-xs font-semibold text-red-600 bg-red-50 p-2 rounded-md">
              {updateError}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleUpdate}
              disabled={updating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-primary-800 disabled:opacity-60"
            >
              <RefreshCw size={13} className={updating ? "animate-spin" : ""} />
              {updating ? "جارٍ التحديث..." : "تحديث الآن"}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              disabled={updating}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              لاحقًا
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-slate-400 hover:text-slate-600 p-1"
          title="إغلاق"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

