# تشغيل ورقة على Cloudflare (مع الحسابات والتخزين السحابي)

## 1. أنشئ قاعدة البيانات
من لوحة Cloudflare: **Storage & Databases** ← **D1 SQL Database** ← **Create**.
اسمها: `waraqa-db`. بعد الإنشاء انسخ **Database ID** وضعه في `wrangler.toml` (موجود الآن).
الجداول تُنشأ تلقائياً عند أول استخدام، فلا تحتاج لكتابة أي SQL.

## 2. اربط المستودع
**Workers & Pages** ← **Create** ← **Connect GitHub** ← اختر المستودع `Waraqa`.
- اسم المشروع: `waraqa` (لازم يطابق `name` في `wrangler.toml`)
- Build command: اتركه فارغاً
- Deploy command: `npx wrangler deploy`

بعد ذلك كل تحديث على فرع `main` يُنشر تلقائياً، والرابط يكون `https://waraqa.<اسمك>.workers.dev`.

## R2 (اختياري)
بدون R2 تُحفظ الشعارات والتوقيعات في D1، وهذا يكفي. لاستخدام R2: أنشئ Bucket باسم `waraqa-files`
وأضف إلى `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "FILES"
bucket_name = "waraqa-files"
```

## الأمان
- كلمات المرور تُحفظ مشفّرة (PBKDF2)، ولا يرى أي مستخدم إلا محفوظاته.
- الملفات التي تحوّلها أو تعدّلها لا تُرفع للخادم. الخادم يحفظ القوالب والتوقيعات والخطابات فقط.
