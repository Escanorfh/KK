// تصدير بيانات PostgreSQL إلى ملف SQL نصي (يشتغل مع أي قاعدة: Neon أو غيرها)
// الاستخدام: node scripts/export-sql.mjs [المسار_الخرج]
// الاتصال من DIRECT_URL (غير مجمّع) لأن PgBouncer بيمنع استعلامات الكاتالوج الطويلة
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL أو DATABASE_URL مفقود");
  process.exit(1);
}

const outFile = process.argv[2] || path.resolve(process.cwd(), "backup.sql");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const q = (sql) => prisma.$queryRawUnsafe(sql);

// ١) الجداول الحقيقية من كل السكيماوات (بدون طاولات Prisma الداخلية وبدوون سكيما النظام)
// multiSchema: الجدوال موزعة على core/ops/log، والفلاتر القديمة كانت 'public' بس فترجع صفر صفوف
const realSchema = (s) => s !== "information_schema" && !s.startsWith("pg_") && s !== "pg_toast";
const tableRows = await q(`
  SELECT table_schema, table_name FROM information_schema.tables
  WHERE table_type = 'BASE TABLE'
    AND table_name NOT LIKE '\\_prisma%'
  ORDER BY table_schema, table_name`);
const found = tableRows
  .map((r) => ({ s: r.table_schema ?? r.tableSchema, t: r.table_name ?? r.tableName }))
  .filter(({ s }) => realSchema(s));
const key = ({ s, t }) => `${s}.${t}`;
const qual = ({ s, t }) => `"${s}"."${t}"`;
const tables = found;

// ٢) أعمدة كل جدول بالترتيب
const colRows = await q(`
  SELECT table_schema, table_name, column_name FROM information_schema.columns
  WHERE table_name NOT LIKE '\\_prisma%'
  ORDER BY table_schema, table_name, ordinal_position`);
const columns = new Map();
for (const r of colRows) {
  const s = r.table_schema ?? r.tableSchema;
  const t = r.table_name ?? r.tableName;
  const c = r.column_name ?? r.columnName;
  if (!realSchema(s) || t.startsWith("_prisma")) continue;
  if (!columns.has(`${s}.${t}`)) columns.set(`${s}.${t}`, []);
  columns.get(`${s}.${t}`).push(c);
}

// ٣) ترتيب الجداول حسب العلاقات: الأب قبل الابن عشان المفاتيح الأجنبية ما تعترضش
const edgeRows = await q(`
  SELECT tc.table_schema AS child_schema, tc.table_name AS child,
         kcu2.table_schema AS parent_schema, kcu2.table_name AS parent
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
  JOIN information_schema.constraint_column_usage kcu2
    ON kcu2.constraint_name = tc.constraint_name AND kcu2.constraint_schema = tc.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'`);
const known = new Set(tables.map(key));
const parents = new Map();
for (const e of edgeRows) {
  const child = key({ s: e.child_schema, t: e.child });
  const parent = key({ s: e.parent_schema, t: e.parent });
  if (!e.child || !e.parent || child === parent) continue;
  if (!known.has(child) || !known.has(parent)) continue;
  if (!parents.has(child)) parents.set(child, new Set());
  parents.get(child).add(parent);
}

const ordered = [];
const state = new Map();
function visit(name, trail) {
  if (state.get(name) === "done") return;
  if (state.get(name) === "open") {
    console.warn(`دورة في العلاقات عند ${name} — بنكمل ونعتمد على TRUNCATE CASCADE`);
    return;
  }
  state.set(name, "open");
  for (const p of parents.get(name) || []) {
    if (!trail.has(p)) visit(p, new Set([...trail, p]));
  }
  state.set(name, "done");
  ordered.push(name);
}
for (const t of tables) visit(key(t), new Set([key(t)]));
const byKey = new Map(tables.map((t) => [key(t), t]));

const lines = [];
lines.push("-- EFMS data export", `-- generated: ${new Date().toISOString()}`, "-- schema: run `npx prisma db push` on the target first", "");
lines.push("SET client_encoding = 'UTF8';", "SET statement_timeout = 0;", "SET client_min_messages = warning;", "");

// ٤) تفريغ الهدف من أول مرة (آمن على قاعدة فاضية)
lines.push(`TRUNCATE TABLE ${ordered.map((k) => qual(byKey.get(k))).join(", ")} RESTART IDENTITY CASCADE;`, "");
lines.push("BEGIN;");

let totalRows = 0;
const stats = [];
for (const k of ordered) {
  const table = byKey.get(k);
  const cols = columns.get(k) || [];
  if (!cols.length) continue;
  const qualified = qual(table);
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const quoted = cols.map((c) => `quote_nullable("${c}")`).join(", ");
  const rows = await q(
    `SELECT 'INSERT INTO ${qualified} (${colList}) VALUES (' || array_to_string(ARRAY[${quoted}], ', ') || ');' AS stmt FROM ${qualified}`
  );
  const stmts = rows.map((r) => r.stmt).filter(Boolean);
  stats.push([k, stmts.length]);
  totalRows += stmts.length;
  if (stmts.length) lines.push(`-- ${k}: ${stmts.length} rows`, ...stmts, "");
}
lines.push("COMMIT;", "");

// ٥) إرجاع عدادات serial بعد الإدراج بقيم صريحة
for (const k of ordered) {
  const table = byKey.get(k);
  const seqCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='${table.s}' AND table_name='${table.t}' AND column_default LIKE 'nextval%'`);
  for (const r of seqCols) {
    const c = r.column_name ?? r.columnName;
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${qual(table)}', '${c}'), ` +
        `(SELECT COALESCE(MAX("${c}"), 1) FROM ${qual(table)}), ` +
        `(SELECT COUNT(*) > 0 FROM ${qual(table)}));`
    );
  }
}

fs.writeFileSync(outFile, lines.join("\n"), "utf8");

const sizeMb = (fs.statSync(outFile).size / 1048576).toFixed(2);
console.log(`ملف: ${outFile}`);
console.log(`الحجم: ${sizeMb} MB | الجداول: ${stats.length} | الصفوف: ${totalRows}`);
for (const [t, n] of stats.sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(7)}  ${t}`);
await prisma.$disconnect();
