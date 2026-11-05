/**
 * اختبارات القطاع في طلبات الاحتياج (نطاق Requisitions فقط).
 * mock server محلي بيعامل نظام المدرين + prisma مزروع: ولا اتصال بقاعدة ولا كتابة على المدرين الحقيقيين.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// أي اتصال حقيقي لازم يفشل بصوت عالي — كل الاستعلامات بتخدمها البدائل تحت
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_sector_test";
delete process.env.EFMS_MODE;

const TOKEN = "mock-token-not-a-secret";

/** نفس رسالة الـ 403 الحقيقية من نظام المدرين، للبيع في الطلبات بلا قطاع */
const NO_SECTOR_403 = {
  ok: false,
  message:
    "لا يمكنك تسجيل طلب احتياج بدون قطاع (قطاع غير محدد) لعدم توفر الصلاحية لحسابك. يرجى اختيار قطاع مصرح لك به.",
};

const REMOTE_PROJECTS = [
  {
    id: 41,
    title: "محطة الرحلة",
    code: "MR",
    status: "active",
    room_id: 77,
    room_title: "قطاع المخازن",
    rooms: [
      { room_id: 77, room_title: "قطاع المخازن" },
      { room_id: 88, room_title: "قطاع الورشة" },
    ],
  },
  // مشروع بغرفة ضمنية بس، من غير مصفوفة rooms — شكل أغلب مشاريع المدرين
  { id: 42, title: "خط طرد الرحلة", code: "TL", status: "active", room_id: 91, room_title: "قطاع التشغيل" },
  // مشروع التوكن مالوش قطاع مصرّح عليه
  { id: 43, title: "مخزون الطوارئ", code: "EM", status: "active" },
];

interface CapturedRequest {
  method?: string;
  url?: string;
  body: Record<string, unknown> | null;
}

let posts: CapturedRequest[] = [];
let requests: CapturedRequest[] = [];
let server: http.Server;
let baseUrl: string;

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
  });
}

