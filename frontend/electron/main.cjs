// نقطة تشغيل تطبيق سطح المكتب: يقدّم مجلد dist/ عبر خادم محلي ثم يفتحه في نافذة Electron
// نستخدم خادم HTTP بدل file:// لأن التوجيه يعتمد على BrowserRouter ومسارات الأصول المطلقة
try {
  require("node:fs").writeFileSync("C:\\Users\\Nour\\AppData\\Local\\Temp\\EFMS_ENTRY_PROOF.txt", "PROOF_AT_" + new Date().toISOString() + "\n");
} catch(e) {}
const { app, BrowserWindow, Menu, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");

const DIAG_LOG = path.join(require("node:os").tmpdir(), "efms-diagnostic.log");
function diagLog(msg) {
  try {
    fs.appendFileSync(DIAG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}
diagLog("MAIN_PROCESS_BOOT: electron ver=" + process.versions.electron);
process.on("uncaughtException", (err) => {
  diagLog(`UNCAUGHT_EXCEPTION: ${err ? err.stack || err.message : err}`);
});
process.on("unhandledRejection", (reason) => {
  diagLog(`UNHANDLED_REJECTION: ${reason ? reason.stack || reason.message : reason}`);
});

const DIST = path.join(__dirname, "..", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function readFileSafe(absPath) {
  try {
    return fs.readFileSync(absPath);
  } catch {
    return null;
  }
}

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-cache" });
  res.end(body);
}

function handler(req, res) {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname || "/");
  } catch {
    return send(res, 400, "bad request", "text/plain; charset=utf-8");
  }

  // منع الخروج من مجلد dist
  const target = path.join(DIST, pathname);
  diagLog(`HTTP_REQ: ${req.method} ${pathname} -> target: ${target}`);
  if (target !== DIST && !target.startsWith(DIST + path.sep)) {
    diagLog(`HTTP_403_FORBIDDEN: ${target}`);
    return send(res, 403, "forbidden", "text/plain; charset=utf-8");
  }

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    diagLog(`HTTP_200_FILE: ${target}`);
    return send(res, 200, readFileSafe(target), MIME[path.extname(target).toLowerCase()] || "application/octet-stream");
  }

  // أروضة الـ SPA: أي مسار غير ملف حقيقي يرجّع الصفحة الرئيسية
  const index = readFileSafe(path.join(DIST, "index.html"));
  if (!index) {
    diagLog(`HTTP_500_NO_INDEX: ${path.join(DIST, "index.html")}`);
    return send(res, 500, "لم يتم بناء الواجهة — شغّل npm run build قبل تشغيل التطبيق", "text/plain; charset=utf-8");
  }
  diagLog(`HTTP_200_SPA_FALLBACK: ${pathname}`);
  return send(res, 200, index, MIME[".html"]);
}

/**
 * منفذ ثابت إلزامي (Authoritative Desktop Origin):
 * http://127.0.0.1:43124
 * التخزين المحلي (token + طابور الأوفلاين IndexedDB) مقيّد تماماً بهذا الـ Origin.
 * يُمنع منعاً باتاً الانتقال لأي منفذ بديل أو منفذ عشوائي (0).
 */
const AUTHORITATIVE_PORT = 43124;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    let resolved = false;

    const onError = (err) => {
      server.removeListener("listening", onListening);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    };

    const onListening = () => {
      server.removeListener("error", onError);
      if (!resolved) {
        resolved = true;
        resolve(server);
      }
    };

    server.once("error", onError);
    server.once("listening", () => {
      diagLog(`SERVER_LISTENING_PORT: ${AUTHORITATIVE_PORT}`);
      onListening();
    });
    diagLog(`SERVER_STARTING_ON_PORT: ${AUTHORITATIVE_PORT}`);
    server.listen(AUTHORITATIVE_PORT, "127.0.0.1");
  });
}

let mainWindow = null;
let activeServer = null;

function showPortConflictDialog() {
  const { dialog } = require("electron");
  const message =
    "تعذّر تشغيل نظام قاصد خير لأن المنفذ الأساسي (43124) مستخدم بواسطة برنامج آخر. " +
    "حفاظاً على بياناتك المحلية، لن يتم تشغيل التطبيق باستخدام منفذ بديل. " +
    "أغلق البرنامج الذي يستخدم المنفذ ثم حاول تشغيل EFMS مرة أخرى.";
  dialog.showErrorBox("تعذر بدء تشغيل EFMS", message);
}

function showUnexpectedServerError(err) {
  const { dialog } = require("electron");
  dialog.showErrorBox(
    "خطأ في خادم الواجهة المحلي",
    `حدث خطأ غير متوقع أثناء تشغيل خادم الواجهة المحلي:\n${err && err.message ? err.message : String(err)}`
  );
}

async function startApplication() {
  let server;
  try {
    server = await startServer();
  } catch (err) {
    if (err && err.code === "EADDRINUSE") {
      showPortConflictDialog();
    } else {
      showUnexpectedServerError(err);
    }
    app.quit();
    return;
  }

  activeServer = server;
  const entry = `http://127.0.0.1:${AUTHORITATIVE_PORT}/`;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#0f172a",
    title: "EFMS — متابعة المعدات والصيانة",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    diagLog(`RENDERER_DID_FAIL_LOAD: code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  });
  mainWindow.webContents.on("render-process-gone", (event, details) => {
    diagLog(`RENDER_PROCESS_GONE: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    diagLog(`RENDERER_CONSOLE: [lvl ${level}] ${message} (${sourceId}:${line})`);
  });

  Menu.setApplicationMenu(null);
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: link }) => {
    shell.openExternal(link);
    return { action: "deny" };
  });

  // مسح تسجيلات Service Worker وكاش أصوله فقط (دون IndexedDB أو localStorage) حتى لا يقدّم SW القديم حزمة قديمة معطوبة عند أول تشغيل بعد التحديث؛ الخادم المحلي هو مصدر الحقيقة دائماً
  try {
    await mainWindow.webContents.session.clearStorageData({
      origin: `http://127.0.0.1:${AUTHORITATIVE_PORT}`,
      storages: ["serviceworkers", "cachestorage"],
    });
  } catch {
    // فشل التنظيف لا يمنع التشغيل
  }

  try {
    await mainWindow.loadURL(entry);
  } catch (err) {
    // نافذة أغلقت أثناء التحميل أو حدث خطأ في الشبكة
    console.error("Failed to load application URL:", err);
  }

  // [DIAGNOSTIC] فتح DevTools لرؤية أخطاء الـ renderer — يجب إزالته قبل الإصدار النهائي
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    void startApplication();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && activeServer) {
        void startApplication();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (activeServer) {
      activeServer.close();
      activeServer = null;
    }
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("will-quit", () => {
    if (activeServer) {
      activeServer.close();
      activeServer = null;
    }
  });
}
