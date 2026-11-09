import { useState } from "react";
import { Download, X, Share, PlusSquare, Smartphone } from "lucide-react";
import { usePWAInstall } from "@/hooks/usePWAInstall";

export default function InstallPrompt() {
  const { shouldShowPrompt, platform, installNative, dismissPrompt } = usePWAInstall();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  if (!shouldShowPrompt) {
    return null;
  }

  const handleInstallClick = async () => {
    if (platform === "native") {
      setIsInstalling(true);
      await installNative();
      setIsInstalling(false);
    } else if (platform === "ios") {
      setShowIOSInstructions(true);
    }
  };

  return (
    <div
      role="region"
      aria-label="تثبيت تطبيق EFMS"
      className="fixed bottom-5 right-5 z-40 max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl transition-all animate-in fade-in slide-in-from-bottom-4"
      dir="rtl"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary-700 p-2.5 text-white shadow-sm">
          <Smartphone size={22} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-800">تثبيت تطبيق EFMS</h4>
            <button
              type="button"
              onClick={dismissPrompt}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              title="إغلاق التنبيه"
            >
              <X size={16} />
            </button>
          </div>

          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            ثبّت التطبيق على جهازك للوصول السريع وتجربة شاشة كاملة وسلاسة في العمل بدون إنترنت.
          </p>

          {showIOSInstructions ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
              <p className="font-semibold text-primary-900">طريقة التثبيت على آيفون / آيباد:</p>
              <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-600">
                <li className="flex items-center gap-1.5">
                  <span>اضغط على زر المشاركة</span>
                  <Share size={13} className="text-primary-700 inline" />
                  <span>في أسفل متصفح Safari.</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span>اختر</span>
                  <span className="font-bold text-slate-800">"إضافة إلى الصفحة الرئيسية"</span>
                  <PlusSquare size={13} className="text-primary-700 inline" />
                </li>
                <li>
                  <span>اضغط على </span>
                  <span className="font-bold text-slate-800">"إضافة" (Add)</span>
                  <span> في أعلى الشاشة.</span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSInstructions(false)}
                className="mt-2 text-[11px] font-bold text-primary-700 hover:underline"
              >
                إغلاق الإرشادات
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleInstallClick}
                disabled={isInstalling}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-primary-800 disabled:opacity-60 shadow-sm"
              >
                <Download size={14} />
                {isInstalling ? "جارٍ التثبيت..." : platform === "ios" ? "عرض طريقة التثبيت" : "تثبيت الآن"}
              </button>
              <button
                type="button"
                onClick={dismissPrompt}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                لاحقًا
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
