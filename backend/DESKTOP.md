# DESKTOP — وضعان تشغيل، عميلان، ومسار واحد لكل واحد

نسخة **Web/Vercel** ونسخة **Desktop Offline** بيتشاركو نفس الكود وبنفس الـ routes، وبيختلفوا في طبقة البيانات فقط.

## ١) أمر توليد كل عميل

| الوضع | ملف الـ schema | أمر التوليد | مكان العميل المولّد |
|---|---|---|---|
| `web` (الإنتاج، Vercel) | `prisma/schema.prisma` — PostgreSQL + `core/ops/log` | `npm run db:generate` (أو `build:deploy`، و`postinstall`) | `node_modules/.prisma/client` ← **ممنوع لمسه من مسار Desktop** |
| `desktop` (SQLite) | `prisma/desktop.prisma` — SQLite، من غير schemas | `npm run desktop:generate` | `node_modules/@efms/desktop-prisma` |
| تحقق من الـ schema المحلي | `prisma/desktop.prisma` | `npm run desktop:validate` | — |

`postinstall` بيولّد العميل الإنتاجي **فقط**. العميل المحلي متعمّدش إنه يكون جزء منه عشان `npm ci` على Vercel ما يصرفش وقت ولا يفشل لو ملف Desktop اتغيّر. تغليف Desktop (TASK 07) لازم يستدعي `npm run desktop:generate` صراحةً.

## ٢) اختيار الوضع صريح ومش متخيَّن

`src/config/runtimeMode.ts` هو المصدر الوحيد:

| المتغير | القيمة | اللي بيحصل |
|---|---|---|
| *(مش موجود)* أو `web` | الوضع الافتراضي | عميل PostgreSQL — سلوك Vercel الحالي بالضبط، و`DATABASE_URL` مطلوب |
| `desktop` | سطح المكتب | عميل SQLite — `EFMS_SQLITE_DIR` مطلوب، و**مفيش أي اتصال بـ PostgreSQL** |
| أي قيمة تانية | — | التطبيق بيقع برسالة `EFMS_MODE غير صالح` (مافيش وضع بين الوضعين) |

- `EFMS_MODE=desktop` لازم يضبطه Electron main process حين يشغّل الـ API المحلي (TASK 04)، مش المستخدم.
- `EFMS_SQLITE_DIR` = مسار بيانات المستخدم (`app.getPath('userData')`). القاعدة **ما بتتحطش** جوه مجلد التثبيت ولا جوه `asar`. المسار النهائي دايمًا `<EFMS_SQLITE_DIR>/efms.db`.
- الاستنتاج من اسم مضيف أو من وجود متغيرات تانية ممنوع — الغلط فيه يعني قاعدة سحابية بتتكتب من جهاز ميداني.

## ٣) حدود النوع والفصل

- `@prisma/client` (الإنتاجي) هو **مصدر الأنواع الوحيد** في كل الـ 23 ملف اللي بيفيدوا `config/prisma` أو `Prisma.<Model>WhereInput`. عميل Desktop بيُحمّل بـ `require` ديناميكي داخل `src/config/prisma.ts` بس.
- **ممنوع** أي استيراد ثابت مثل `import { PrismaClient } from "@efms/desktop-prisma"` في أي ملف داخل `src/`: هيمنع `npm run build` على Vercel من ما دام عميل Desktop اتولّدش. الفصل محكوم بقاعدة استيراد واحدة، والنقطة اللي بعدها (`config/prisma.ts`) هي الحد الفاصل.
- عميل Desktop بيتلف بفوق `src/config/desktopCompat.ts` (بروكسي) فبيفضل مطابق لتوقيع العميل الإنتاجي، و`$transaction` التفاعلية بتستلم نفس التغليف.

## ٤) نتائج Preflight المقيسة (Prisma 5.22 + SQLite 3.45، قاعدة مؤقتة برّه المستودع)

