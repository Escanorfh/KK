import "dotenv/config";
import app from "./app";
import { startDbKeepAlive } from "./utils/db";
import { startProjectsAutoSync } from "./modules/data/data.service";

const PORT = process.env.PORT || 5000;

// Vercel يحوّل هذا الملف إلى Function واحدة ويستهلك الـ default export.
// التشغيل هناك بلا process مستمر، فلا listen ولا setInterval (الاثنان بيموتوا مع أول برود)؛
// المزامنة الدورية بتبقى من Vercel Cron على /api/cron/projects-sync

// الحزمة CommonJS، فـ `export default` بيطلع exports.default = app: أي loader بيفكّ التغليف
// مرة واحدة يوصل لكائن مش دالّة. المرجع الذاتي يخلّي export.default === app في كلتا الحالتين.
(app as unknown as { default: typeof app }).default = app;

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
    startDbKeepAlive();
    // مزامنة تلقائية لمشاريع نظام المدرين: مرة عند التشغيل ثم كل ساعة
    startProjectsAutoSync();
  });
}
