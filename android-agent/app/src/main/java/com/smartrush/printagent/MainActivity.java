package com.smartrush.printagent;

import android.Manifest;
import android.app.Activity;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int COLOR_BRAND = Color.rgb(255, 91, 96);
    private static final int COLOR_DARK = Color.rgb(21, 21, 21);
    private static final int COLOR_TEXT = Color.rgb(35, 39, 47);
    private static final int COLOR_MUTED = Color.rgb(93, 99, 109);
    private static final int COLOR_SURFACE = Color.rgb(246, 247, 249);
    private static final int COLOR_CARD = Color.WHITE;
    private static final int COLOR_BORDER = Color.rgb(220, 225, 232);

    private static final String PREFS = "smartrush-print-agent";
    private static final String KEY_SUPABASE_URL = "supabaseUrl";
    private static final String KEY_SUPABASE_ANON_KEY = "supabaseAnonKey";
    private static final String KEY_AGENT_ID = "agentId";
    private static final String KEY_AGENT_TOKEN = "agentToken";
    private static final String KEY_BRANCH_NAME = "branchName";
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
    private Handler handler;
    private TextView statusView;
    private Button agentToggleButton;
    private JSONArray lastPrinters;
    private boolean pollInFlight;
    private long lastConfigSyncAtMs;

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            pollAgentOnce();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        handler = new Handler(Looper.getMainLooper());
        buildUi();
        requestNotificationPermissionIfNeeded();
        refreshStatus();
        syncPollingState();
    }

    @Override
    protected void onDestroy() {
        if (handler != null) {
            handler.removeCallbacks(pollRunnable);
        }
        super.onDestroy();
    }

    private void configureSystemBars() {
        getWindow().setStatusBarColor(COLOR_SURFACE);
        getWindow().setNavigationBarColor(COLOR_SURFACE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void buildUi() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(COLOR_SURFACE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(
                dp(20),
                getSystemBarHeight("status_bar_height") + dp(28),
                dp(20),
                getSystemBarHeight("navigation_bar_height") + dp(24)
        );
        scrollView.addView(root);

        root.addView(header());

        statusView = new TextView(this);
        statusView.setTextSize(15);
        statusView.setTextColor(COLOR_TEXT);
        statusView.setLineSpacing(dp(2), 1.0f);
        statusView.setPadding(dp(16), dp(14), dp(16), dp(14));
        statusView.setBackground(rounded(COLOR_CARD, 8, COLOR_BORDER, 1));
        root.addView(statusView, marginTopParams(18));

        agentToggleButton = button("Agente pausado - activar", COLOR_BRAND, Color.WHITE, view -> toggleAgent());
        root.addView(agentToggleButton);
        root.addView(button("Escanear codigo QR", COLOR_BRAND, Color.WHITE, view -> scanQr()));
        root.addView(button("Ver impresoras", COLOR_DARK, Color.WHITE, view -> loadPrinters()));
        root.addView(button("Prueba impresion", COLOR_DARK, Color.WHITE, view -> testPrint()));
        root.addView(button("Borrar agente", COLOR_CARD, COLOR_DARK, view -> clearAgent(), COLOR_BORDER));

        setContentView(scrollView);
    }

    private LinearLayout header() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(0, 0, 0, dp(4));

        ImageView logo = new ImageView(this);
        logo.setImageResource(getResources().getIdentifier("rushof", "drawable", getPackageName()));
        logo.setScaleType(ImageView.ScaleType.CENTER_CROP);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(72), dp(72));
        logoParams.setMargins(0, 0, dp(14), 0);
        header.addView(logo, logoParams);

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);

        TextView title = new TextView(this);
        title.setText("SmartRush");
        title.setTextSize(25);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setTextColor(COLOR_DARK);
        copy.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Print Agent Android");
        subtitle.setTextSize(15);
        subtitle.setTextColor(COLOR_MUTED);
        subtitle.setPadding(0, dp(2), 0, 0);
        copy.addView(subtitle);

        header.addView(copy, new LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1
        ));

        return header;
    }

    private Button button(String label, int backgroundColor, int textColor, android.view.View.OnClickListener listener) {
        return button(label, backgroundColor, textColor, listener, backgroundColor);
    }

    private Button button(
            String label,
            int backgroundColor,
            int textColor,
            android.view.View.OnClickListener listener,
            int strokeColor
    ) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setTextColor(textColor);
        button.setBackground(rounded(backgroundColor, 7, strokeColor, 1));
        button.setOnClickListener(listener);
        button.setPadding(dp(10), dp(12), dp(10), dp(12));
        button.setLayoutParams(marginTopParams(12));
        return button;
    }

    private LinearLayout.LayoutParams marginTopParams(int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, dp(top), 0, 0);
        return params;
    }

    private GradientDrawable rounded(int color, int radius, int strokeColor, int strokeWidth) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        drawable.setStroke(dp(strokeWidth), strokeColor);
        return drawable;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private int getSystemBarHeight(String name) {
        int resourceId = getResources().getIdentifier(name, "dimen", "android");
        if (resourceId <= 0) return 0;
        return getResources().getDimensionPixelSize(resourceId);
    }

    private void refreshStatus() {
        String agentId = prefs.getString(KEY_AGENT_ID, "");
        if (agentId.isEmpty()) {
            setStatus("Sin agente activado.");
            updateAgentToggleButton();
            return;
        }

        setStatus(agentSummary(prefs.getBoolean(KEY_AGENT_ENABLED, false)
                ? "Servicio activo en segundo plano."
                : "No reclama trabajos."));
        updateAgentToggleButton();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 2001);
    }

    private void setStatus(String text) {
        statusView.setText(text);
    }

    private String agentSummary(String detail) {
        boolean enabled = prefs.getBoolean(KEY_AGENT_ENABLED, false);
        return "Agente configurado\n" +
                "Sucursal: " + prefs.getString(KEY_BRANCH_NAME, "") + "\n" +
                "Agent ID: " + prefs.getString(KEY_AGENT_ID, "") + "\n" +
                "Estado: " + (enabled ? "Activo" : "Pausado") + "\n" +
                detail;
    }

    private void updateAgentToggleButton() {
        if (agentToggleButton == null) return;
        boolean hasAgent = !prefs.getString(KEY_AGENT_TOKEN, "").isEmpty();
        boolean enabled = prefs.getBoolean(KEY_AGENT_ENABLED, false);
        agentToggleButton.setEnabled(hasAgent);
        agentToggleButton.setText(enabled ? "Agente activo - pausar" : "Agente pausado - activar");
        agentToggleButton.setBackground(rounded(enabled ? COLOR_DARK : COLOR_BRAND, 7, enabled ? COLOR_DARK : COLOR_BRAND, 1));
    }

    private void toggleAgent() {
        if (prefs.getString(KEY_AGENT_TOKEN, "").isEmpty()) {
            setStatus("Primero activa el agente con un QR.");
            return;
        }

        boolean nextEnabled = !prefs.getBoolean(KEY_AGENT_ENABLED, false);
        prefs.edit().putBoolean(KEY_AGENT_ENABLED, nextEnabled).apply();
        updateAgentToggleButton();
        syncPollingState();

        if (nextEnabled) {
            setStatus(agentSummary("Servicio activo en segundo plano."));
        } else {
            setStatus(agentSummary("No reclama trabajos."));
        }
    }

    private void syncPollingState() {
        if (prefs.getBoolean(KEY_AGENT_ENABLED, false) && !prefs.getString(KEY_AGENT_TOKEN, "").isEmpty()) {
            PrintAgentService.start(this);
        } else {
            PrintAgentService.stop(this);
        }
    }

    private void scheduleNextPoll() {
        if (handler == null) return;
        handler.removeCallbacks(pollRunnable);
        if (prefs.getBoolean(KEY_AGENT_ENABLED, false) && !prefs.getString(KEY_AGENT_TOKEN, "").isEmpty()) {
            handler.postDelayed(pollRunnable, currentPollIntervalMs());
        }
    }

    private void pollAgentOnce() {
        if (!prefs.getBoolean(KEY_AGENT_ENABLED, false) || prefs.getString(KEY_AGENT_TOKEN, "").isEmpty()) {
            return;
        }
        if (pollInFlight) {
            scheduleNextPoll();
            return;
        }

        pollInFlight = true;
        new Thread(() -> {
            String result;
            try {
                result = processPendingJobs();
            } catch (Exception error) {
                result = "Error agente: " + error.getMessage();
            }

            pollInFlight = false;
            String finalResult = result;
            runOnUiThread(() -> {
                setStatus(agentSummary(finalResult));
                scheduleNextPoll();
            });
        }).start();
    }

    private void scanQr() {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(this, options);
        Task<Barcode> task = scanner.startScan();
        task.addOnSuccessListener(barcode -> {
            String raw = barcode.getRawValue();
            if (raw == null || raw.trim().isEmpty()) {
                setStatus("QR sin contenido.");
                return;
            }
            activateFromRaw(raw);
        });
        task.addOnCanceledListener(() -> setStatus("Escaneo cancelado."));
        task.addOnFailureListener(error -> setStatus("No se pudo escanear: " + error.getMessage()));
    }

    private void activateFromRaw(String raw) {
        runAsync("Activando agente...", () -> {
            JSONObject payload = new JSONObject(raw);
            if (!"smartrush-print-agent-activation".equals(payload.optString("type"))) {
                throw new IllegalArgumentException("QR de activacion no valido");
            }

            String supabaseUrl = payload.getString("supabaseUrl");
            String anonKey = payload.getString("supabaseAnonKey");
            JSONObject body = new JSONObject()
                    .put("p_activation_id", payload.getString("activationId"))
                    .put("p_activation_secret", payload.getString("activationSecret"))
                    .put("p_agent_name", "SmartRush Android " + Build.MODEL);

            JSONArray rows = new JSONArray(postRpc(supabaseUrl, anonKey, "activate_print_agent", body));
            if (rows.length() == 0) {
                throw new IllegalStateException("Supabase no devolvio agente");
            }

            JSONObject row = rows.getJSONObject(0);
            prefs.edit()
                    .putString(KEY_SUPABASE_URL, supabaseUrl)
                    .putString(KEY_SUPABASE_ANON_KEY, anonKey)
                    .putString(KEY_AGENT_ID, row.getString("agent_id"))
                    .putString(KEY_AGENT_TOKEN, row.getString("agent_token"))
                    .putString(KEY_BRANCH_NAME, row.optString("branch_name", row.optString("branch_id")))
                    .putInt(KEY_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS)
                    .putInt(KEY_BATCH_SIZE, DEFAULT_BATCH_SIZE)
                    .putInt(KEY_RETRY_DELAY_SECONDS, DEFAULT_RETRY_DELAY_SECONDS)
                    .putBoolean(KEY_AGENT_ENABLED, false)
                    .apply();
            lastConfigSyncAtMs = 0L;
            try {
                syncAgentConfig();
            } catch (Exception ignored) {
                // Keep activation working if the backend migration has not been applied yet.
            }
            runOnUiThread(() -> {
                updateAgentToggleButton();
                syncPollingState();
            });

            return "Agente activado\n" +
                    "Sucursal: " + row.optString("branch_name", "") + "\n" +
                    "Agent ID: " + row.getString("agent_id") + "\n" +
                    "Estado: Pausado";
        });
    }

    private void loadPrinters() {
        runAsync("Consultando impresoras...", () -> {
            ensureAgent();
            lastPrinters = fetchAgentPrinters();

            if (lastPrinters.length() == 0) {
                return "No hay impresoras activas para esta sucursal.";
            }

            StringBuilder result = new StringBuilder("Impresoras activas\n");
            for (int index = 0; index < lastPrinters.length(); index += 1) {
                JSONObject printer = lastPrinters.getJSONObject(index);
                JSONObject connection = printer.optJSONObject("connection");
                result.append("\n")
                        .append(index + 1)
                        .append(". ")
                        .append(printer.optString("name", "Impresora"))
                        .append(" / ")
                        .append(printer.optString("role", ""))
                        .append("\n");
                if (connection != null) {
                    result.append("   ")
                            .append(connection.optString("type", "network"))
                            .append(" ")
                            .append(connection.optString("ip", ""))
                            .append(":")
                            .append(connection.optInt("port", 9100))
                            .append("\n");
                }
            }
            return result.toString();
        });
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

    private void maybeSyncAgentConfig() {
        if (prefs.getString(KEY_AGENT_TOKEN, "").isEmpty()) return;

        long now = System.currentTimeMillis();
        if (lastConfigSyncAtMs > 0 && now - lastConfigSyncAtMs < CONFIG_REFRESH_INTERVAL_MS) {
            return;
        }

        lastConfigSyncAtMs = now;
        try {
            syncAgentConfig();
        } catch (Exception ignored) {
            // Printing should continue with the last known local values if config sync fails.
        }
    }

    private void syncAgentConfig() throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""));

        JSONArray rows = new JSONArray(postRpc(
                prefs.getString(KEY_SUPABASE_URL, ""),
                prefs.getString(KEY_SUPABASE_ANON_KEY, ""),
                "get_print_agent_config",
                body
        ));
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

    private String processPendingJobs() throws Exception {
        maybeSyncAgentConfig();
        JSONArray jobs = claimPrintJobs();
        String checkedAt = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        if (jobs.length() == 0) {
            return "Ultima revision: " + checkedAt + "\nSin trabajos pendientes.";
        }

        JSONArray printers = fetchAgentPrinters();
        int printed = 0;
        int failed = 0;
        StringBuilder details = new StringBuilder();

        for (int index = 0; index < jobs.length(); index += 1) {
            JSONObject job = jobs.getJSONObject(index);
            try {
                processJob(job, printers);
                printed += 1;
                details.append(shortId(job.optString("id"))).append(": impreso\n");
            } catch (Exception error) {
                failed += 1;
                String message = error.getMessage() == null ? String.valueOf(error) : error.getMessage();
                markJobFailed(job.optString("id"), message);
                details.append(shortId(job.optString("id"))).append(": error - ").append(message).append("\n");
            }
        }

        return "Ultima revision: " + checkedAt + "\n" +
                "Procesados: " + jobs.length() + " / impresos: " + printed + " / error: " + failed + "\n" +
                details.toString().trim();
    }

    private JSONArray claimPrintJobs() throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""))
                .put("p_agent_name", prefs.getString(KEY_AGENT_ID, ""))
                .put("p_limit", currentBatchSize());

        return new JSONArray(postRpc(
                prefs.getString(KEY_SUPABASE_URL, ""),
                prefs.getString(KEY_SUPABASE_ANON_KEY, ""),
                "claim_print_jobs_for_agent",
                body
        ));
    }

    private JSONArray fetchAgentPrinters() throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""));

        lastPrinters = new JSONArray(postRpc(
                prefs.getString(KEY_SUPABASE_URL, ""),
                prefs.getString(KEY_SUPABASE_ANON_KEY, ""),
                "get_agent_printers",
                body
        ));
        return lastPrinters;
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

        postRpc(
                prefs.getString(KEY_SUPABASE_URL, ""),
                prefs.getString(KEY_SUPABASE_ANON_KEY, ""),
                "complete_print_job_for_agent",
                body
        );
    }

    private void markJobFailed(String jobId, String message) throws Exception {
        JSONObject body = new JSONObject()
                .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""))
                .put("p_job_id", jobId)
                .put("p_error", message)
                .put("p_retry_delay_seconds", currentRetryDelaySeconds());

        postRpc(
                prefs.getString(KEY_SUPABASE_URL, ""),
                prefs.getString(KEY_SUPABASE_ANON_KEY, ""),
                "fail_print_job_for_agent",
                body
        );
    }

    private void testPrint() {
        runAsync("Enviando prueba...", () -> {
            ensureAgent();
            if (lastPrinters == null) {
                lastPrinters = fetchAgentPrinters();
            }

            JSONObject connection = firstNetworkConnection(lastPrinters);
            if (connection == null) {
                throw new IllegalStateException("No hay impresora de red con IP configurada");
            }

            String ip = connection.getString("ip");
            int port = connection.optInt("port", 9100);
            sendTestTicket(ip, port);

            return "Prueba enviada a " + ip + ":" + port;
        });
    }

    private JSONObject firstNetworkConnection(JSONArray printers) throws Exception {
        JSONObject receipt = firstNetworkConnectionForRole(printers, "receipt");
        if (receipt != null) return receipt;
        return firstNetworkConnectionForRole(printers, "");
    }

    private JSONObject firstNetworkConnectionForRole(JSONArray printers, String preferredRole) throws Exception {
        for (int index = 0; index < printers.length(); index += 1) {
            JSONObject printer = printers.getJSONObject(index);
            if (!preferredRole.isEmpty() && !preferredRole.equals(printer.optString("role", ""))) {
                continue;
            }
            JSONObject connection = printer.optJSONObject("connection");
            if (connection == null) continue;
            String ip = connection.optString("ip", "");
            String type = connection.optString("type", "network");
            if (!ip.isEmpty() && "network".equals(type)) {
                return connection;
            }
        }
        return null;
    }

    private void sendTestTicket(String ip, int port) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bytes.write(new byte[] { 0x1B, 0x40 });
        bytes.write("SMART RUSH\n".getBytes(StandardCharsets.US_ASCII));
        bytes.write("ANDROID PRINT AGENT\n".getBytes(StandardCharsets.US_ASCII));
        bytes.write(("BRANCH: " + prefs.getString(KEY_BRANCH_NAME, "") + "\n").getBytes(StandardCharsets.US_ASCII));
        bytes.write(("AGENT: " + prefs.getString(KEY_AGENT_ID, "") + "\n\n\n").getBytes(StandardCharsets.US_ASCII));
        bytes.write(new byte[] { 0x1D, 0x56, 0x00 });

        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, port), 3000);
            OutputStream output = socket.getOutputStream();
            output.write(bytes.toByteArray());
            output.flush();
        }
    }

    private void clearAgent() {
        if (handler != null) {
            handler.removeCallbacks(pollRunnable);
        }
        PrintAgentService.stop(this);
        prefs.edit().clear().apply();
        lastPrinters = null;
        pollInFlight = false;
        lastConfigSyncAtMs = 0L;
        refreshStatus();
    }

    private void ensureAgent() {
        if (prefs.getString(KEY_AGENT_TOKEN, "").isEmpty()) {
            throw new IllegalStateException("Primero activa el agente con un QR");
        }
    }

    private void runAsync(String pendingText, Worker worker) {
        setStatus(pendingText);
        new Thread(() -> {
            try {
                String result = worker.run();
                runOnUiThread(() -> setStatus(result));
            } catch (Exception error) {
                runOnUiThread(() -> setStatus("Error: " + error.getMessage()));
            }
        }).start();
    }

    private String postRpc(String supabaseUrl, String anonKey, String rpcName, JSONObject body) throws Exception {
        URL url = new URL(trimTrailingSlash(supabaseUrl) + "/rest/v1/rpc/" + rpcName);
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

    private String shortId(String value) {
        if (value == null) return "";
        return value.length() <= 8 ? value : value.substring(0, 8);
    }

    private interface Worker {
        String run() throws Exception;
    }
}
