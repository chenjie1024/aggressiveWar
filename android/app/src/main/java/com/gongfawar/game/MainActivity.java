package com.gongfawar.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import java.util.Locale;

/**
 * 攻伐战争 Android 外壳：单个 WebView 加载打包进 assets 的 Web 版本。
 *
 * 关键点：
 * 1) 不能直接用 file:///android_asset 加载 —— ES module 与 CSS 会被 CORS 拦截（origin: null）。
 *    这里用官方 WebViewAssetLoader 把 assets 映射到 https://appassets.androidplatform.net/assets/。
 * 2) 必须真正全屏（沉浸式）：否则状态栏会压在游戏顶栏上，导致顶栏按钮点不到。
 *    API 30+ 用 WindowInsetsController，低版本用 SYSTEM_UI_FLAG_IMMERSIVE_STICKY。
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    /** shell=android 让网页知道自己在 App 里，可加刘海安全边距 */
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html?shell=android";

    private WebView web;
    private HostBridge hostBridge;

    /** 按扩展名给出 MIME：WebView 对 module 脚本的 MIME 很严格，这里强制兜底 */
    private static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        return null;
    }

    /** 沉浸式全屏：隐藏状态栏与导航栏，用户上滑时临时显示并自动隐藏 */
    @SuppressWarnings("deprecation")
    private void enterFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
        // 刘海 / 挖孔屏：允许内容延伸到挖孔区域（配合网页自己的安全边距）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B1220);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage 存档 / 设置必需
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 首次点击后背景音乐可直接播放
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);                    // 不随系统字体缩放，避免 UI 错位
        // 页面在 https://appassets... 上，而"手机当房主"时要连 ws://127.0.0.1:8080 的中继，
        // 属于混合内容：必须显式放行，否则会被 Chromium 拦掉。
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // 暴露给网页的房主桥：window.AndroidHost
        hostBridge = new HostBridge(this);
        web.addJavascriptInterface(hostBridge, "AndroidHost");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse resp = assetLoader.shouldInterceptRequest(request.getUrl());
                if (resp == null) return null;
                String mime = mimeFor(request.getUrl().getPath() == null ? "" : request.getUrl().getPath());
                if (mime != null && !mime.equals(resp.getMimeType())) {
                    resp.setMimeType(mime);
                }
                return resp;
            }

            /** 主文档加载失败时给一张可读的错误页，便于在手机上定位问题 */
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    String html = "<html><body style='background:#0b1220;color:#e8eef1;font-family:monospace;padding:24px'>"
                            + "<h3>资源加载失败</h3><p>" + request.getUrl() + "</p>"
                            + "<p>code " + error.getErrorCode() + ": " + error.getDescription() + "</p></body></html>";
                    view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
                }
            }
        });
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // 保险：正常沉浸式下 inset=0（完全不占位）；若某些 ROM 又把状态栏/刘海露出来，
        // 网页视口会自动让出这部分高度，保证游戏顶栏按钮不会被系统栏压住。
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            int top;
            int left;
            int right;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars =
                        insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = bars.top;
                left = bars.left;
                right = bars.right;
            } else {
                top = insets.getSystemWindowInsetTop();
                left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight();
            }
            v.setPadding(left, top, right, 0);
            return insets;
        });

        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.rgb(0x0B, 0x12, 0x20));

        enterFullscreen();

        if (savedInstanceState == null) {
            web.loadUrl(START_URL);
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    /** 从后台返回、切屏、系统栏被手势唤出后，重新进入沉浸式 */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterFullscreen();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    /** 返回键：优先回退网页历史，否则交给系统退出 */
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        // 网页没主动停中继时（直接退出 App），这里兜底关掉，避免端口一直占着
        if (hostBridge != null) {
            try {
                hostBridge.stop();
            } catch (Exception ignored) {
            }
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
