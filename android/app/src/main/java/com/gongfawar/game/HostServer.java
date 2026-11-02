package com.gongfawar.game;

import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 手机当服务器：一个极简 HTTP 静态服务 + WebSocket 中继（零第三方依赖）。
 *
 * 设计要点（与 packages/server/src/relay.ts 完全同一份协议）：
 * - 只做三件事：分配房间码/席位、广播 begin（种子+配置+席位）、把 act 指令编号后广播回所有人（含发送者）；
 * - **不跑游戏规则**：各端本地跑（核心是种子随机，见 tests 的锁步确定性用例），所以 Java 侧不需要移植 TS 核心；
 * - 静态资源直接来自 APK 里的 assets/www，其它手机浏览器打开 http://<房主IP>:8080/ 就能玩。
 *
 * WebSocket 部分按 RFC6455 手写：握手 / 掩码解码 / 126-127 扩展长度 / 分片续帧 / ping-pong / close。
 */
public final class HostServer {

    public interface Listener {
        void onServerLog(String line);
    }

    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final AssetManager assets;
    private final int port;
    private final Listener listener;
    private volatile boolean running;
    private ServerSocket socket;
    private Thread acceptThread;

    /** 已连接的中继客户端 */
    private final CopyOnWriteArrayList<Ws> clients = new CopyOnWriteArrayList<>();
    /** 房间码 → 房间 */
    private final Map<String, Room> rooms = Collections.synchronizedMap(new LinkedHashMap<String, Room>());

    public HostServer(AssetManager assets, int port, Listener listener) {
        this.assets = assets;
        this.port = port;
        this.listener = listener;
    }

    public boolean isRunning() {
        return running;
    }

    public int getPort() {
        return port;
    }

    public int clientCount() {
        return clients.size();
    }

    public List<String> roomCodes() {
        synchronized (rooms) {
            return new ArrayList<>(rooms.keySet());
        }
    }

    private void log(String line) {
        if (listener != null) listener.onServerLog(line);
    }

    // ===================== 生命周期 =====================

    public void start() throws IOException {
        if (running) return;
        socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress(port));
        running = true;
        acceptThread = new Thread(this::acceptLoop, "gongfa-host-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        log("服务已启动：端口 " + port + "，地址 " + lanUrls());
    }

