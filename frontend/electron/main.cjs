// نقطة تشغيل تطبيق سطح المكتب: يقدّم مجلد dist/ عبر خادم محلي ثم يفتحه في نافذة Electron
// نستخدم خادم HTTP بدل file:// لأن التوجيه يعتمد على BrowserRouter ومسارات الأصول المطلقة
const { app, BrowserWindow, Menu, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");

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
  if (target !== DIST && !target.startsWith(DIST + path.sep)) {
    return send(res, 403, "forbidden", "text/plain; charset=utf-8");
  }

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return send(res, 200, readFileSafe(target), MIME[path.extname(target).toLowerCase()] || "application/octet-stream");
  }

  // أروضة الـ SPA: أي مسار غير ملف حقيقي يرجّع الصفحة الرئيسية
  const index = readFileSafe(path.join(DIST, "index.html"));
  if (!index) {
    return send(res, 500, "لم يتم بناء الواجهة — شغّل npm run build قبل تشغيل التطبيق", "text/plain; charset=utf-8");
  }
  return send(res, 200, index, MIME[".html"]);
}

/**
 * منفذ ثابت قدر الإمكان: التخزين المحلي (token + عنوان السيرفر + طابور الأوفلاين) مرتبط بـ origin،
 * ومنفذ عشوائي يعني بداية جهاز فارغ كل تشغيل.
 */
const PREFERRED_PORTS = [43124, 43125, 43126, 43127];

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(server);
    });
  });
}

async function startServer() {
  const server = http.createServer(handler);
  for (const port of PREFERRED_PORTS) {
    try {
      await listenOn(server, port);
      return server;
    } catch {
      // منفذ مشغول: جرّب التالي
    }
  }
  return listenOn(server, 0);
}

let mainWindow = null;

async function createWindow() {
  const server = await startServer().catch((err) => {
    dialogError(`تعذّر تشغيل خادم الواجهة المحلي: ${err.message}`);
    throw err;
  });
  const entry = `http://127.0.0.1:${server.address().port}/`;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#0f172a",
    title: "EFMS — متابعة المعدات والصيانة",
    icon: path.join(DIST, "pwa-512x512.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: link }) => {
    shell.openExternal(link);
    return { action: "deny" };
  });
  await mainWindow.loadURL(entry);
  mainWindow.on("closed", () => {
    mainWindow = null;
    server.close();
  });
}

function dialogError(message) {
  const { dialog } = require("electron");
  if (app.isReady()) dialog.errorBox({ title: "EFMS", message });
  else app.once("ready", () => dialog.errorBox({ title: "EFMS", message }));
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
    void createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