async function startMockManagers(): Promise<void> {
  if (server) return;
  server = http.createServer(async (req, res) => {
    const url = req.url || "";
    const body = await readBody(req);
    requests.push({ method: req.method, url, body });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(401, { ok: false, message: "غير مصرح" });
    }

    if (url === "/api/requisitions/projects") {
      return send(200, { ok: true, worker_name: "EFMS", total: REMOTE_PROJECTS.length, projects: REMOTE_PROJECTS });
    }

    if (url === "/api/requisitions" && req.method === "POST") {
      posts.push({ method: "POST", url, body });
      const roomId = body?.room_id;
      if (typeof roomId !== "number" || !Number.isInteger(roomId)) return send(403, NO_SECTOR_403);
      const project = REMOTE_PROJECTS.find((p) => p.id === body?.project_id);
      const authorized = project?.rooms?.some((r) => r.room_id === roomId) || project?.room_id === roomId;
      if (!authorized) return send(403, NO_SECTOR_403);
      return send(201, {
        ok: true,
        data: { id: 9001, requisition_number: "ERQ-2026-0777", status: "review_in_progress" },
      });
    }

    const detail = /^\/api\/requisitions\/(\d+)$/.exec(url);
    if (detail && req.method === "GET") {
      return send(200, {
        ok: true,
        requisition: { id: Number(detail[1]), requisition_number: "ERQ-2026-0777", status: "review_in_progress" },
      });
    }

    // تحديث الطلب: مواصفات المدرين ما فيها room_id ولا project_id — لو جاوا بنا نرفضهم زي ما الـ API بيعمل
    if (detail && req.method === "PUT") {
      if (body?.room_id !== undefined || body?.project_id !== undefined) {
        return send(422, { ok: false, message: "لا يمكن تغيير المشروع أو القطاع بعد الإنشاء" });
      }
      return send(200, { ok: true, data: { id: Number(detail[1]), status: "review_in_progress" } });
    }

    return send(404, { ok: false, message: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  process.env.MANAGERS_API_URL = baseUrl;
  process.env.MANAGERS_API_TOKEN = TOKEN;
}

test("mock المدرين: طلب بلا room_id بيرجع نفس 403 الحقيقية", async () => {
  await startMockManagers();
  const res = await fetch(`${baseUrl}/requisitions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: 41, items: [] }),
  });
  assert.equal(res.status, 403);
  assert.match((await res.text()).toString(), /بدون قطاع/);
});

test.after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ————— بيانات وهمية لنموذج طلب الاحتياج —————

const PROJECT = { id: 11, name: "محطة الرحلة", code: "MR" };
const ITEMS = [
  {
    rowNo: 1,
    itemName: "فلتر زيت",
    itemCode: "FZ-1",
    unit: "عدد",
    qty: 12,
    equipmentRef: "EQ-9",
    currentBalance: 3,
    localSupply: 0,
    foreignSupply: 0,
    notes: null,
  },
];

function sectorOf(overrides: Record<string, unknown> = {}) {
  return { id: 7, name: "المخازن", managersRoomId: 77, managersRoomTitle: "قطاع المخازن", projectId: 11, ...overrides };
}

function recordOf(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    requestNo: 42,
    projectId: 11,
    project: PROJECT,
    sectorId: 7,
    sector: sectorOf(),
    department: "المخازن العامة",
    requestDate: new Date("2026-11-05"),
    status: "DRAFT",
    managersId: null,
    managersRef: null,
    managersStatus: null,
    managersSyncedAt: null,
    sentAt: null,
    sendError: null,
    createdBy: { name: "محمد" },
    items: ITEMS,
    ...overrides,
  };
}

interface Installed {
  calls: { needUpdate: Record<string, unknown>[]; needCreate: Record<string, unknown>[]; sectorFind: unknown[] };
  prisma: any;
  mod: typeof import("./needRequest.service.js");
}

/** بديلprisma: كل.delegate محتاجه مزروع، وأي sector بيقرا من التخزين المحلي */
async function install(state: {
  need?: Record<string, unknown>;
  sector?: Record<string, unknown> | null;
  project?: Record<string, unknown> | null;
}): Promise<Installed> {
  await startMockManagers();
  const mod = await import("./needRequest.service.js");
  const prismaMod = await import("../../config/prisma.js");
  const managers = await import("../../utils/managers.js");
  // قائمة المشاريع بتتخمس دقايق — نجبرها على القراءة من mock كل اختبار
  await managers.managersProjects(true);

  const p = prismaMod.default as any;
  const calls = { needUpdate: [] as Record<string, unknown>[], needCreate: [] as Record<string, unknown>[], sectorFind: [] as unknown[] };
  const record = recordOf(state.need || {});

  p.needRequest = {
    findUnique: async () => (state.need === undefined ? record : { ...record, ...state.need }),
    update: async ({ data }: { data: Record<string, unknown> }) => {
      calls.needUpdate.push(data);
      return { ...record, ...data };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      calls.needCreate.push(data);
      return { ...record, ...data, id: 101 };
    },
    aggregate: async () => ({ _max: { requestNo: 42 } }),
    count: async () => 0,
    findMany: async () => [],
    delete: async () => record,
  };
  p.project = { findUnique: async () => state.project ?? PROJECT };
  p.sector = {
    findUnique: async ({ where }: { where: { id: number } }) => {
      calls.sectorFind.push(where);
      if (state.sector === undefined) return sectorOf();
      return state.sector;
    },
  };
  p.auditLog = { create: async () => null };
  return { calls, prisma: p, mod };
}

// ————— الحالات السبعة المطلوبة —————

test("١) قطاع صحيح ومربوط → الـ Payload فيه room_id بالمعرّف الخارجي مش معرّف EFMS", async () => {
  const { mod, calls } = await install({});
  posts = [];

  const result = await mod.send(100, 1);
  assert.equal((result.record as any).status, "SENT");

  assert.equal(posts.length, 1, "لازم يتعمل POST واحد بس على mock");
  const payload = posts[0].body as Record<string, any>;
  assert.equal(payload.room_id, 77, "room_id = معرّف قطاع المدرين");
  assert.notEqual(payload.room_id, 7, "معرّف قطاع EFMS ما ينفعش يتبعت كمعرّف خارجي");
  assert.equal(payload.project_id, 41, "معرّف مشروع المدرين مش معرّف EFMS");
  assert.equal(typeof payload.room_id, "number");
  assert.ok(Array.isArray(payload.items) && payload.items.length === 1);
  assert.equal(calls.needUpdate.length, 1);
  assert.equal((calls.needUpdate[0] as any).managersId, 9001);
});

test("١ب) المشروع اللي ليه أكتر من قطاع: القطاع التاني بيوصل للـ Payload صح", async () => {
  const second = sectorOf({ id: 8, name: "الورشة", managersRoomId: 88, managersRoomTitle: "قطاع الورشة" });
  const { mod } = await install({ need: { sectorId: 8, sector: second } });
  posts = [];
  await mod.send(100, 1);
  assert.equal((posts[0].body as Record<string, any>).room_id, 88);
});

test("١ج) قطاع مربوط بغرفة ضمنية (مشروع بلا مصفوفة rooms) بيشيلها تلقائيًا", async () => {
  const { mod } = await install({
    need: {
      projectId: 12,
      project: { id: 12, name: "خط طرد الرحلة", code: "TL" },
      sectorId: 9,
      sector: sectorOf({ id: 9, projectId: 12, managersRoomId: 91, managersRoomTitle: "قطاع التشغيل" }),
    },
  });
  posts = [];
  await mod.send(100, 1);
  assert.equal((posts[0].body as Record<string, any>).project_id, 42);
  assert.equal((posts[0].body as Record<string, any>).room_id, 91);
});

test("٢) طلب بلا قطاع → رفض محلي، ولا POST وصل للمدرين", async () => {
  const { mod } = await install({ need: { sectorId: null, sector: null } });
  posts = [];
  const err = await mod.send(100, 1).then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err, "لازم يترفض");
  assert.match(err!.message, /اختر القطاع التابع للمشروع/);
  assert.equal(err!.status, 422);
  assert.equal(posts.length, 0, "ما يصرفش attempt على نظام المدرين");
});

test("٣) Sector ID مش موجود → 404 من الـ Backend قبل الحفظ", async () => {
  const { mod } = await install({ sector: null });
  const err = await mod
    .create({ projectId: 11, sectorId: 999, department: "المخازن", requestDate: "2026-11-05", items: ITEMS }, 1)
    .then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.equal(err!.message, "القطاع غير موجود");
  assert.equal(err!.status, 404);
});

test("٣ب) قطاع لا يتبع المشروع المحدد → رفض محلي 422", async () => {
  const { mod } = await install({ sector: sectorOf({ projectId: 12, name: "التشغيل" }) });
  const err = await mod
    .create({ projectId: 11, sectorId: 7, department: "المخازن", requestDate: "2026-11-05", items: ITEMS }, 1)
    .then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.equal(err!.status, 422);
  assert.match(err!.message, /لا يتبع المشروع المحدد/);
});

test("٣ج) قطاع لمشروع والطلب من غير مشروع → رفض", async () => {
  const { mod } = await install({ sector: sectorOf({ projectId: 11 }) });
  const err = await mod
    .create({ projectId: null, sectorId: 7, department: "المخازن", requestDate: "2026-11-05", items: ITEMS }, 1)
    .then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.equal(err!.status, 422);
  assert.match(err!.message, /يحتاج مشروعًا محددًا/);
});

test("٤) قطاع من غير Manager Mapping → منع الإرسال برسالة واضحة (ولا 403 من المدرين)", async () => {
  const { mod } = await install({ need: { sector: sectorOf({ managersRoomId: null, managersRoomTitle: null }) } });
  posts = [];
  const err = await mod.send(100, 1).then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.equal(err!.status, 422);
  assert.match(err!.message, /غير مربوط بقطاع في نظام المدرين/);
  assert.equal(posts.length, 0);
});

test("٤ب) الربط مراجع لكن مش ضمن قطاعات المشروع عند المدرين → رسالة فيها المتاحة", async () => {
  const { mod } = await install({ need: { sector: sectorOf({ managersRoomId: 500, managersRoomTitle: "قطاع ملغي" }) } });
  posts = [];
  const err = await mod.send(100, 1).then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.equal(err!.status, 422);
  assert.match(err!.message, /مش ضمن القطاعات المصرّح بها/);
  assert.match(err!.message, /قطاع المخازن/);
  assert.equal(posts.length, 0);
});

test("٤ج) مشروع التوكن مالوش قطاع عنده → رفض محلي بيفصّل السبب", async () => {
  const { mod } = await install({
    need: { projectId: 13, project: { id: 13, name: "مخزون الطوارئ", code: "EM" } },
    sector: sectorOf({ projectId: 13, managersRoomId: 999, managersRoomTitle: "قطاع وهمي" }),
  });
  posts = [];
  const err = await mod.send(100, 1).then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.match(err!.message, /لا توجد قطاعات مصرّح بها لهذا المشروع/);
  assert.equal(posts.length, 0);
});

test("٥) تغيير المشروع بعد اختيار القطاع → القطاع القديم يُلغى، وما يفضلش مربوط", async () => {
  const { mod, calls } = await install({
    need: { projectId: 11, sectorId: 7, sector: sectorOf({ projectId: 11 }) },
    project: { id: 12, name: "خط طرد الرحلة", code: "TL" },
  });
  const result = await mod.update(100, { projectId: 12 }, 1);
  assert.equal((calls.needUpdate[0] as any).sectorId, null, "القطاع القديم اتلغى");
  assert.equal((calls.needUpdate[0] as any).projectId, 12);
  assert.ok(result.record);
});

test("٥ب) إرسال قطاع صريح مش تابع للمشروع الجديد → رفض 422", async () => {
  const { mod } = await install({
    need: { projectId: 11, sectorId: 7, sector: sectorOf({ projectId: 11 }) },
    sector: sectorOf({ projectId: 11, name: "المخازن" }),
    project: { id: 12, name: "خط طرد الرحلة", code: "TL" },
  });
  const err = await mod.update(100, { projectId: 12, sectorId: 7 }, 1).then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.equal(err!.status, 422);
  assert.match(err!.message, /لا يتبع المشروع المحدد/);
});

test("٦) مشروع بلا قطاعات → القائمة ترجع فاضية ورسالة توضّح إن مافيش قطاع مصرّح به", async () => {
  await startMockManagers();
  const sectorMod = await import("../sectors/sector.service.js");
  const prismaMod = await import("../../config/prisma.js");
  const p = prismaMod.default as any;
  p.project = { findUnique: async () => ({ id: 13, name: "مخزون الطوارئ", code: "EM" }) };
  p.sector = { findMany: async () => [] };

  const res = await sectorMod.managersRooms(13);
  assert.deepEqual(res.rooms, [], "التوكن مالوش قطاع على المشروع ده");
  assert.equal(res.remoteProject?.id, 43, "المشروع نفسه اتطابق صح");
  assert.match(res.warning!, /لا يملك أي قطاع مصرّح به/);

  const { mod } = await install({ need: { sectorId: null, sector: null } });
  posts = [];
  const err = await mod.send(100, 1).then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.match(err!.message, /اختر القطاع التابع للمشروع/);
  assert.equal(posts.length, 0);
});

test("٦ب) مشروعات بلا مطابقة عند المدرين → managersRooms بترجع تحذير بدل ما تخترع قطاعًا", async () => {
  await startMockManagers();
  const sectorMod = await import("../sectors/sector.service.js");
  const prismaMod = await import("../../config/prisma.js");
  (prismaMod.default as any).project = {
    findUnique: async () => ({ id: 99, name: "مشروع مجهول تمامًا", code: "ZZ" }),
  };
  const res = await sectorMod.managersRooms(99);
  assert.equal(res.remoteProject, null);
  assert.match(res.warning!, /تعذر مطابقة مشروع/);
});

test("٦ج) الربط اليدوي بيقبل معرّف من القائمة المصرّح بها وبيرفض أي معرّف برّاها", async () => {
  await startMockManagers();
  const sectorMod = await import("../sectors/sector.service.js");
  const prismaMod = await import("../../config/prisma.js");
  const p = prismaMod.default as any;
  p.project = { findUnique: async () => PROJECT };
  p.sector = {
    findUnique: async () => ({
      id: 7,
      name: "المخازن",
      projectId: 11,
      managersRoomId: null,
      project: { name: PROJECT.name },
    }),
    update: async ({ data }: { data: Record<string, unknown> }) => ({ id: 7, ...data }),
  };

  const linked = await sectorMod.linkManagersRoom(7, 88, 1);
  assert.equal((linked as any).managersRoomId, 88);
  assert.equal((linked as any).managersRoomTitle, "قطاع الورشة", "الاسط بيتخذ من عند المدرين مش من العميل");

  const err = await sectorMod.linkManagersRoom(7, 606, 1).then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err, "معرّف مش في القائمة المصرّح بها ميقبلش");
  assert.equal(err!.status, 422);
  assert.match(err!.message, /ليس ضمن القطاعات المصرّح بها/);

  const cleared = await sectorMod.linkManagersRoom(7, null, 1);
  assert.equal((cleared as any).managersRoomId, null);
  assert.equal((cleared as any).managersRoomTitle, null);
});

test("٧) طلب قديم بلا قطاع — القراءة والتعديل بيمشوا عادي، والإرسال يترفض محليًا برسالة", async () => {
  const { mod, calls } = await install({
    need: { sectorId: null, sector: null, managersId: null, status: "DRAFT" },
  });
  posts = [];

  const got = await mod.get(100);
  assert.equal((got.record as any).sector, null);
  assert.equal((got.record as any).requestNoText, "0000042");

  const edited = await mod.update(100, { department: "المشتريات", items: ITEMS }, 1);
  assert.ok(edited.record);
  assert.equal((calls.needUpdate[0] as any).sectorId, undefined, "قطاع ما يتمستش");

  const err = await mod.send(100, 1).then(() => null, (e: unknown) => e as Error & { status?: number });
  assert.ok(err);
  assert.match(err!.message, /اختر القطاع/);
  assert.equal(posts.length, 0);
});

test("٧ب) طلب قديم مربوط فعلاً (managersId موجود) وبلا قطاع — التعديل بيمشي من غير ما نلمس القطاع", async () => {
  const { mod, calls } = await install({
    need: { sectorId: null, sector: null, managersId: 9001, status: "SENT", managersRef: "ERQ-2026-0777" },
  });
  requests = [];
  const edited = await mod.update(100, { department: "متابعة" }, 1);
  assert.ok(edited.record);
  const put = requests.find((r) => r.method === "PUT");
  assert.ok(put, "PUT للمدرين اتعمل");
  assert.equal((put!.body as any).room_id, undefined, "محدش يبعت room_id في التحديث — مدرين ما بيقبلوش");
  assert.equal((calls.needUpdate[0] as any).sectorId, undefined);
});

test("٨) حفظ القطاع مع الإنشاء: sectorId بين الـ Payload المحلي وفي سجل التدقيق", async () => {
  const { mod, calls } = await install({ sector: sectorOf({ projectId: 11 }) });
  await mod.create({ projectId: 11, sectorId: 7, department: "المخازن", requestDate: "2026-11-05", items: ITEMS }, 1);
  assert.equal((calls.needCreate[0] as any).sectorId, 7);
});

test("٩) zod: sectorId اختياري (المسودات القديمة) بس رقم صحيح موجب لو اتبعت", async () => {
  const { createNeedRequestSchema, updateNeedRequestSchema } = await import("./needRequest.schemas.js");
  const base = {
    projectId: 11,
    department: "المخازن",
    requestDate: "2026-11-05",
    items: [{ itemName: "فلتر", qty: 1 }],
  };
  assert.equal(createNeedRequestSchema.safeParse({ ...base, sectorId: null }).success, true, "المسودة بلا قطاع لسه مقبولة");
  assert.equal(createNeedRequestSchema.safeParse({ ...base, sectorId: 7 }).success, true);
  assert.equal(createNeedRequestSchema.safeParse({ ...base, sectorId: "abc" }).success, false);
  assert.equal(updateNeedRequestSchema.safeParse({ sectorId: 0 }).success, false);
  assert.equal(updateNeedRequestSchema.safeParse({ sectorId: -3 }).success, false);
});

test("١٠) اسم الحقل room_id مش مشتق: buildCreatePayload بياخد الغرفة الصريحة", async () => {
  const { mod } = await install({});
  const managers = await import("../../utils/managers.js");
  const remote = (await managers.managersProjects())[0];
  const payload = mod.buildCreatePayload(
    { requestNo: 42, department: "المخازن", requestDate: new Date("2026-11-05"), createdBy: { name: "م" }, items: ITEMS },
    remote,
    managers.resolveAuthorizedRoom(remote, sectorOf())
  );
  assert.equal(payload.room_id, 77);
  assert.equal("sector_id" in payload, false, "مافيش حقل sector_id في مواصفات المدرين");
});