    public void stop() {
        running = false;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        for (Ws c : clients) c.close();
        clients.clear();
        rooms.clear();
        log("服务已停止");
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket s = socket.accept();
                s.setTcpNoDelay(true);
                Thread t = new Thread(() -> handleConnection(s), "gongfa-host-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (running) log("accept 失败：" + e.getMessage());
            }
        }
    }

    // ===================== 网卡地址 =====================

    /** 局域网 IPv4（热点口优先：ap0 / swlan0 / wlan1 之类排在前面） */
    public static List<String> lanIps() {
        List<String> prefer = new ArrayList<>();
        List<String> other = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String name = ni.getName() == null ? "" : ni.getName().toLowerCase(Locale.ROOT);
                boolean ap = name.startsWith("ap") || name.contains("swlan") || name.contains("softap");
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
                    String ip = a.getHostAddress();
                    if (ip == null || ip.startsWith("169.254.")) continue;
                    if (ap) prefer.add(ip);
                    else other.add(ip);
                }
            }
        } catch (Exception ignored) {
        }
        prefer.addAll(other);
        return prefer;
    }

    public String lanUrls() {
        List<String> ips = lanIps();
        if (ips.isEmpty()) return "http://127.0.0.1:" + port + "/";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ips.size(); i++) {
            if (i > 0) sb.append("  ");
            sb.append("http://").append(ips.get(i)).append(':').append(port).append('/');
        }
        return sb.toString();
    }

    // ===================== HTTP / WebSocket =====================

    private void handleConnection(Socket s) {
        try {
            InputStream raw = s.getInputStream();
            OutputStream out = s.getOutputStream();
            String requestLine = readLine(raw);
            if (requestLine == null) {
                s.close();
                return;
            }
            Map<String, String> headers = new LinkedHashMap<>();
            String line;
            while ((line = readLine(raw)) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    headers.put(line.substring(0, idx).trim().toLowerCase(Locale.ROOT), line.substring(idx + 1).trim());
                }
            }
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "GET";
            String path = parts.length > 1 ? parts[1] : "/";
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q); // 查询串（如 ?join=ABCD）由网页自己读

            String upgrade = headers.get("upgrade");
            if (upgrade != null && upgrade.equalsIgnoreCase("websocket")) {
                Ws ws = new Ws(s, raw, out);
                if (ws.handshake(headers.get("sec-websocket-key"))) {
                    clients.add(ws);
                    log("客户端接入（当前 " + clients.size() + " 个连接）");
                    ws.readLoop();
                } else {
                    s.close();
                }
                return;
            }

            if (path.equals("/api/lan-info") || path.equals("/api/health")) {
                JSONObject o = new JSONObject();
                o.put("status", "lan");
                o.put("port", port);
                o.put("hosted", true);
                JSONArray arr = new JSONArray();
                for (String ip : lanIps()) arr.put(ip);
                o.put("ips", arr);
                JSONArray urls = new JSONArray();
                for (String ip : lanIps()) urls.put("http://" + ip + ":" + port + "/");
                o.put("urls", urls);
                o.put("clients", clients.size());
                JSONArray codes = new JSONArray();
                for (String c : roomCodes()) codes.put(c);
                o.put("rooms", codes);
                respond(out, 200, "application/json; charset=utf-8", o.toString().getBytes(StandardCharsets.UTF_8));
                s.close();
                return;
            }

            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                respond(out, 405, "text/plain; charset=utf-8", "method not allowed".getBytes(StandardCharsets.UTF_8));
                s.close();
                return;
            }

            serveAsset(out, path);
            s.close();
        } catch (Exception e) {
            try {
                s.close();
            } catch (IOException ignored) {
            }
        }
    }

    /** 静态资源：/ 与未知路径都回 index.html（SPA 兜底），其余按路径读 assets/www */
    private void serveAsset(OutputStream out, String path) {
        String rel = path.equals("/") ? "index.html" : path.startsWith("/") ? path.substring(1) : path;
        if (rel.isEmpty() || rel.endsWith("/")) rel = rel + "index.html";
        if (rel.contains("..")) { // 目录穿越防护
            respond(out, 404, "text/plain; charset=utf-8", "bad path".getBytes(StandardCharsets.UTF_8));
            return;
        }
        byte[] data = readAsset("www/" + rel);
        if (data == null) {
            // 带扩展名却没找到 → 404；否则当 SPA 路由回首页
            if (rel.contains(".")) {
                respond(out, 404, "text/plain; charset=utf-8", ("not found: " + rel).getBytes(StandardCharsets.UTF_8));
                return;
            }
            data = readAsset("www/index.html");
            rel = "index.html";
        }
        if (data == null) {
            respond(out, 500, "text/plain; charset=utf-8", "assets/www 未打包".getBytes(StandardCharsets.UTF_8));
            return;
        }
        // 入口页注入 ?join=CODE 之类的参数时不需要改写：网页自己会读 location.search
        respond(out, 200, mimeFor(rel), data);
    }

    private byte[] readAsset(String name) {
        try (InputStream in = assets.open(name)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream(Math.max(1024, in.available()));
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static void respond(OutputStream out, int code, String type, byte[] body) {
        try {
            String head = "HTTP/1.1 " + code + " " + (code == 200 ? "OK" : code == 404 ? "Not Found" : "Error") + "\r\n"
                    + "Content-Type: " + type + "\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Cache-Control: no-cache\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Connection: close\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.UTF_8));
            out.write(body);
            out.flush();
        } catch (IOException ignored) {
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(128);
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') bos.write(c);
            if (bos.size() > 8192) break;
        }
        if (c == -1 && bos.size() == 0) return null;
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    // ===================== WebSocket =====================

    private final class Ws {
        private final Socket sock;
        private final InputStream in;
        private final OutputStream out;
        private final Object writeLock = new Object();
        private Room room;
        private int seat = -1;
        private volatile boolean open = true;

        Ws(Socket sock, InputStream in, OutputStream out) {
            this.sock = sock;
            this.in = in;
            this.out = out;
        }

        boolean handshake(String key) {
            if (key == null) return false;
            try {
                String accept = base64Sha1(key + WS_GUID);
                String resp = "HTTP/1.1 101 Switching Protocols\r\n"
                        + "Upgrade: websocket\r\n"
                        + "Connection: Upgrade\r\n"
                        + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
                synchronized (writeLock) {
                    out.write(resp.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        void readLoop() {
            ByteArrayOutputStream frag = new ByteArrayOutputStream();
            int fragOp = 0;
            try {
                while (open) {
                    int b0 = in.read();
                    if (b0 < 0) break;
                    int b1 = in.read();
                    if (b1 < 0) break;
                    boolean fin = (b0 & 0x80) != 0;
                    int op = b0 & 0x0F;
                    boolean masked = (b1 & 0x80) != 0;
                    long len = b1 & 0x7F;
                    if (len == 126) {
                        len = ((long) readByte() << 8) | readByte();
                    } else if (len == 127) {
                        len = 0;
                        for (int i = 0; i < 8; i++) len = (len << 8) | readByte();
                    }
                    if (len < 0 || len > 4L * 1024 * 1024) break;
                    byte[] mask = new byte[4];
                    if (masked) readFully(mask, 4);
                    byte[] payload = new byte[(int) len];
                    readFully(payload, (int) len);
                    if (masked) {
                        for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
                    }
                    switch (op) {
                        case 0x0: // 续帧
                            frag.write(payload);
                            if (fin) {
                                byte[] full = frag.toByteArray();
                                frag.reset();
                                if (fragOp == 0x1) onText(new String(full, StandardCharsets.UTF_8));
                            }
                            break;
                        case 0x1: // 文本
                            if (fin) {
                                onText(new String(payload, StandardCharsets.UTF_8));
                            } else {
                                frag.reset();
                                frag.write(payload);
                                fragOp = 0x1;
                            }
                            break;
                        case 0x8: // close
                            sendFrame(0x8, new byte[0]);
                            open = false;
                            break;
                        case 0x9: // ping
                            sendFrame(0xA, payload);
                            break;
                        default:
                            break; // pong / 二进制：忽略
                    }
                }
            } catch (IOException ignored) {
            } finally {
                open = false;
                clients.remove(this);
                if (room != null) {
                    Peer p = room.peerBySeat(seat);
                    if (p != null) {
                        p.connected = false;
                        p.ws = null;
                        room.broadcast(peersMsg(room), null);
                    }
                }
                try {
                    sock.close();
                } catch (IOException ignored) {
                }
                log("客户端断开（当前 " + clients.size() + " 个连接）");
            }
        }

        private int readByte() throws IOException {
            int v = in.read();
            if (v < 0) throw new IOException("eof");
            return v;
        }

        private void readFully(byte[] buf, int len) throws IOException {
            int off = 0;
            while (off < len) {
                int n = in.read(buf, off, len - off);
                if (n < 0) throw new IOException("eof");
                off += n;
            }
        }

        void sendText(String text) {
            sendFrame(0x1, text.getBytes(StandardCharsets.UTF_8));
        }

        void sendFrame(int opcode, byte[] data) {
            if (!open) return;
            try {
                ByteArrayOutputStream buf = new ByteArrayOutputStream(data.length + 10);
                buf.write(0x80 | opcode);
                if (data.length < 126) {
                    buf.write(data.length);
                } else if (data.length < 65536) {
                    buf.write(126);
                    buf.write((data.length >> 8) & 0xFF);
                    buf.write(data.length & 0xFF);
                } else {
                    buf.write(127);
                    for (int i = 7; i >= 0; i--) buf.write((int) (((long) data.length >> (8 * i)) & 0xFF));
                }
                buf.write(data, 0, data.length);
                synchronized (writeLock) {
                    out.write(buf.toByteArray());
                    out.flush();
                }
            } catch (IOException e) {
                open = false;
            }
        }

        void close() {
            open = false;
            try {
                sock.close();
            } catch (IOException ignored) {
            }
        }

        // ---------- 中继协议 ----------

        void onText(String text) {
            JSONObject msg;
            try {
                msg = new JSONObject(text);
            } catch (Exception e) {
                sendText(err("消息格式错误"));
                return;
            }
            String t = msg.optString("t", "");
            if (t.equals("ping")) {
                sendText("{\"t\":\"pong\"}");
                return;
            }
            if (t.equals("create")) {
                String code = newCode();
                Room r = new Room(code);
                r.peers.add(new Peer(0, msg.optString("name", "房主"), this));
                rooms.put(code, r);
                room = r;
                seat = 0;
                log("创建房间 " + code);
                sendText(roomInfo(r, 0, true));
                return;
            }
            if (t.equals("join")) {
                String code = msg.optString("code", "").toUpperCase(Locale.ROOT);
                Room r = rooms.get(code);
                if (r == null) {
                    sendText(err("房间不存在（检查房间码）"));
                    return;
                }
                if (room == r && seat >= 0) { // 同一连接重复 join：沿用原席位
                    sendText(roomInfo(r, seat, seat == 0));
                    if (r.started) replay(r);
                    return;
                }
                if (room != null && room != r) { // 换房：先退出旧房
                    Peer old = room.peerBySeat(seat);
                    if (old != null) {
                        old.connected = false;
                        old.ws = null;
                        room.broadcast(peersMsg(room), null);
                    }
                }
                Peer free = r.firstDisconnected();
                if (free == null && r.peers.size() < 6) {
                    free = new Peer(r.peers.size(), msg.optString("name", "玩家"), this);
                    r.peers.add(free);
                }
                if (free == null) {
                    sendText(err("房间已满（最多 6 方）"));
                    return;
                }
                free.ws = this;
                free.connected = true;
                if (!msg.optString("name", "").isEmpty()) free.name = msg.optString("name");
                room = r;
                seat = free.seat;
                log("加入房间 " + code + "（座位 " + seat + "）");
                sendText(roomInfo(r, seat, seat == 0));
                if (r.started) replay(r);
                r.broadcast(peersMsg(r), null);
                return;
            }

            if (room == null) {
                sendText(err("尚未加入房间"));
                return;
            }
            if (t.equals("begin")) {
                if (seat != 0) {
                    sendText(err("只有房主能开局"));
                    return;
                }
                room.started = true;
                room.seed = msg.optLong("seed", 0);
                room.config = msg.opt("config");
                room.seats = msg.opt("seats");
                room.log.clear();
                JSONObject b = new JSONObject();
                try {
                    b.put("t", "begin");
                    b.put("seed", room.seed);
                    b.put("config", room.config == null ? JSONObject.NULL : room.config);
                    b.put("seats", room.seats == null ? JSONObject.NULL : room.seats);
                } catch (Exception ignored) {
                }
                log("开局：房间 " + room.code + " 种子 " + room.seed);
                room.broadcast(b.toString(), null);
                return;
            }
            if (t.equals("act")) {
                if (!room.started) {
                    sendText(err("对局还没开始"));
                    return;
                }
                Object cmd = msg.opt("cmd");
                room.log.add(new LogEntry(seat, cmd));
                room.seq += 1;
                JSONObject b = new JSONObject();
                try {
                    b.put("t", "act");
                    b.put("seat", seat);
                    b.put("seq", room.seq);
                    b.put("cmd", cmd == null ? JSONObject.NULL : cmd);
                } catch (Exception ignored) {
                }
                // 广播给所有人（含发送者）：各端按同一顺序应用
                room.broadcast(b.toString(), null);
                return;
            }
            sendText(err("未知消息：" + t));
        }

        /** 后加入 / 重连：补发 begin + 全部历史指令，追上进度 */
        void replay(Room r) {
            JSONObject b = new JSONObject();
            try {
                b.put("t", "begin");
                b.put("seed", r.seed);
                b.put("config", r.config == null ? JSONObject.NULL : r.config);
                b.put("seats", r.seats == null ? JSONObject.NULL : r.seats);
            } catch (Exception ignored) {
            }
            sendText(b.toString());
            for (LogEntry e : r.log) {
                JSONObject a = new JSONObject();
                try {
                    a.put("t", "act");
                    a.put("seat", e.seat);
                    a.put("seq", ++r.seq);
                    a.put("cmd", e.cmd == null ? JSONObject.NULL : e.cmd);
                } catch (Exception ignored) {
                }
                sendText(a.toString());
            }
        }
    }

    private String newCode() {
        java.util.Random rnd = new java.util.Random();
        for (int attempt = 0; attempt < 50; attempt++) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 4; i++) sb.append(CHARS.charAt(rnd.nextInt(CHARS.length())));
            if (!rooms.containsKey(sb.toString())) return sb.toString();
        }
        return "R" + (System.currentTimeMillis() % 1000);
    }

    private static String base64Sha1(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] dig = md.digest(s.getBytes(StandardCharsets.UTF_8));
        return android.util.Base64.encodeToString(dig, android.util.Base64.NO_WRAP);
    }

    private static String err(String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("t", "error");
            o.put("message", message);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private static String roomInfo(Room r, int seat, boolean host) {
        JSONObject o = new JSONObject();
        try {
            o.put("t", "room");
            o.put("code", r.code);
            o.put("seat", seat);
            o.put("host", host);
            o.put("started", r.started);
            o.put("peers", peersJson(r));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private static JSONArray peersJson(Room r) {
        JSONArray arr = new JSONArray();
        for (Peer p : r.peers) {
            JSONObject o = new JSONObject();
            try {
                o.put("seat", p.seat);
                o.put("name", p.name);
                o.put("connected", p.connected);
            } catch (Exception ignored) {
            }
            arr.put(o);
        }
        return arr;
    }

    /** 成员列表变化广播（客户端按 {t:'peers', peers:[...]} 解析） */
    private static String peersMsg(Room r) {
        JSONObject o = new JSONObject();
        try {
            o.put("t", "peers");
            o.put("peers", peersJson(r));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    // ===================== 房间数据结构 =====================

    private static final class Peer {
        final int seat;
        String name;
        Ws ws;
        boolean connected;

        Peer(int seat, String name, Ws ws) {
            this.seat = seat;
            this.name = name;
            this.ws = ws;
            this.connected = true;
        }
    }

    private static final class LogEntry {
        final int seat;
        final Object cmd;

        LogEntry(int seat, Object cmd) {
            this.seat = seat;
            this.cmd = cmd;
        }
    }

    private static final class Room {
        final String code;
        final List<Peer> peers = new CopyOnWriteArrayList<>();
        final List<LogEntry> log = new CopyOnWriteArrayList<>();
        boolean started;
        long seed;
        Object config;
        Object seats;
        int seq;

        Room(String code) {
            this.code = code;
        }

        Peer peerBySeat(int seat) {
            for (Peer p : peers) if (p.seat == seat) return p;
            return null;
        }

        Peer firstDisconnected() {
            for (Peer p : peers) if (!p.connected) return p;
            return null;
        }

        void broadcast(String text, Ws except) {
            for (Peer p : peers) {
                if (p.ws != null && p.ws != except) p.ws.sendText(text);
            }
        }
    }
}
