/**
 * اختبارات HTTP حقيقية لصلاحيات مسارات القطاع (ROOT/ADMIN فقط للعمليات).
 * بيشغّل Express على منفذ محلي عشوائي + JWT حقيقي من نفس وحدة المشروع،
 * وقاعدة البيانات بديل كامل في الذاكرة — مافيش أي اتصال قاعدة أو خدمة خارجية.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_sector_authz_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import sectorRoutes from "./sector.routes.js";
import { signToken } from "../../utils/jwt.js";

/* ------------------------------ بديل Prisma ------------------------------ */

(globalThis as any).prisma = {
  // requireAuth → scopeProjectIds للمستخدم العادي
  userProject: { findMany: async () => [] },
  sector: {
    findMany: async () => [],
    findUnique: async () => null,
    findFirst: async () => null,
    create: async () => {
      throw new Error("ما ينفعش نوصل لإنشاء قطاع في اختبارات الصلاحيات");
    },
    update: async () => {
      throw new Error("ما ينفعش نوصل لتعديل قطاع في اختبارات الصلاحيات");
    },
  },
  project: { findUnique: async () => null },
  projectSector: { findUnique: async () => null, findMany: async () => [] },
  dailyLog: { aggregate: async () => ({ _max: { date: null } }), findMany: async () => [] },
};

/* ------------------------------- تطبيق الاختبار ------------------------------- */

const app = express();
app.use(express.json());
app.use("/api/sectors", sectorRoutes);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err?.status ?? 500).json({ message: err?.message ?? "Internal error" });
});

const userToken = signToken({ id: 11, role: "USER", name: "مستخدم" });
const managerToken = signToken({ id: 12, role: "MANAGER", name: "مدير" });
const rootToken = signToken({ id: 1, role: "ROOT", name: "روت" });
const adminToken = signToken({ id: 2, role: "ADMIN", name: "أدمن" });

let server: http.Server;
let base = "";

test.before(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function assertForbidden(result: { status: number; json: any }, label: string) {
  assert.equal(result.status, 403, `${label}: المفروض 403`);
  assert.deepEqual(result.json, { message: "Forbidden" }, `${label}: شكل رد الرفض`);
}

/* --------------------------------- الاختبارات --------------------------------- */

test("بدون توكن: كل عمليات القطاع مرفوضة 401", async () => {
  assert.equal((await call("POST", "/api/sectors", undefined, { name: "قطاع", projectId: 1 })).status, 401);
  assert.equal((await call("PUT", "/api/sectors/1", undefined, { name: "قطاع" })).status, 401);
  assert.equal((await call("DELETE", "/api/sectors/1", undefined)).status, 401);
});

test("USER: ممنوع إنشاء قطاع (POST /sectors) حتى بجسم صحيح", async () => {
  assertForbidden(await call("POST", "/api/sectors", userToken, { name: "قطاع جديد", projectId: 1 }), "POST /sectors");
});

test("USER: ممنوع تعديل/إعادة تسمية قطاع (PUT /sectors/:id)", async () => {
  assertForbidden(await call("PUT", "/api/sectors/1", userToken, { name: "اسم جديد" }), "PUT /sectors/:id");
});

test("USER: ممنوع تغيير ربط قطاع المدرين (PUT /sectors/:id/managers-room)", async () => {
  assertForbidden(
    await call("PUT", "/api/sectors/1/managers-room", userToken, { managersRoomId: 5 }),
    "PUT /sectors/:id/managers-room"
  );
});

test("USER: ممنوع ربط قطاع موجود بمشروع (POST /sectors/:id/projects)", async () => {
  assertForbidden(
    await call("POST", "/api/sectors/1/projects", userToken, { projectId: 2 }),
    "POST /sectors/:id/projects"
  );
});

test("USER: ممنوع فك ارتباط قطاع من مشروع (DELETE /sectors/:id/projects/:projectId)", async () => {
  assertForbidden(
    await call("DELETE", "/api/sectors/1/projects/2", userToken),
    "DELETE /sectors/:id/projects/:projectId"
  );
});

test("USER: ممنوع الحذف النهائي للقطاع (DELETE /sectors/:id)", async () => {
  assertForbidden(await call("DELETE", "/api/sectors/1", userToken), "DELETE /sectors/:id");
});

test("MANAGER: ممنوع كذلك — الإدارة مقصورة على ROOT/ADMIN", async () => {
  assertForbidden(await call("POST", "/api/sectors", managerToken, { name: "قطاع", projectId: 1 }), "MANAGER POST");
});

test("USER: القراءة مسموحة (GET /sectors)", async () => {
  const result = await call("GET", "/api/sectors", userToken);
  assert.equal(result.status, 200, "المفروض القراءة تفضل متاحة للمستخدم");
  assert.ok(Array.isArray(result.json));
});

test("ROOT/ADMIN: بيعدّوا حارس الدور ويوصلوا للتحقق (400 مش 403)", async () => {
  for (const [label, token] of [
    ["ROOT", rootToken],
    ["ADMIN", adminToken],
  ] as const) {
    assert.equal(
      (await call("POST", "/api/sectors", token, {})).status,
      400,
      `${label} POST /sectors: المفروض يوصل لتحقق الحقول`
    );
    assert.equal(
      (await call("PUT", "/api/sectors/1", token, {})).status,
      400,
      `${label} PUT /sectors/:id: المفروض يوصل لتحقق الحقول`
    );
    assert.equal(
      (await call("PUT", "/api/sectors/1/managers-room", token, {})).status,
      400,
      `${label} PUT /sectors/:id/managers-room: المفروض يوصل لتحقق الحقول`
    );
    assert.equal(
      (await call("POST", "/api/sectors/1/projects", token, {})).status,
      400,
      `${label} POST /sectors/:id/projects: المفروض يوصل لتحقق الحقول`
    );
  }
});

test("ROOT/ADMIN: عمليات الحذف بتوصل للسيرفس (404 لأن السجل غير موجود) مش 403", async () => {
  for (const [label, token] of [
    ["ROOT", rootToken],
    ["ADMIN", adminToken],
  ] as const) {
    assert.equal(
      (await call("DELETE", "/api/sectors/1/projects/2", token)).status,
      404,
      `${label} DELETE /sectors/:id/projects/:projectId: المفروض يعدي الحارس`
    );
    assert.equal(
      (await call("DELETE", "/api/sectors/1", token)).status,
      404,
      `${label} DELETE /sectors/:id: المفروض يعدي الحارس`
    );
  }
});
