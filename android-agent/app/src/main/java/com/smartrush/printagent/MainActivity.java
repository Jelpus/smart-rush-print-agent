package com.smartrush.printagent;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
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

    private SharedPreferences prefs;
    private TextView statusView;
    private JSONArray lastPrinters;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildUi();
        refreshStatus();
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
            return;
        }

        setStatus(
                "Agente activo\n" +
                "Sucursal: " + prefs.getString(KEY_BRANCH_NAME, "") + "\n" +
                "Agent ID: " + agentId
        );
    }

    private void setStatus(String text) {
        statusView.setText(text);
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
                    .apply();

            return "Agente activado\n" +
                    "Sucursal: " + row.optString("branch_name", "") + "\n" +
                    "Agent ID: " + row.getString("agent_id");
        });
    }

    private void loadPrinters() {
        runAsync("Consultando impresoras...", () -> {
            ensureAgent();
            JSONObject body = new JSONObject()
                    .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""));
            lastPrinters = new JSONArray(postRpc(
                    prefs.getString(KEY_SUPABASE_URL, ""),
                    prefs.getString(KEY_SUPABASE_ANON_KEY, ""),
                    "get_agent_printers",
                    body
            ));

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

    private void testPrint() {
        runAsync("Enviando prueba...", () -> {
            ensureAgent();
            if (lastPrinters == null) {
                JSONObject body = new JSONObject()
                        .put("p_agent_token", prefs.getString(KEY_AGENT_TOKEN, ""));
                lastPrinters = new JSONArray(postRpc(
                        prefs.getString(KEY_SUPABASE_URL, ""),
                        prefs.getString(KEY_SUPABASE_ANON_KEY, ""),
                        "get_agent_printers",
                        body
                ));
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
        prefs.edit().clear().apply();
        lastPrinters = null;
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

    private interface Worker {
        String run() throws Exception;
    }
}