| السلوك | النتيجة المقيسة |
|---|---|
| `mode: "insensitive"` (55 موضع) | **ارفض** بـ `PrismaClientValidationError` — «Unknown argument `mode`» |
| `contains`/`startsWith`/`endsWith` من غير `mode` | ✅ Latin غير حساس للحالة (LIKE) — نفس نتيجة PostgreSQL عند البحث |
| `equals` على عربي | ✅ مطابق حرفيًا، والشدة جزء من المفتاح (سلوك `LOWER()` نفسه في PG) |
| `equals` مع `COLLATE NOCASE` على العمود | ✅ `equals: "generator truck"` بيلقى `Generator Truck` — تعويض كامل لسلوك PG في تسجيل الدخول |
| `enum` / `String[]` / `Json` / `@db.Date` / `@db.Text` / `@@schema` | **كلها مرفوضة** على SQLite؛ المحولة في `desktop.prisma` لـ `String` بنفس القيم الحرفية، و`codePrefixes`/`details`/`createdIds` بقت نص JSON |
| `createMany` | ✅ شغال · `createMany + skipDuplicates` | ❌ مرفوض (مكانه في `scripts/` مش في `src/`) |
| `PRAGMA foreign_keys` الافتراضي من Prisma | `1` — والـ `onDelete: Cascade` بيمشي صح (متقاس بحذف أب وعداد الأيتام = 0) |
| `nextval`/sequences | ❌ مرفوض — `requestNo` محتاج بديل في TASK 02 |

**التعارض الجديد اللي طلع من القياس:** مع `COLLATE NOCASE`، قيد التفرد بيبقى **أشد** من PostgreSQL (`Nour@x` و`nour@x` هيرجعوا `P2002`). مقبول ومنطقي لبريد وحساب محلي، ولازم يتوثّق في TASK 02 وقت بناء الـ DDL.

## ٥) التحقق الشامل لوضع Desktop (نهاية TASK 01)

السكربتات عملت في مجلد مؤقت برّه المستودع، على نسخة SQLite مبنية من `ddl-nocase.sql`، ونادَت كود المستودع الحقيقي (`config/prisma.ts` → `auth.service.ts`) بدون تعديل أي service:

| الفحص | النتيجة |
|---|---|
| `login("GENERATOR TRUCK")` / `("generator truck")` / `("Generator Truck")` | ✅ كلها رجّعت نفس المستخدم + المشاريع + توكن |
| `login` بكلمة سر غلط | ✅ 401 «الاسم أو كلمة السر غير صحيحة» — مافيش تجاوز |
| تسجيل دخول باسم عربي | ✅ مطابق |
| `contains` عربي + إنجليزي مع `mode:"insensitive"` | ✅ من غير خطأ (الشيم جرد `mode` — 10 مرات في التشغيل الواحد) |
| `equals` مع `mode` على عمود **عليه** `COLLATE NOCASE` | ✅ مطابق زي PG |
| `equals` على `Equipment.code` (بدون NOCASE) | ⚠️ رجع فاضي — `NOCASE` خاصية **لكل عمود**، فبناء TASK 02 لازم يضيفه على كل الأعمدة اللي بتتبحث: `name` (19 موضع) · `code` (11) · `description` (4) · `workshop`/`notes`/`itemName` (2 لكل واحدة) · `technicalCode`/`partModel`/`oilName`/`itemCode`/`email`/`department` (1 لكل واحدة) |
| `$transaction` بمصفوفة + تفاعلية (`tx` مغلّف) | ✅ الاتنين شغالين |
| `createMany` · `count` · cascade · raw query · `details` كنص | ✅ |
| `isDbConnectionError` على خطأ SQLite (`P2010`) | ✅ صنّفه صح (مش خطأ اتصال) بعد تحويله لفحص بالاسم/الكود بدل `instanceof` |
| فصل العملاء في عمليات مستقلة | ✅ `web`: عميل Desktop **مش محمّل** نهائيًا · `desktop`: عميل PG مش بيتبنى |
| `EFMS_MODE` فاسد / `EFMS_SQLITE_DIR` مفقود / `DATABASE_URL` فاضي / عميل SQLite غير مولّد | ✅ كل واحدة بترجع رسالة عربية واضحة بتقول الأمر الصح |

## ٦) ممنوع في وضع Desktop

اتصال Managers API · الـ cron · `startDbKeepAlive` (فكرة Neon-idle ملهاش معنى محليًا) — كلها بتتحكم فيها البيئة، والعزل الكامل مطلوب في TASK 03. أي فشل في فتح SQLite لازم يظهر كخطأ واضح، وممنوع إنه يرجع fallback لـ PostgreSQL.
