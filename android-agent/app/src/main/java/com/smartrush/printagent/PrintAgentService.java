package com.smartrush.printagent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class PrintAgentService extends Service {
    private static final String ACTION_START = "com.smartrush.printagent.START";
    private static final String ACTION_STOP = "com.smartrush.printagent.STOP";
    private static final String CHANNEL_ID = "smartrush_print_agent";
    private static final int NOTIFICATION_ID = 2001;

    private static final String PREFS = "smartrush-print-agent";
    private static final String KEY_SUPABASE_URL = "supabaseUrl";
    private static final String KEY_SUPABASE_ANON_KEY = "supabaseAnonKey";
    private static final String KEY_AGENT_ID = "agentId";
    private static final String KEY_AGENT_TOKEN = "agentToken";
    private static final String KEY_AGENT_ENABLED = "agentEnabled";
    private static final String KEY_POLL_INTERVAL_MS = "pollIntervalMs";
    private static final String KEY_BATCH_SIZE = "batchSize";
    private static final String KEY_RETRY_DELAY_SECONDS = "retryDelaySeconds";

    private static final int DEFAULT_POLL_INTERVAL_MS = 5000;
    private static final int DEFAULT_BATCH_SIZE = 5;
    private static final int DEFAULT_RETRY_DELAY_SECONDS = 30;
    private static final int MIN_POLL_INTERVAL_MS = 1000;
    private static final int MAX_POLL_INTERVAL_MS = 60000;
    private static final int MIN_BATCH_SIZE = 1;
    private static final int MAX_BATCH_SIZE = 25;
    private static final int MIN_RETRY_DELAY_SECONDS = 1;
    private static final int MAX_RETRY_DELAY_SECONDS = 300;
    private static final long CONFIG_REFRESH_INTERVAL_MS = 60000L;

    private SharedPreferences prefs;
    private Thread workerThread;
    private volatile boolean running;
    private long lastConfigSyncAtMs;

    public static void start(Context context) {
        Intent intent = new Intent(context, PrintAgentService.class).setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, PrintAgentService.class).setAction(ACTION_STOP);
        context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            stopWorker();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!isAgentReady()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification("Esperando trabajos de impresion"));
        startWorkerIfNeeded();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopWorker();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startWorkerIfNeeded() {
        if (workerThread != null && workerThread.isAlive()) return;

        running = true;
        workerThread = new Thread(this::runPollingLoop, "SmartRushPrintAgent");
        workerThread.start();
    }

    private void stopWorker() {
        running = false;
        if (workerThread != null) {
            workerThread.interrupt();
            workerThread = null;
        }
    }

    private void runPollingLoop() {
        while (running && isAgentReady()) {
            String result;
            try {
                result = processPendingJobs();
            } catch (Exception error) {
                result = "Error agente: " + errorMessage(error);
            }

            updateNotification(notificationText(result));
            sleep(currentPollIntervalMs());
        }

        running = false;
        stopSelf();
    }

    private boolean isAgentReady() {
        return prefs.getBoolean(KEY_AGENT_ENABLED, false)
                && !prefs.getString(KEY_AGENT_TOKEN, "").isEmpty()
                && !prefs.getString(KEY_SUPABASE_URL, "").isEmpty()
                && !prefs.getString(KEY_SUPABASE_ANON_KEY, "").isEmpty();
    }

    private String processPendingJobs() throws Exception {
        maybeSyncAgentConfig();
        JSONArray jobs = claimPrintJobs();
        String checkedAt = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        if (jobs.length() == 0) {
            return "Ultima revision: " + checkedAt + " - sin trabajos";
        }

        JSONArray printers = fetchAgentPrinters();
        int printed = 0;
        int failed = 0;

        for (int index = 0; index < jobs.length(); index += 1) {
            JSONObject job = jobs.getJSONObject(index);
            try {
                processJob(job, printers);
                printed += 1;
            } catch (Exception error) {
                failed += 1;
                markJobFailed(job.optString("id"), errorMessage(error));
            }
        }

        return "Ultima revision: " + checkedAt
                + " - procesados: " + jobs.length()
                + " / impresos: " + printed
                + " / error: " + failed;
    }

    private JSONArray claimPrintJobs() throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""))
                .put("p_agent_name", prefs.getString(KEY_AGENT_ID, ""))
                .put("p_limit", currentBatchSize());

        return new JSONArray(postRpc("claim_print_jobs_for_agent", body));
    }

    private JSONArray fetchAgentPrinters() throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""));

        return new JSONArray(postRpc("get_agent_printers", body));
    }

    private void processJob(JSONObject job, JSONArray printers) throws Exception {
        JSONObject printer = printerForJob(job, printers);
        JSONObject connection = printer.optJSONObject("connection");
        if (connection == null) {
            throw new IllegalStateException("Printer connection is empty");
        }

        String type = connection.optString("type", "network");
        if (!"network".equals(type)) {
            throw new IllegalStateException("Android only supports network printers for now: " + type);
        }

        String ip = connection.optString("ip", "");
        if (ip.isEmpty()) {
            throw new IllegalStateException("Android printer connection requires ip");
        }

        int port = connection.optInt("port", 9100);
        byte[] ticket = TicketRenderer.render(job.opt("payload"), job.optString("job_type"));
        NetworkPrinter.send(ip, port, ticket);
        markJobPrinted(job.optString("id"));
    }

    private JSONObject printerForJob(JSONObject job, JSONArray printers) throws Exception {
        String targetPrinterId = firstNonEmpty(
                job.optString("printer_id", ""),
                job.optJSONObject("meta") != null ? job.optJSONObject("meta").optString("printer_id", "") : ""
        );

        if (!targetPrinterId.isEmpty()) {
            for (int index = 0; index < printers.length(); index += 1) {
                JSONObject printer = printers.getJSONObject(index);
                if (targetPrinterId.equals(printer.optString("id"))) {
                    return printer;
                }
            }
            throw new IllegalStateException("No active printer found for printer_id " + targetPrinterId);
        }

        String role = targetRoleForJob(job);
        for (int index = 0; index < printers.length(); index += 1) {
            JSONObject printer = printers.getJSONObject(index);
            if (role.equals(printer.optString("role"))) {
                return printer;
            }
        }

        throw new IllegalStateException("No active " + role + " printer found for this agent branch");
    }

    private String targetRoleForJob(JSONObject job) {
        JSONObject meta = job.optJSONObject("meta");
        if (meta != null) {
            String targetRole = firstNonEmpty(meta.optString("target_role", ""), meta.optString("printer_role", ""));
            if (!targetRole.isEmpty()) return targetRole;
        }
        return roleForJobType(job.optString("job_type", ""));
    }

    private String roleForJobType(String jobType) {
        if ("kitchen_ticket".equals(jobType) || "food_ticket".equals(jobType) || "kds_ticket".equals(jobType)) {
            return "kitchen";
        }
        if ("bar_ticket".equals(jobType)) return "bar";
        if ("label_ticket".equals(jobType)) return "label";
        if ("cash_drawer".equals(jobType)) return "cash_drawer";
        return "receipt";
    }

    private void markJobPrinted(String jobId) throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""))
                .put("p_job_id", jobId);

        postRpc("complete_print_job_for_agent", body);
    }

    private void markJobFailed(String jobId, String message) throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""))
                .put("p_job_id", jobId)
                .put("p_error", message)
                .put("p_retry_delay_seconds", currentRetryDelaySeconds());

        postRpc("fail_print_job_for_agent", body);
    }

    private void maybeSyncAgentConfig() {
        long now = System.currentTimeMillis();
        if (lastConfigSyncAtMs > 0 && now - lastConfigSyncAtMs < CONFIG_REFRESH_INTERVAL_MS) {
            return;
        }

        lastConfigSyncAtMs = now;
        try {
            syncAgentConfig();
        } catch (Exception ignored) {
            // Keep polling with the last known local values if config sync fails.
        }
    }

    private void syncAgentConfig() throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""));

        JSONArray rows = new JSONArray(postRpc("get_print_agent_config", body));
        if (rows.length() == 0) return;

        JSONObject row = rows.getJSONObject(0);
        int pollIntervalMs = clampInt(row.optInt("poll_interval_ms", DEFAULT_POLL_INTERVAL_MS), MIN_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS);
        int batchSize = clampInt(row.optInt("batch_size", DEFAULT_BATCH_SIZE), MIN_BATCH_SIZE, MAX_BATCH_SIZE);
        int retryDelaySeconds = clampInt(row.optInt("retry_delay_seconds", DEFAULT_RETRY_DELAY_SECONDS), MIN_RETRY_DELAY_SECONDS, MAX_RETRY_DELAY_SECONDS);

        prefs.edit()
                .putInt(KEY_POLL_INTERVAL_MS, pollIntervalMs)
                .putInt(KEY_BATCH_SIZE, batchSize)
                .putInt(KEY_RETRY_DELAY_SECONDS, retryDelaySeconds)
                .apply();
    }

    private int currentPollIntervalMs() {
        return intPref(KEY_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS);
    }

    private int currentBatchSize() {
        return intPref(KEY_BATCH_SIZE, DEFAULT_BATCH_SIZE, MIN_BATCH_SIZE, MAX_BATCH_SIZE);
    }

    private int currentRetryDelaySeconds() {
        return intPref(KEY_RETRY_DELAY_SECONDS, DEFAULT_RETRY_DELAY_SECONDS, MIN_RETRY_DELAY_SECONDS, MAX_RETRY_DELAY_SECONDS);
    }

    private int intPref(String key, int defaultValue, int min, int max) {
        return clampInt(prefs.getInt(key, defaultValue), min, max);
    }

    private int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(value, max));
    }

    private String postRpc(String rpcName, JSONObject body) throws Exception {
        URL url = new URL(trimTrailingSlash(prefs.getString(KEY_SUPABASE_URL, "")) + "/rest/v1/rpc/" + rpcName);
        String anonKey = prefs.getString(KEY_SUPABASE_ANON_KEY, "");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("apikey", anonKey);
        connection.setRequestProperty("Authorization", "Bearer " + anonKey);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");

        try (OutputStream output = connection.getOutputStream()) {
            output.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }

        int code = connection.getResponseCode();
        InputStream input = code >= 200 && code < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
        String response = readAll(input);

        if (code < 200 || code >= 300) {
            throw new IllegalStateException("HTTP " + code + ": " + response);
        }

        return response;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "SmartRush Print Agent",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Servicio de impresion de SmartRush");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent activityIntent = new Intent(this, MainActivity.class);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, activityIntent, pendingFlags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        return builder
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("SmartRush Print Agent activo")
                .setContentText(text)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(text));
        }
    }

    private String notificationText(String result) {
        if (result == null || result.trim().isEmpty()) {
            return "Esperando trabajos de impresion";
        }
        String clean = result.replace('\n', ' ').trim();
        return clean.length() <= 90 ? clean : clean.substring(0, 90);
    }

    private void sleep(int ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private String readAll(InputStream input) throws Exception {
        if (input == null) return "";
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toString("UTF-8");
    }

    private String trimTrailingSlash(String value) {
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return "";
    }

    private String errorMessage(Exception error) {
        return error.getMessage() == null ? String.valueOf(error) : error.getMessage();
    }
}
