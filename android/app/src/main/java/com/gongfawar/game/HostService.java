package com.gongfawar.game;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * 前台服务：房主把 App 切到后台 / 锁屏时，中继继续活着（否则系统可能回收进程，房间就断了）。
 * 通知栏显示"局域网房间运行中"，点一下回到游戏。
 */
public class HostService extends Service {

    private static final String CHANNEL_ID = "gongfa_host";
    private static final int NOTIFICATION_ID = 4201;

    private static HostServer server;

    public static void setServer(HostServer s) {
        server = s;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 已在前台则刷新通知（房间码可能变了）
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        // 服务被停掉时一并关掉中继，避免端口泄漏
        if (server != null) {
            server.stop();
            server = null;
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "局域网房间", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("手机作为房主时保持中继运行");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

        String text = "其它手机连同一热点，打开 http://本机IP:8080";
        if (server != null && server.isRunning()) {
            String urls = server.lanUrls();
            if (urls != null && !urls.isEmpty()) text = urls;
        }

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setContentTitle("攻伐战争 · 局域网房间运行中")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSmallIcon(android.R.drawable.ic_menu_share)
                .setOngoing(true)
                .setContentIntent(pi);
        return b.build();
    }
}
