// إنشاء/تحديث حساب ROOT وحساب ADMIN في قاعدة البيانات
// الاستخدام:
//   node scripts/create-users.mjs                 → يكتب في القاعدة من .env ويطلب كلمات السر في الطرفية
//   node scripts/create-users.mjs --sql           → يطبع أوامر SQL جاهزة للّصق في psql (من غير أي اتصال)
//   node scripts/create-users.mjs --root-name=.. --root-email=.. --admin-name=.. --admin-email=..
// كلمة السر مابتطبعش ومابتخزنش: بتتطلب في الطرفية (النص مخفي) وبتتحوّل bcrypt hash Cost 10 — نفس اللي في auth.service
import "dotenv/config";
import bcrypt from "bcryptjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const sqlMode = args.includes("--sql");

const plan = [
  { key: "root", role: "ROOT", name: flag("root-name") || "مدير النظام", email: flag("root-email") || "root@saraky.com" },
  { key: "admin", role: "ADMIN", name: flag("admin-name") || "المدير", email: flag("admin-email") || "admin@saraky.com" },
];

const MIN_LEN = 8;

function readLineVisible(prompt) {
  if (!process.stdin.isTTY) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0008" || ch === "\u007F") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += ch;
        process.stdout.write(ch);
      }
    };
    process.stdin.on("data", onData);
  });
}

function readLineHidden(prompt) {
  if (!process.stdin.isTTY) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0008" || ch === "\u007F") {
          if (value) {
            value = value.slice(0, -1);
          }
          continue;
        }
        value += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function collect() {
  const out = [];
  for (const acc of plan) {
    const label = acc.role;
    if (process.stdin.isTTY) {
      const name = await readLineVisible(`اسم المستخدم للدخول (${label}) [${acc.name}]: `);
      const email = await readLineVisible(`البريد (${label}) [${acc.email}]: `);
      const password = await readPassword(`كلمة السر (${label}) — ${MIN_LEN} أحرف على الأقل: `);
      out.push({ ...acc, name: name || acc.name, email: email || acc.email, password });
    } else {
      // وضع الأنابيب/CI: كلمة السر من متغيّر بيئة، والاسم والبريد من الأ flags
      const password = process.env[`EFMS_${label}_PASSWORD`];
      if (!password) throw new Error(`بدون طرفية تفاعلية لازم متغيّر البيئة EFMS_${label}_PASSWORD — أو شغّل السكربت من PowerShell مباشرة`);
      if (password.length < MIN_LEN) throw new Error(`EFMS_${label}_PASSWORD أقصر من ${MIN_LEN} أحرف`);
      out.push({ ...acc, password });
    }
  }
  return out;
}

async function readPassword(prompt) {
  let pwd;
  do {
    pwd = await readLineHidden(prompt);
    if (pwd === undefined) throw new Error("لازم السكربت يشتغل في طرفية تفاعلية (PowerShell) أو متغيّر البيئة EFMS_ROOT_PASSWORD / EFMS_ADMIN_PASSWORD");
    if (pwd.length < MIN_LEN) console.log(`قصيرة — الحد الأدنى ${MIN_LEN} حرف`);
  } while (pwd.length < MIN_LEN);
  const again = await readLineHidden("تأكيد كلمة السر: ");
  if (again !== pwd) throw new Error("التأكيد مش مطابق — وقفت من غير كتابة");
  return pwd;
}

const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

function sqlFor(acc, hash) {
  // ON CONFLICT على البريد: إعادة التشغيل بتحدّث الاسم/الدور/كلمة السر بس، مابتكرّش الحساب
  return [
    `INSERT INTO "core"."User" ("name", "email", "password", "role", "active", "createdAt", "updatedAt")`,
    `VALUES (${lit(acc.name)}, ${lit(acc.email)}, ${lit(hash)}, ${lit(acc.role)}, true, now(), now())`,
    `ON CONFLICT ("email") DO UPDATE`,
    `  SET "name" = EXCLUDED."name", "role" = '${acc.role}'::"core"."Role",`,
    `      "password" = EXCLUDED."password", "active" = true, "updatedAt" = now();`,
  ].join("\n");
}

const accounts = await collect();

if (sqlMode) {
  console.log("-- انسخ اللي تحت في psql أو شغّل: psql \"<رابط القاعدة>\" -f users.sql");
  console.log("-- تحذير: الـ hashes دي سرّي — متخزنش الملف في git ومتنشرش الناتج");
  console.log("BEGIN;");
  for (const acc of accounts) {
    console.log(sqlFor(acc, await bcrypt.hash(acc.password, 10)));
  }
  console.log("COMMIT;");
  process.exit(0);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

for (const acc of accounts) {
  const password = await bcrypt.hash(acc.password, 10);
  const saved = await prisma.user.upsert({
    where: { email: acc.email },
    update: { name: acc.name, role: acc.role, password, active: true },
    create: { name: acc.name, email: acc.email, password, role: acc.role, active: true },
  });
  console.log(`${acc.role}: id=${saved.id} الاسم للدخول="${saved.name}" البريد=${saved.email}`);
}

console.log("تم — الدخول بـ «الاسم» مش البريد (Login في auth.service بيدوّر على name).");
await prisma.$disconnect();
