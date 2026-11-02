import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./modules/auth/auth.routes";
import userRoutes from "./modules/users/user.routes";
import projectRoutes from "./modules/projects/project.routes";
import sectorRoutes from "./modules/sectors/sector.routes";
import equipmentRoutes from "./modules/equipments/equipment.routes";
import dailylogRoutes from "./modules/dailylogs/dailylog.routes";
import maintenanceRoutes from "./modules/maintenance/maintenance.routes";
import partScheduleRoutes from "./modules/part-schedules/partSchedule.routes";
import oilConsumptionRoutes from "./modules/oil-consumptions/oilConsumption.routes";
import faultRoutes from "./modules/faults/fault.routes";
import repairOrderRoutes from "./modules/repair-orders/repairOrder.routes";
import needRequestRoutes from "./modules/need-requests/needRequest.routes";
import dashboardRoutes from "./modules/dashboard/dashboard.routes";
import dataRoutes from "./modules/data/data.routes";
import cronRoutes from "./modules/cron/cron.routes";
import prisma from "./config/prisma";
import { Prisma } from "@prisma/client";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDbConnectionError } from "./utils/db";

const app = express();

// CORS_ORIGIN قائمة مفصولة بفواصل: واجهة Vercel + التطبيق المحلي + نسخة سطح المكتب
// بدون قيمة: نردّ نفس الأصل المطلوب (يشمل http://127.0.0.1:43124 بتاع الـ .exe)
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true }));
app.use(express.json({ limit: "12mb" }));
app.use(morgan("dev"));

// بيانات أي قائمة بتتغير لحظة الحفظ، وكاش HTTP (خاصة في تطبيق الـ .exe) بيخدم نسخة قديمة
app.set("etag", false);
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// فحص قاعدة البيانات منفصل عن فحص السيرفر: Neon النائم بياخد ثواني عشان يصحى
// اللوج الكامل في سجل المنصة بس — الرد العام مفيهوش عنوان اتصال ولا كلمة سر

// Wasmer ما بيديناش سطر اللوج الموسّع، فالـ presence بس هو التشخيص: المتغيّرات اتشالت ولا لأ،
// وأسماء/أحجام ملفات الـ engine الموجودة فعلًا في صورة التشغيل. مفيش أي قيمة سرية في الرد.
function engineFiles(dir: string): { name: string; bytes: number }[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => /engine/i.test(name) && !/\.tmp\d+$/.test(name))
    .slice(0, 10)
    .map((name) => {
      try {
        return { name, bytes: statSync(path.join(dir, name)).size };
      } catch {
        return { name, bytes: -1 };
      }
    });
}

function runtimeProbe() {
  const root = process.cwd();
  const generated = path.join(root, "node_modules", ".prisma", "client");
  const packaged = path.join(root, "node_modules", "@prisma", "engines");
  let version = "unknown";
  try {
    version = Prisma.prismaVersion.client;
  } catch {
    /* client غير مولّد */
  }
  return {
    env: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      DIRECT_URL: Boolean(process.env.DIRECT_URL),
      PRISMA_QUERY_ENGINE_LIBRARY: Boolean(process.env.PRISMA_QUERY_ENGINE_LIBRARY),
    },
    runtime: { platform: os.platform(), arch: os.arch(), node: process.version },
    prismaClient: version,
    generatedClient: { exists: existsSync(generated), engines: engineFiles(generated) },
    packagedEngines: { exists: existsSync(packaged), engines: engineFiles(packaged) },
  };
}

app.get("/api/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ db: "ok" });
  } catch (err) {
    const e = err as { code?: string; errorCode?: string };
    const message = err instanceof Error ? err.message : String(err);
    console.error("health/db:", e.code || e.errorCode || "-", message);
    const body: {
      db: "error";
      code: string;
      errorType: string;
      probe?: ReturnType<typeof runtimeProbe>;
      detail?: string;
    } = {
      db: "error",
      code: e.code || e.errorCode || "SEE_LOG",
      errorType: err instanceof Error ? err.constructor.name : "unknown",
      probe: runtimeProbe(),
    };
    // HEALTH_DEBUG=1 يكشف النص من المتصفح بدل سجل المنصة، بعد حجب أي "مستخدم:كلمة_سر@" أو password=
    if (process.env.HEALTH_DEBUG === "1") {
      body.detail = message
        .replace(/([a-z]+:\/\/)[^\s@"']+@/gi, "$1***@")
        .replace(/password=[^\s&"']+/gi, "password=***")
        .replace(/\s+/g, " ")
        .slice(0, 400);
    }
    res.status(503).json(body);
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/sectors", sectorRoutes);
app.use("/api/equipments", equipmentRoutes);
app.use("/api/dailylogs", dailylogRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/part-schedules", partScheduleRoutes);
app.use("/api/oil-consumptions", oilConsumptionRoutes);
app.use("/api/faults", faultRoutes);
app.use("/api/repair-orders", repairOrderRoutes);
app.use("/api/need-requests", needRequestRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/cron", cronRoutes);

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ message: "المسار غير موجود" });
  }
  res.status(404).json({
    message:
      "هذا خادم EFMS الخلفي (API) — افتح الواجهة على http://localhost:5173",
    health: "/api/health",
  });
});

app.use(
  (err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);

    if (isDbConnectionError(err)) {
      return res.status(503).json({
        message: "تعذّر الاتصال بقاعدة البيانات — أعد المحاولة بعد لحظات",
      });
    }

    if (err.status && err.status !== 500) {
      return res.status(err.status).json({ message: err.message });
    }

    res.status(500).json({ message: "حدث خطأ غير متوقع في الخادم" });
  }
);

export default app;
