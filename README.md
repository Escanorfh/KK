# EFMS — نظام متابعة المعدات والصيانة

نظام لمتابعة المعدات الثقيلة والسراكي اليومية وأعمال الصيانة وتنبيهات تغيير الزيوت.

| الطبقة | التقنيات | المنفذ |
| --- | --- | --- |
| الواجهة | React 18 + Vite 5 + Tailwind 3 (PWA قابل للتثبيت ويعمل أوفلاين) | `5173` (dev) |
| الخادم | Express + TypeScript + Prisma + PostgreSQL | `5000` |

## التشغيل

```bash
# الخادم
cd backend
npm install
cp .env.example .env      # ثم ضع قيم DATABASE_URL و JWT_SECRET الحقيقية
npx prisma migrate dev
npm run dev

# الواجهة
cd frontend
npm install
npm run dev
```

في وضع التطوير تمرّر الواجهة طلبات `/api` إلى `http://localhost:5000` عبر الوكيل.

## متغيرات البيئة (backend/.env)

`DATABASE_URL`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`,
بالإضافة إلى `MANAGERS_API_URL` و `MANAGERS_API_TOKEN` للربط مع نظام المدرين.
ملف `.env` مستثنى من Git — ارفع نموذجًا فقط عبر `backend/.env.example`.

## العمل دون اتصال

- إدخال السراكي اليومية وأعمال الصيانة وطلبات الإصلاح وطلبات الاحتياج يُحفظ محليًا في IndexedDB ثم يُرسل للسيرفر بالترتيب عند عودة الاتصال.
- الشاشات الأخرى تقرأ من آخر استجابة مخزّنة.
- استيراد Excel ومسح البيانات وأزرار الإرسال لنظام المدرين تحتاج اتصالًا مباشرًا.
- عنوان السيرفر قابل للضبط من داخل التطبيق (بدون إعادة بناء) لأنفتاح «حالة الاتصال والمزامنة» في الشريط العلوي.

## تطبيق سطح المكتب و PWA

```bash
cd frontend
npm run app:start      # بناء الواجهة ثم تشغيل تطبيق Electron
npm run app:installer  # إنتاج حزمة تثبيت Windows NSIS في frontend/desktop-release
```

## الاختبارات

```bash
cd backend && npm test
cd frontend && npm run build   # tsc -b + vite build
```
