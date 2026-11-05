import path from "node:path";

// وضع التشغيل صريح من مصدر واحد بس: EFMS_MODE.
// ما فيش تخمين من اسم مضيف ولا من وجود DATABASE_URL — الغلط هنا يوصّل سطح المكتب بقاعدة سحابية.
export type EfmsMode = "web" | "desktop";

const raw = (process.env.EFMS_MODE ?? "").trim().toLowerCase();
if (raw !== "" && raw !== "web" && raw !== "desktop") {
  throw new Error(`EFMS_MODE غير صالح: «${raw}» — المسموح "web" أو "desktop" فقط`);
}

// الوضع الافتراضي web لأنه سلوك الإنتاج الحالي على Vercel (المنصة ما بتضبطش EFMS_MODE).
export const EFMS_MODE: EfmsMode = raw === "desktop" ? "desktop" : "web";

export function isDesktopMode(): boolean {
  return EFMS_MODE === "desktop";
}

// ملف قاعدة SQLite الحقيقية بيحدده Electron من userData؛ المسار بيتحقن، ما بيتشتقش من cwd.
export function desktopSqliteFile(): string {
  const dir = (process.env.EFMS_SQLITE_DIR ?? "").trim();
  if (!dir) {
    throw new Error(
      "EFMS_SQLITE_DIR مفقود: وضع desktop محتاج مسار بيانات المستخدم (electron app.getPath('userData')) — القاعدة ما بتتحطش جوه مجلد التثبيت أو asar"
    );
  }
  return path.join(dir, "efms.db");
}

export function desktopSqliteUrl(): string {
  return `file:${desktopSqliteFile().replace(/\\/g, "/")}`;
}

// وضع web لازم يكون عنده PostgreSQL؛ الفحص هنا بيمنع اتصال صامت بقاعدة ناقصة.
export function assertWebDatasourceConfigured(): void {
  if (!(process.env.DATABASE_URL ?? "").trim()) {
    throw new Error("DATABASE_URL مفقود: وضع web بيستخدم PostgreSQL الإنتاجي فقط، ومفيش fallback لـ SQLite");
  }
}
