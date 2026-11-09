/**
 * مسار بناء EFMS Windows x86 (IA32) — مستقل تمامًا عن اعتماد x64 الأساسي.
 *
 * يستخدم Electron 43.8.7 (آخر باتش رسمي لسلسلة 43، آخر سلسلة تدعم win32-ia32).
 * نهاية الدعم الرسمية لسلسلة 43: 2027-01-05 — بعدها لا تحديثات أمنية لمعمارية x86.
 *
 * لا يغيّر package.json ولا package-lock.json: يُمرر runtime الـ ia32 عبر
 * electronDist/electronVersion إلى electron-builder فقط.
 * إذا تعذر توفر الحزمة الثنائية يُغلق المسار بأمان ([BLOCKED]) ولا يختلق مثبّتًا.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const IA32_VERSION = "43.8.7";
const IA32_EOL = "2027-01-05";
// مجلد المخرجات قابل للتجاوز لأن app.asar قد يظل مقفولًا من عملية سابقة في هذه البيئة
const OUT_DIR_NAME = process.env.EFMS_X86_OUT_DIR || "desktop-release-x86";
const ARTIFACT_NAME = "EFMS-Setup-x86.exe";

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const cacheDir = path.join(localAppData, "electron", "Cache");
const ia32Zip = path.join(cacheDir, `electron-v${IA32_VERSION}-win32-ia32.zip`);
const distDir = path.join(ROOT, "node_modules", ".cache", "efms", `electron-${IA32_VERSION}-ia32`);

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.error || r.status !== 0) {
    fail([`[FAIL] ${label}`, r.error ? r.error.message : `exit code ${r.status}`]);
  }
}

function peMachine(exePath) {
  const b = fs.readFileSync(exePath);
  if (b.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE file");
  return b.readUInt16LE(b.readUInt32LE(0x3c) + 4);
}

function zipHasEocd(zipPath) {
  const fd = fs.openSync(zipPath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, 65557));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) return true;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

console.log("=== بناء EFMS Windows x86 (IA32) — Electron " + IA32_VERSION + " ===");
console.log(`ملاحظة أمنية: سلسلة 43 هي الأخيرة الداعمة لـ win32-ia32، وتنتهي رسميًا في ${IA32_EOL}.`);
console.log("بعد هذا التاريخ لا تصل أي تحديثات أمنية لمعمارية x86. اعتماد x64 الأساسي (45.2.3) لا يتأثر بهذا المسار.");

// 1) فحص توفر الحزمة الثنائية وسلامتها البنيوية
if (!fs.existsSync(ia32Zip) || !zipHasEocd(ia32Zip)) {
  fail([
    "[BLOCKED] تعذر بناء حزمة x86:",
    `الأصل المطلوب: electron-v${IA32_VERSION}-win32-ia32.zip`,
    `المسار Expected: ${ia32Zip}`,
    !fs.existsSync(ia32Zip) ? "السبب: الملف غير موجود في الكاش المحلي." : "السبب: الملف موجود لكنه ليس أرشيف zip سليمًا (EOCD مفقود).",
    "تنزيل GitHub Assets محجوب في هذه البيئة؛ نزّل الحزمة يدويًا من مرآة npmmirror:",
    `https://npmmirror.com/mirrors/electron/v${IA32_VERSION}/electron-v${IA32_VERSION}-win32-ia32.zip`,
    "ضعها في مسار الكاش أعلاه ثم أعد تشغيل البناء. لن يُستخدم بديل x64 ولن يُخفّض الاعتماد الأساسي.",
  ]);
}
console.log("[PASS] الحزمة الثنائية موجودة وسليمة بنيويًا:", ia32Zip);

// 2) فك الحزمة إلى dist منفصل والتحقق من المعمارية قبل البناء
const versionFile = path.join(distDir, "version");
const extractedExe = path.join(distDir, "electron.exe");
const alreadyExtracted =
  fs.existsSync(extractedExe) &&
  fs.existsSync(versionFile) &&
  fs.readFileSync(versionFile, "utf8").trim().replace(/^v/, "") === IA32_VERSION;

if (!alreadyExtracted) {
  fs.mkdirSync(distDir, { recursive: true });
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  run(tar, ["-xf", ia32Zip, "-C", distDir], "فك أرشيف Electron ia32");
}
if (!fs.existsSync(extractedExe) || !fs.existsSync(versionFile)) {
  fail(["[FAIL] فك الأرشيف لم ينتج electron.exe/version — الأرشيف تالف."]);
}
const extractedVersion = fs.readFileSync(versionFile, "utf8").trim().replace(/^v/, "");
if (extractedVersion !== IA32_VERSION) {
  fail([`[FAIL] إصدار الـ dist المفكوك (${extractedVersion}) لا يطابق ${IA32_VERSION}.`]);
}
if (peMachine(extractedExe) !== 0x014c) {
  fail(["[FAIL] electron.exe المفكوك ليس i386 — الحزمة ليست ia32 حقيقية."]);
}
console.log(`[PASS] dist ia32 جاهز: ${distDir} (الإصدار ${extractedVersion}، PE i386)`);

// 3) بناء الواجهة المشتركة (نفس خطوات مسار x64)
run(process.execPath, [path.join(ROOT, "scripts", "gen-icons.mjs"), "public"], "توليد الأيقونات");
run(process.execPath, [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-b"], "TypeScript");
run(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"], "Vite build");

// 4) التعبئة عبر electron-builder بإعداد ia32 مستقل ومخرجات منفصلة
const builderEnv = {
  ...process.env,
  ELECTRON_MIRROR: "https://npmmirror.com/mirrors/electron/",
  ELECTRON_BUILDER_BINARIES_MIRROR: "https://npmmirror.com/mirrors/electron-builder-binaries/",
};
const builder = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules", "electron-builder", "cli.js"),
    "--win",
    "--ia32",
    `--config.electronVersion=${IA32_VERSION}`,
    `--config.electronDist=${distDir}`,
    `--config.directories.output=${OUT_DIR_NAME}`,
    `--config.nsis.artifactName=${ARTIFACT_NAME}`,
  ],
  { cwd: ROOT, stdio: "inherit", env: builderEnv }
);
if (builder.error || builder.status !== 0) {
  fail(["[FAIL] electron-builder لم ينتج مثبّت x86.", builder.error ? builder.error.message : `exit code ${builder.status}`]);
}

// 5) التحقق من الناتج الفعلي: المثبّت + PE للملف التنفيذي المعبأ (ia32 فقط)
const outDir = path.join(ROOT, OUT_DIR_NAME);
const installer = path.join(outDir, ARTIFACT_NAME);
const packedExe = path.join(outDir, "win-ia32-unpacked", "EFMS.exe");
if (!fs.existsSync(installer) || !fs.existsSync(packedExe)) {
  fail(["[FAIL] اكتمل electron-builder لكن المثبّت أو EFMS.exe غير موجودين في " + outDir]);
}
if (fs.existsSync(path.join(outDir, "win-unpacked"))) {
  fail(["[FAIL] يوجد مجلد win-unpacked (x64) داخل مخرجات x86 — البناء ليس ia32 خالصًا."]);
}
if (peMachine(packedExe) !== 0x014c) {
  fail(["[FAIL] EFMS.exe المعبأ ليس i386 (x86)."]);
}
const installerMB = (fs.statSync(installer).size / 1048576).toFixed(1);
console.log(`[PASS] PE architecture: EFMS.exe المعبأ = i386 (x86)`);
console.log(`[PASS] runtime معبأ: Electron ${extractedVersion} win32-ia32`);
console.log(`[PASS] المثبّت: ${installer} (${installerMB} MB)`);
console.log("[PASS] اكتمل مسار x86 — المخرجات منفصلة عن x64، والاعتماد الأساسي لم يتغير.");