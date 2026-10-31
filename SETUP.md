# تشغيل ورقة على Cloudflare (مع الحسابات والتخزين السحابي)

بعد هذه الخطوات، كل تحديث يُرفع على فرع `main` يُنشر تلقائياً على Cloudflare.

## 1. فعّل Workers في حسابك
من لوحة Cloudflare افتح **Workers & Pages** مرة واحدة، واختر اسم النطاق الفرعي (subdomain) عندما يُطلب منك.
رابط موقعك سيكون: `https://waraqa.<اسمك>.workers.dev`

## 2. انسخ Account ID
من صفحة **Workers & Pages**، تجد **Account ID** على الجانب. انسخه.

## 3. أنشئ API Token
1. اضغط صورة حسابك ← **My Profile** ← **API Tokens** ← **Create Token**.
2. اختر القالب **Edit Cloudflare Workers** ← **Use template**.
3. أضف صلاحيتين بالزر **+ Add more**:
   - `Account` ← `D1` ← `Edit`
   - `Account` ← `Workers R2 Storage` ← `Edit`
4. في **Account Resources** اختر حسابك، وفي **Zone Resources** اختر **All zones**.
5. **Continue to summary** ← **Create Token** وانسخ المفتاح (يظهر مرة واحدة فقط).

## 4. ضع المفتاحين في GitHub
في المستودع: **Settings** ← **Secrets and variables** ← **Actions** ← **New repository secret**:
- الاسم `CLOUDFLARE_API_TOKEN` والقيمة: المفتاح من الخطوة 3
- الاسم `CLOUDFLARE_ACCOUNT_ID` والقيمة: الرقم من الخطوة 2

## 5. انشر
في المستودع: **Actions** ← **Deploy to Cloudflare** ← **Run workflow**.
ينشئ قاعدة البيانات تلقائياً ثم ينشر الموقع. بعد انتهائه (علامة خضراء) افتح رابطك.

## R2 (اختياري)
إذا فعّلت **R2** من لوحة Cloudflare، تُحفظ الشعارات والتوقيعات فيه تلقائياً من النشر التالي.
بدونه تُحفظ في قاعدة البيانات D1، وهذا يكفي للقوالب والتوقيعات.

## الأمان
- كلمات المرور تُحفظ مشفّرة (PBKDF2)، ولا يرى أي مستخدم إلا محفوظاته.
- الملفات التي تحوّلها أو تعدّلها لا تُرفع للخادم. الخادم يحفظ القوالب والتوقيعات والخطابات فقط.
