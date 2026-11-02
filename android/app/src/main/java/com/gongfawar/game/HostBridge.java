package com.gongfawar.game;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 暴露给网页的桥：window.AndroidHost
 *
 * 网页侧用法（见 packages/web/src/net/hostBridge.ts）：
 *   if (AndroidHost.available()) { const info = JSON.parse(AndroidHost.start()); }  // → {ok, port, urls, error?}
 *   AndroidHost.stop();
 *
 * 注意：这些方法跑在 WebView 的 Java 桥线程（不是 UI 线程），所以可以安全地做阻塞式 socket 绑定；
 * 只有启动前台服务需要回到 UI 线程。
 */
public class HostBridge {

    private static final int DEFAULT_PORT = 8080;

    private final Activity activity;
    private HostServer server;

    public HostBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String available() {
        return "1";
    }

    @JavascriptInterface
    public String start() {
        return start(DEFAULT_PORT);
    }

    @JavascriptInterface
    public String start(int port) {
        JSONObject res = new JSONObject();
        try {
            if (server == null || !server.isRunning() || server.getPort() != port) {
                if (server != null) server.stop();
                server = new HostServer(activity.getAssets(), port, line -> android.util.Log.i("gongfa-host", line));
                server.start();
            }
            HostService.setServer(server);
            startForegroundService();
            res.put("ok", true);
            res.put("port", port);
            res.put("clients", server.clientCount());
            JSONArray urls = new JSONArray();
            for (String ip : HostServer.lanIps()) urls.put("http://" + ip + ":" + port + "/");
            res.put("urls", urls);
            // 本机回环地址：房主自己的 WebView 用它连中继（手机没连自己热点 IP 时也能用）
            res.put("localUrl", "http://127.0.0.1:" + port + "/");
            res.put("relayUrl", "ws://127.0.0.1:" + port + "/relay");
        } catch (Exception e) {
            try {
                res.put("ok", false);
                res.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            } catch (Exception ignored) {
            }
        }
        return res.toString();
    }

    @JavascriptInterface
    public String info() {
        JSONObject res = new JSONObject();
        try {
            res.put("ok", server != null && server.isRunning());
            res.put("port", server == null ? 0 : server.getPort());
            res.put("clients", server == null ? 0 : server.clientCount());
            JSONArray urls = new JSONArray();
            if (server != null && server.isRunning()) {
                for (String ip : HostServer.lanIps()) urls.put("http://" + ip + ":" + server.getPort() + "/");
            }
            res.put("urls", urls);
            res.put("running", server != null && server.isRunning());
        } catch (Exception ignored) {
        }
        return res.toString();
    }

    @JavascriptInterface
    public void stop() {
        stopForegroundService();
        if (server != null) {
            server.stop();
            server = null;
        }
    }

    private void startForegroundService() {
        final Intent intent = new Intent(activity, HostService.class);
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) activity.startForegroundService(intent);
                else activity.startService(intent);
            } catch (Exception e) {
                // 前台服务失败不影响中继本身（只是切后台可能被系统回收）
                android.util.Log.w("gongfa-host", "前台服务启动失败：" + e.getMessage());
            }
        });
    }

    private void stopForegroundService() {
        activity.runOnUiThread(() -> {
            try {
                activity.stopService(new Intent(activity, HostService.class));
            } catch (Exception ignored) {
            }
        });
    }
}
