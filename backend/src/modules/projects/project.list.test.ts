/**
 * اختبارات عدد القطاعات في قائمة المشاريع مع نموذج M:N الانتقالي.
 * بديل Prisma في الذاكرة — مافيش قاعدة بيانات ولا سيرفر.
 */
process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/efms_project_list_test";
delete process.env.EFMS_MODE;

import test from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, any>;

interface State {
  projects: Row[];
  sectors: Row[];
  links: Row[];
}

let db: State;

function reset(data: Partial<State> = {}): State {
  db = {
    projects: data.projects ?? [
      { id: 1, code: "A", name: "مشروع أ", description: null },
      { id: 2, code: "B", name: "مشروع ب", description: null },
    ],
    sectors: data.sectors ?? [],
    links: data.links ?? [],
  };
  return db;
}

function projectMatches(row: Row, where: any): boolean {
  if (!where) return true;
  const ands = ([] as any[]).concat(where.AND ?? []);
  for (const cond of ands) {
    if (cond?.id?.in && !cond.id.in.includes(row.id)) return false;
  }
  if (where.OR) {
    const ok = ([] as any[]).concat(where.OR).some((cond: any) => {
      if (cond.name?.contains) return String(row.name).includes(cond.name.contains);
      if (cond.code?.contains) return String(row.code ?? "").includes(cond.code.contains);
      return true;
    });
    if (!ok) return false;
  }
  return true;
}

const prismaMock: any = {
  project: {
    findMany: async ({ where, take }: any = {}) => {
      let rows = db.projects.filter((p) => projectMatches(p, where));
      if (take != null) rows = rows.slice(0, take);
      return rows.map((p) => ({
        ...p,
        _count: {
          equipment: 0,
          // العدد القديم من العلاقة legacy — الخدمة لازم تستبدله
          sectors: db.sectors.filter((s) => s.projectId === p.id).length,
        },
      }));
    },
    count: async ({ where }: any = {}) => db.projects.filter((p) => projectMatches(p, where)).length,
  },
  projectSector: {
    count: async ({ where }: any = {}) =>
      db.links.filter(
        (l) =>
          l.projectId === where.projectId &&
          (where.active === undefined || l.active === where.active)
      ).length,
  },
  sector: {
    count: async ({ where }: any = {}) =>
      db.sectors.filter(
        (s) =>
          s.projectId === where.projectId &&
          !db.links.some((l) => l.sectorId === s.id)
      ).length,
  },
  dailyLog: {
    aggregate: async () => ({ _max: { date: null } }),
    findMany: async () => [],
  },
};

(globalThis as any).prisma = prismaMock;

const service = () => import("./project.service.js");

test("القطاع القديم بلا أي ربط بيتعدّ", async () => {
  reset({
    sectors: [
      { id: 10, projectId: 1, name: "مخازن" },
      { id: 11, projectId: 1, name: "ورشة" },
    ],
  });
  const { list } = await service();
  const result = await list({ page: 1, pageSize: 20 });
  const p1 = result.data.find((p: any) => p.id === 1);
  assert.equal((p1 as any)._count.sectors, 2);
});

test("ربط M:N نشط بيتعدّ", async () => {
  reset({
    sectors: [{ id: 10, projectId: 22, name: "مخازن" }],
    links: [{ id: 1, projectId: 1, sectorId: 10, active: true }],
  });
  const { list } = await service();
  const result = await list({ page: 1, pageSize: 20 });
  const p1 = result.data.find((p: any) => p.id === 1);
  assert.equal((p1 as any)._count.sectors, 1);
});

test("الربط الملغي ما بيتعدّش حتى لو العمود القديم مطابق", async () => {
  reset({
    sectors: [{ id: 10, projectId: 1, name: "مخازن" }],
    links: [{ id: 1, projectId: 1, sectorId: 10, active: false }],
  });
  const { list } = await service();
  const result = await list({ page: 1, pageSize: 20 });
  const p1 = result.data.find((p: any) => p.id === 1);
  assert.equal((p1 as any)._count.sectors, 0);
});

test("نفس القطاع مش بيتعدّ مرتين (ربط نشط + أصل قديم)", async () => {
  reset({
    sectors: [{ id: 10, projectId: 1, name: "مخازن" }],
    links: [{ id: 1, projectId: 1, sectorId: 10, active: true }],
  });
  const { list } = await service();
  const result = await list({ page: 1, pageSize: 20 });
  const p1 = result.data.find((p: any) => p.id === 1);
  assert.equal((p1 as any)._count.sectors, 1);
});

test("نطاق المشاريع محفوظ — مشروع خارج النطاق ما بيظهرش ولا بيأثر على العدّ", async () => {
  reset({
    sectors: [
      { id: 10, projectId: 2, name: "مخازن ب" },
      { id: 11, projectId: 1, name: "مخازن أ" },
    ],
    links: [{ id: 1, projectId: 2, sectorId: 10, active: true }],
  });
  const { list } = await service();
  const result = await list({ page: 1, pageSize: 20, scope: [1] });
  assert.deepEqual(
    result.data.map((p: any) => p.id),
    [1]
  );
  assert.equal((result.data[0] as any)._count.sectors, 1);
  assert.equal(result.total, 1);
});

test("مشروع بلا قطاعات بيرجع صفر", async () => {
  reset();
  const { list } = await service();
  const result = await list({ page: 1, pageSize: 20 });
  const p1 = result.data.find((p: any) => p.id === 1);
  assert.equal((p1 as any)._count.sectors, 0);
});

test("القطاع المشترك بين مشروعين بيتعدّ في كل مشروع مرة واحدة", async () => {
  reset({
    sectors: [{ id: 10, projectId: 1, name: "مخازن مشتركة" }],
    links: [
      { id: 1, projectId: 1, sectorId: 10, active: true },
      { id: 2, projectId: 2, sectorId: 10, active: true },
    ],
  });
  const { list } = await service();
  const result = await list({ page: 1, pageSize: 20 });
  const p1 = result.data.find((p: any) => p.id === 1);
  const p2 = result.data.find((p: any) => p.id === 2);
  assert.equal((p1 as any)._count.sectors, 1);
  assert.equal((p2 as any)._count.sectors, 1);
});
