package com.waraqa.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    static final String HOME = "https://waraqa.hamadaanter1998.workers.dev/";
    static final String HOST = "waraqa.hamadaanter1998.workers.dev";
    static final String AUTH = "com.waraqa.app.files";
    static final int REQ_FILE = 11, REQ_CAM_PERM = 12;

    WebView web;
    ValueCallback<Uri[]> fileCb;
    WebChromeClient.FileChooserParams pendingParams;
    Uri camUri;
    boolean offline;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " WaraqaApp/" + BuildConfigVersion());
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "WaraqaAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
    }

    String BuildConfigVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception e) { return "1"; }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onBackPressed() {
        if (offline) { super.onBackPressed(); return; }
        web.evaluateJavascript("(window.waraqaBack&&window.waraqaBack())?'1':'0'", v -> {
            if (v != null && v.contains("1")) return;
            if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    /* ---------- pages ---------- */
    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if ((scheme.equals("https") || scheme.equals("http")) && HOST.equals(u.getHost())) return false;
            if (scheme.equals("blob") || scheme.equals("data") || scheme.equals("about")) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) {}
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, Bitmap fav) {
            if (url != null && url.startsWith("http")) offline = false;
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame()) return;
            offline = true;
            String html = "<!doctype html><html lang='ar' dir='rtl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{font-family:sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:24px;text-align:center;color:#1b2230;background:#f6f7fb}"
                + "h1{font-size:22px;margin:0 0 8px}p{color:#5b6475;margin:0 0 20px;line-height:1.7}"
                + "a{display:inline-block;background:#2952cc;color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:700}</style></head>"
                + "<body><div><h1>لا يوجد اتصال بالإنترنت</h1><p>تطبيق ورقة يحتاج الإنترنت ليعمل.<br>تأكد من الاتصال ثم أعد المحاولة.</p>"
                + "<a href='" + HOME + "'>إعادة المحاولة</a></div></body></html>";
            v.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        }
    }

    /* ---------- file picker & camera ---------- */
    class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            pendingParams = p;
            boolean wantsImages = acceptsImages(p);
            if (wantsImages && Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                && p.isCaptureEnabled()) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM_PERM);
                return true;
            }
            launchChooser(p);
            return true;
        }
    }

    boolean acceptsImages(WebChromeClient.FileChooserParams p) {
        String[] types = p.getAcceptTypes();
        if (types == null || types.length == 0) return false;
        for (String t : types) {
            for (String part : t.split(",")) {
                String x = part.trim().toLowerCase();
                if (x.startsWith("image/") || x.equals(".jpg") || x.equals(".jpeg") || x.equals(".png") || x.equals(".heic")) return true;
            }
        }
        return false;
    }

    boolean camAllowed() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    Intent cameraIntent() {
        try {
            File dir = new File(getCacheDir(), "camera");
            dir.mkdirs();
            File f = new File(dir, "IMG_" + System.currentTimeMillis() + ".jpg");
            camUri = FileProvider.getUriForFile(this, AUTH, f);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, camUri);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.setClipData(ClipData.newRawUri("", camUri));
            return i;
        } catch (Exception e) {
            camUri = null;
            return null;
        }
    }

    void launchChooser(WebChromeClient.FileChooserParams p) {
        camUri = null;
        boolean images = acceptsImages(p);
        try {
            if (p.isCaptureEnabled() && images && camAllowed()) {
                Intent cam = cameraIntent();
                if (cam != null) { startActivityForResult(cam, REQ_FILE); return; }
            }
            Intent get = new Intent(Intent.ACTION_GET_CONTENT);
            get.addCategory(Intent.CATEGORY_OPENABLE);
            List<String> mimes = new ArrayList<>();
            boolean onlyMimes = true;
            String[] types = p.getAcceptTypes();
            if (types != null) for (String t : types) for (String part : t.split(",")) {
                String x = part.trim();
                if (x.isEmpty()) continue;
                if (x.contains("/")) mimes.add(x); else onlyMimes = false;
            }
            if (onlyMimes && mimes.size() == 1) get.setType(mimes.get(0));
            else {
                get.setType("*/*");
                if (onlyMimes && mimes.size() > 1) get.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
            }
            if (p.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) get.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            Intent chooser = Intent.createChooser(get, "اختر ملفاً");
            if (images && camAllowed()) {
                Intent cam = cameraIntent();
                if (cam != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
            }
            startActivityForResult(chooser, REQ_FILE);
        } catch (Exception e) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = null;
            Toast.makeText(this, "تعذّر فتح اختيار الملفات", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_CAM_PERM && pendingParams != null) launchChooser(pendingParams);
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE || fileCb == null) return;
        Uri[] out = null;
        if (result == RESULT_OK) {
            List<Uri> list = new ArrayList<>();
            if (data != null && data.getClipData() != null) {
                ClipData cd = data.getClipData();
                for (int i = 0; i < cd.getItemCount(); i++) if (cd.getItemAt(i).getUri() != null) list.add(cd.getItemAt(i).getUri());
            } else if (data != null && data.getData() != null) {
                list.add(data.getData());
            }
            if (list.isEmpty() && camUri != null) {
                File f = camFile();
                if (f != null && f.length() > 0) list.add(camUri);
            }
            if (!list.isEmpty()) out = list.toArray(new Uri[0]);
        }
        fileCb.onReceiveValue(out);
        fileCb = null;
        pendingParams = null;
    }

    File camFile() {
        if (camUri == null) return null;
        String last = camUri.getLastPathSegment();
        return last == null ? null : new File(new File(getCacheDir(), "camera"), last);
    }

    /* ---------- saving files from the page ---------- */
    static class Pending { String name, mime; File tmp; OutputStream os; }

    class Bridge {
        final Map<String, Pending> open = new HashMap<>();
        int seq = 0;

        @JavascriptInterface
        public String begin(String name, String mime) {
            try {
                Pending p = new Pending();
                p.name = safeName(name);
                p.mime = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
                if (p.mime.equals("application/octet-stream")) {
                    int dot = p.name.lastIndexOf('.');
                    String guess = dot > 0 ? android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(p.name.substring(dot + 1).toLowerCase()) : null;
                    if (guess != null) p.mime = guess;
                }
                File dir = new File(getCacheDir(), "out");
                dir.mkdirs();
                p.tmp = new File(dir, System.currentTimeMillis() + "_" + p.name);
                p.os = new FileOutputStream(p.tmp);
                String id = "f" + (++seq);
                synchronized (open) { open.put(id, p); }
                return id;
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public boolean chunk(String id, String b64) {
            Pending p;
            synchronized (open) { p = open.get(id); }
            if (p == null) return false;
            try { p.os.write(Base64.decode(b64, Base64.DEFAULT)); return true; }
            catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean end(String id) {
            Pending p;
            synchronized (open) { p = open.remove(id); }
            if (p == null) return false;
            try {
                p.os.close();
                final Uri saved = publish(p);
                p.tmp.delete();
                final String name = p.name, mime = p.mime;
                runOnUiThread(() -> afterSave(saved, name, mime));
                return saved != null;
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "تعذّر حفظ الملف", Toast.LENGTH_LONG).show());
                return false;
            }
        }

        @JavascriptInterface
        public String version() { return BuildConfigVersion(); }
    }

    static String safeName(String n) {
        if (n == null || n.trim().isEmpty()) n = "file";
        return n.replaceAll("[\\\\/:*?\"<>|\\n\\r]+", "_");
    }

    /** Copies the temp file into Downloads/Waraqa (Android 10+) or the app folder (older). */
    Uri publish(Pending p) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, p.name);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, p.mime);
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Waraqa");
            cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new Exception("insert failed");
            try (InputStream in = new FileInputStream(p.tmp); OutputStream out = getContentResolver().openOutputStream(uri)) {
                copy(in, out);
            }
            cv.clear();
            cv.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(uri, cv, null, null);
            return uri;
        }
        File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Waraqa");
        dir.mkdirs();
        File f = new File(dir, p.name);
        int n = 1;
        String base = p.name, ext = "";
        int dot = p.name.lastIndexOf('.');
        if (dot > 0) { base = p.name.substring(0, dot); ext = p.name.substring(dot); }
        while (f.exists()) f = new File(dir, base + " (" + (n++) + ")" + ext);
        try (InputStream in = new FileInputStream(p.tmp); OutputStream out = new FileOutputStream(f)) { copy(in, out); }
        return FileProvider.getUriForFile(this, AUTH, f);
    }

    static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[65536];
        int r;
        while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
    }

    void afterSave(Uri uri, String name, String mime) {
        if (uri == null) { Toast.makeText(this, "تعذّر حفظ الملف", Toast.LENGTH_LONG).show(); return; }
        String where = Build.VERSION.SDK_INT >= 29 ? "في مجلد التنزيلات › Waraqa" : "داخل التطبيق. استخدم «مشاركة» لإرساله أو حفظه في مكان آخر";
        new AlertDialog.Builder(this)
            .setTitle("حُفظ الملف")
            .setMessage(name + "\n\n" + "تجده " + where + ".")
            .setPositiveButton("فتح", (d, w) -> {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, mime);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivity(i); } catch (ActivityNotFoundException e) {
                    Toast.makeText(this, "لا يوجد تطبيق يفتح هذا النوع من الملفات", Toast.LENGTH_LONG).show();
                }
            })
            .setNeutralButton("مشاركة", (d, w) -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_STREAM, uri);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivity(Intent.createChooser(i, "مشاركة الملف")); } catch (Exception ignored) {}
            })
            .setNegativeButton("تم", null)
            .show();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setVisibility(View.GONE);
            web.destroy();
        }
        super.onDestroy();
    }
}
