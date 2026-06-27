package com.smartrush.printagent;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Currency;
import java.util.Locale;

final class TicketRenderer {
    private static final int ESC = 0x1B;
    private static final int GS = 0x1D;
    private static final int WIDTH = 32;
    private static final int FEED_LINES_BEFORE_CUT = 6;

    private TicketRenderer() {
    }

    static byte[] render(Object payloadValue, String jobType) throws Exception {
        if (payloadValue == null || payloadValue == JSONObject.NULL) {
            throw new IllegalArgumentException("Print job payload is empty");
        }

        if (payloadValue instanceof String) {
            return renderStructuredText((String) payloadValue);
        }

        if (!(payloadValue instanceof JSONObject)) {
            throw new IllegalArgumentException("Unsupported print payload");
        }

        JSONObject payload = (JSONObject) payloadValue;
        if (payload.has("rawBase64")) {
            return Base64.decode(payload.getString("rawBase64"), Base64.DEFAULT);
        }
        if (payload.has("rawHex")) {
            return hexToBytes(payload.getString("rawHex"));
        }
        if (isPreTicket(payload)) {
            return renderPreTicket(payload);
        }
        if (isPrepTicket(payload, jobType)) {
            return renderPrepTicket(payload);
        }
        if (isSmartRushTicket(payload)) {
            return renderSmartRushTicket(payload);
        }
        return renderStructuredTicket(payload);
    }

    private static boolean isPreTicket(JSONObject payload) {
        return "pre_ticket".equals(payload.optString("document_kind")) || payload.has("pre_ticket");
    }

    private static boolean isPrepTicket(JSONObject payload, String jobType) {
        String title = payload.optString("title", "").toUpperCase(Locale.ROOT);
        return "prep_ticket".equals(payload.optString("type"))
                || "bar_ticket".equals(jobType)
                || "kitchen_ticket".equals(jobType)
                || "food_ticket".equals(jobType)
                || "kds_ticket".equals(jobType)
                || "BAR".equals(title)
                || "COCINA".equals(title)
                || "KITCHEN".equals(title);
    }

    private static boolean isSmartRushTicket(JSONObject payload) {
        return payload.has("receipt_number") || payload.has("payment") || payload.has("business") || payload.has("order");
    }

    private static byte[] renderPrepTicket(JSONObject payload) throws Exception {
        ByteArrayOutputStream out = startTicket();
        JSONObject order = payload.optJSONObject("order");
        if (order == null) order = new JSONObject();

        String title = firstNonEmpty(
                payload.optString("title", ""),
                payload.optJSONObject("printer") != null
                        ? payload.optJSONObject("printer").optString("role", "").toUpperCase(Locale.ROOT)
                        : "",
                "COMANDA"
        );

        center(out, "*****");
        centerDouble(out, title);
        center(out, "*****");
        divider(out);

        if (!order.optString("table_label", "").isEmpty()) bold(out, "MESA: " + order.optString("table_label"));
        if (order.has("guests_count")) line(out, twoColumns("Personas", order.optString("guests_count")));
        if (!order.optString("sale_by", "").isEmpty()) line(out, twoColumns("Canal", order.optString("sale_by")));
        if (!order.optString("actor_name", "").isEmpty()) line(out, twoColumns("Enviado por", order.optString("actor_name")));
        if (!payload.optString("issued_at", "").isEmpty()) line(out, twoColumns("Hora", formatDate(payload.optString("issued_at"))));

        divider(out);

        JSONArray lines = payload.optJSONArray("lines");
        if (lines != null) {
            for (int index = 0; index < lines.length(); index += 1) {
                JSONObject item = lines.optJSONObject(index);
                if (item == null) continue;
                String quantity = item.optString("quantity", "1");
                String name = firstNonEmpty(item.optString("name", ""), item.optString("text", ""));
                bold(out, quantity + " x " + name);

                String variant = firstNonEmpty(
                        item.optString("variant_label", ""),
                        item.optJSONObject("selected_variant") != null
                                ? item.optJSONObject("selected_variant").optString("name", "")
                                : ""
                );
                if (!variant.isEmpty()) line(out, "  - Variante: " + variant);

                String extras = namesFromArray(item.optJSONArray("extras_labels"), item.optJSONArray("selected_extras"));
                if (!extras.isEmpty()) line(out, "  - Extras: " + extras);

                String combos = namesFromArray(item.optJSONArray("combo_labels"), item.optJSONArray("combo_selections"));
                if (!combos.isEmpty()) line(out, "  - Combo: " + combos);

                String note = firstNonEmpty(item.optString("note_label", ""), item.optString("notes", ""));
                if (!note.isEmpty()) line(out, "  - Nota: " + note);
                line(out, "");
            }
        }

        divider(out);
        JSONObject printer = payload.optJSONObject("printer");
        if (printer != null && !printer.optString("name", "").isEmpty()) {
            center(out, printer.optString("name"));
        }
        finishTicket(out);
        return out.toByteArray();
    }

    private static byte[] renderPreTicket(JSONObject payload) throws Exception {
        ByteArrayOutputStream out = startTicket();
        JSONObject business = payload.optJSONObject("business");
        JSONObject tenant = payload.optJSONObject("tenant");
        JSONObject order = payload.optJSONObject("order");
        JSONObject payment = payload.optJSONObject("payment");
        JSONObject preTicket = payload.optJSONObject("pre_ticket");
        if (preTicket == null) preTicket = new JSONObject();
        JSONObject summary = preTicket.optJSONObject("summary");
        if (summary == null) summary = new JSONObject();

        String businessName = firstNonEmpty(
                business != null ? business.optString("display_name", "") : "",
                tenant != null ? tenant.optString("name", "") : "",
                payload.optString("title", ""),
                "SmartRush"
        );
        String currency = payment != null ? payment.optString("currency", "") : "";

        center(out, businessName);
        if (order != null && !order.optString("table_label", "").isEmpty()) {
            center(out, "Mesa " + order.optString("table_label"));
        }
        center(out, "PRE-TICKET");
        if (!payload.optString("receipt_number", "").isEmpty()) center(out, payload.optString("receipt_number"));
        divider(out);

        if (!payload.optString("issued_at", "").isEmpty()) line(out, twoColumns("Fecha", formatDate(payload.optString("issued_at"))));
        if (order != null && !order.optString("code", "").isEmpty()) line(out, twoColumns("Orden", order.optString("code")));
        if (order != null && !order.optString("sale_by_label", "").isEmpty()) line(out, twoColumns("Canal", order.optString("sale_by_label")));
        if (order != null && !order.optString("table_label", "").isEmpty()) line(out, twoColumns("Mesa", order.optString("table_label")));
        if (!payload.optString("cashier", "").isEmpty()) line(out, twoColumns("Atendido por", payload.optString("cashier")));

        JSONArray sections = preTicket.optJSONArray("sections");
        if (sections != null) {
            for (int sectionIndex = 0; sectionIndex < sections.length(); sectionIndex += 1) {
                JSONObject section = sections.optJSONObject(sectionIndex);
                if (section == null) continue;
                divider(out);
                bold(out, twoColumns(section.optString("label", "Detalle").toUpperCase(Locale.ROOT), money(section.opt("total"), currency)));
                JSONArray items = section.optJSONArray("items");
                if (items == null || items.length() == 0) {
                    line(out, "  Sin items");
                    continue;
                }
                for (int itemIndex = 0; itemIndex < items.length(); itemIndex += 1) {
                    JSONObject item = items.optJSONObject(itemIndex);
                    if (item == null) continue;
                    String quantity = item.optString("quantity", "1");
                    String name = firstNonEmpty(item.optString("name", ""), item.optString("text", ""));
                    line(out, twoColumns(quantity + " x " + name, money(item.opt("line_total"), currency)));
                    if (item.has("unit_price")) line(out, twoColumns("  Unitario", money(item.opt("unit_price"), currency)));
                    if (item.has("paid_amount")) line(out, twoColumns("  Pagado", money(item.opt("paid_amount"), currency)));
                    if (item.has("outstanding_amount")) line(out, twoColumns("  Pendiente", money(item.opt("outstanding_amount"), currency)));
                    if (!item.optString("notes", "").isEmpty()) line(out, "  Nota: " + item.optString("notes"));
                    line(out, "");
                }
            }
        }

        divider(out);
        if (summary.has("total_account")) line(out, twoColumns("Total cuenta", money(summary.opt("total_account"), currency)));
        if (summary.has("total_paid")) line(out, twoColumns("Total pagado", money(summary.opt("total_paid"), currency)));
        if (summary.has("total_due")) bold(out, twoColumns("Total por pagar", money(summary.opt("total_due"), currency)));
        center(out, firstNonEmpty(payload.optString("footer", ""), "Documento no fiscal"));
        center(out, "Sistema automatizado por Smart Rush");
        finishTicket(out);
        return out.toByteArray();
    }

    private static byte[] renderSmartRushTicket(JSONObject payload) throws Exception {
        ByteArrayOutputStream out = startTicket();
        JSONObject business = payload.optJSONObject("business");
        JSONObject tenant = payload.optJSONObject("tenant");
        JSONObject branch = payload.optJSONObject("branch");
        JSONObject order = payload.optJSONObject("order");
        JSONObject payment = payload.optJSONObject("payment");
        JSONObject billing = payload.optJSONObject("billing");

        String businessName = firstNonEmpty(
                business != null ? business.optString("display_name", "") : "",
                tenant != null ? tenant.optString("name", "") : "",
                payload.optString("title", ""),
                "SmartRush"
        );
        String currency = payment != null ? payment.optString("currency", "") : "";
        String receiptLabel = "invoice".equals(payload.optString("receipt_type")) ? "Factura" : "Ticket";

        center(out, businessName);
        if (branch != null && !branch.optString("name", "").isEmpty() && !branch.optString("name").equals(businessName)) {
            center(out, branch.optString("name"));
        }
        if (business != null && !business.optString("billing_tax_id", "").isEmpty()) center(out, "NIF/VAT: " + business.optString("billing_tax_id"));
        if (!payload.optString("receipt_number", "").isEmpty()) center(out, receiptLabel + " " + payload.optString("receipt_number"));
        divider(out);

        if (!payload.optString("issued_at", "").isEmpty()) line(out, twoColumns("Fecha", formatDate(payload.optString("issued_at"))));
        if (order != null && !order.optString("code", "").isEmpty()) line(out, twoColumns("Orden", order.optString("code")));
        else if (!payload.optString("order_id", "").isEmpty()) line(out, twoColumns("Orden", shortId(payload.optString("order_id"))));
        if (order != null && !order.optString("sale_by_label", "").isEmpty()) line(out, twoColumns("Canal", order.optString("sale_by_label")));
        if (order != null && !order.optString("table_label", "").isEmpty()) line(out, "Mesa: " + order.optString("table_label"));
        if (!payload.optString("cashier", "").isEmpty()) line(out, twoColumns("Atendido por", payload.optString("cashier")));

        if (billing != null && !billing.optString("name", "").isEmpty()) {
            divider(out);
            line(out, twoColumns("Cliente", billing.optString("name")));
            if (!billing.optString("vat", "").isEmpty()) line(out, twoColumns("VAT/NIF", billing.optString("vat")));
        }

        divider(out);
        JSONArray lines = payload.optJSONArray("lines");
        if (lines != null) {
            for (int index = 0; index < lines.length(); index += 1) {
                JSONObject item = lines.optJSONObject(index);
                if (item == null) continue;
                String quantity = item.optString("quantity", "1");
                String name = firstNonEmpty(item.optString("name", ""), item.optString("text", ""));
                Object totalValue = firstPresent(item, "paid_amount", "line_total", "total", "price");
                Object unitValue = firstPresent(item, "unit_price", "price");
                line(out, twoColumns(name, money(totalValue, currency)));
                line(out, "  " + quantity + " x " + money(unitValue, currency)
                        + (!item.optString("notes", "").isEmpty() ? " - " + item.optString("notes") : ""));
            }
        }

        if (payment != null) {
            divider(out);
            if (payment.has("subtotal")) line(out, twoColumns("Subtotal", money(payment.opt("subtotal"), currency)));
            if (number(payment.opt("discount")) > 0) line(out, twoColumns("Descuento", "-" + money(payment.opt("discount"), currency)));
            if (number(payment.opt("tip")) > 0) line(out, twoColumns("Propina", money(payment.opt("tip"), currency)));
            if (payment.has("total")) bold(out, twoColumns("Total", money(payment.opt("total"), currency)));
            String method = firstNonEmpty(payment.optString("method_label", ""), payment.optString("method", ""));
            if (!method.isEmpty()) line(out, twoColumns("Metodo", method));
            if (payment.has("cash_received")) line(out, twoColumns("Recibido", money(payment.opt("cash_received"), currency)));
            if (payment.has("change_due")) line(out, twoColumns("Cambio", money(payment.opt("change_due"), currency)));
        }

        divider(out);
        center(out, firstNonEmpty(payload.optString("footer", ""), "Gracias por su compra."));
        center(out, "Sistema automatizado por Smart Rush");
        center(out, "www.smartrush.io");
        finishTicket(out);
        return out.toByteArray();
    }

    private static byte[] renderStructuredTicket(JSONObject payload) throws Exception {
        ByteArrayOutputStream out = startTicket();
        if (!payload.optString("title", "").isEmpty()) {
            center(out, payload.optString("title"));
            divider(out);
        }
        if (!payload.optString("orderNumber", "").isEmpty()) bold(out, "Pedido: " + payload.optString("orderNumber"));
        if (!payload.optString("table", "").isEmpty()) line(out, "Mesa: " + payload.optString("table"));
        if (!payload.optString("customer", "").isEmpty()) line(out, "Cliente: " + payload.optString("customer"));
        if (!payload.optString("createdAt", "").isEmpty()) line(out, "Fecha: " + payload.optString("createdAt"));

        JSONArray lines = payload.optJSONArray("lines");
        if (lines != null) {
            divider(out);
            for (int index = 0; index < lines.length(); index += 1) {
                Object value = lines.opt(index);
                if (value instanceof String) {
                    line(out, (String) value);
                    continue;
                }
                if (value instanceof JSONObject) {
                    JSONObject item = (JSONObject) value;
                    String quantity = firstNonEmpty(item.optString("quantity", ""), item.optString("qty", ""));
                    String name = firstNonEmpty(item.optString("name", ""), item.optString("text", ""));
                    String prefix = quantity.isEmpty() ? "" : quantity + " x ";
                    line(out, prefix + name + (!item.optString("price", "").isEmpty() ? " " + item.optString("price") : ""));
                    String note = firstNonEmpty(item.optString("note", ""), item.optString("notes", ""));
                    if (!note.isEmpty()) line(out, "  " + note);
                }
            }
        }

        if (!payload.optString("text", "").isEmpty()) line(out, payload.optString("text"));
        if (!payload.optString("footer", "").isEmpty()) {
            divider(out);
            center(out, payload.optString("footer"));
        }
        finishTicket(out);
        return out.toByteArray();
    }

    private static byte[] renderStructuredText(String text) throws Exception {
        ByteArrayOutputStream out = startTicket();
        line(out, text);
        finishTicket(out);
        return out.toByteArray();
    }

    private static ByteArrayOutputStream startTicket() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        command(out, ESC, 0x40);
        return out;
    }

    private static void finishTicket(ByteArrayOutputStream out) throws Exception {
        for (int index = 0; index < FEED_LINES_BEFORE_CUT; index += 1) line(out, "");
        command(out, GS, 0x56, 0x00);
    }

    private static void command(ByteArrayOutputStream out, int... bytes) {
        for (int value : bytes) out.write(value);
    }

    private static void line(ByteArrayOutputStream out, String text) throws Exception {
        out.write(text(text));
        out.write('\n');
    }

    private static void center(ByteArrayOutputStream out, String text) throws Exception {
        command(out, ESC, 0x61, 0x01);
        line(out, text);
        command(out, ESC, 0x61, 0x00);
    }

    private static void centerDouble(ByteArrayOutputStream out, String text) throws Exception {
        command(out, ESC, 0x61, 0x01);
        command(out, GS, 0x21, 0x11);
        line(out, text);
        command(out, GS, 0x21, 0x00);
        command(out, ESC, 0x61, 0x00);
    }

    private static void bold(ByteArrayOutputStream out, String text) throws Exception {
        command(out, ESC, 0x45, 0x01);
        line(out, text);
        command(out, ESC, 0x45, 0x00);
    }

    private static void divider(ByteArrayOutputStream out) throws Exception {
        line(out, "--------------------------------");
    }

    private static byte[] text(String value) {
        return String.valueOf(value).getBytes(printerCharset());
    }

    private static Charset printerCharset() {
        for (String name : new String[] { "CP858", "IBM00858", "CP437", "ISO-8859-1" }) {
            try {
                return Charset.forName(name);
            } catch (Exception ignored) {
            }
        }
        return StandardCharsets.UTF_8;
    }

    private static String twoColumns(String left, String right) {
        String cleanLeft = left == null ? "" : left;
        String cleanRight = right == null ? "" : right;
        int spaces = Math.max(1, WIDTH - cleanLeft.length() - cleanRight.length());
        return cleanLeft + repeat(" ", spaces) + cleanRight;
    }

    private static String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < count; index += 1) builder.append(value);
        return builder.toString();
    }

    private static String money(Object value, String currencyCode) {
        if (value == null || value == JSONObject.NULL || String.valueOf(value).isEmpty()) return "";
        double amount = number(value);
        if (Double.isNaN(amount)) return String.valueOf(value);
        try {
            String code = normalizeCurrency(currencyCode);
            NumberFormat format = NumberFormat.getCurrencyInstance(new Locale("es"));
            format.setCurrency(Currency.getInstance(code));
            return format.format(amount).replace('\u00A0', ' ');
        } catch (Exception ignored) {
            return String.format(Locale.US, "%.2f", amount);
        }
    }

    private static String normalizeCurrency(String value) {
        String candidate = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
        if (candidate.matches("^[A-Z]{3}$")) return candidate;
        if ("EURO".equals(candidate) || "EUROS".equals(candidate)) return "EUR";
        if ("$".equals(candidate)) return "USD";
        return "USD";
    }

    private static double number(Object value) {
        if (value == null || value == JSONObject.NULL) return Double.NaN;
        if (value instanceof Number) return ((Number) value).doubleValue();
        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (Exception ignored) {
            return Double.NaN;
        }
    }

    private static String formatDate(String value) {
        if (value == null || value.trim().isEmpty()) return "";
        try {
            return OffsetDateTime.parse(value).format(DateTimeFormatter.ofPattern("dd/MM/yy HH:mm"));
        } catch (Exception ignored) {
            return value;
        }
    }

    private static String namesFromArray(JSONArray... arrays) {
        StringBuilder result = new StringBuilder();
        for (JSONArray array : arrays) {
            if (array == null) continue;
            for (int index = 0; index < array.length(); index += 1) {
                Object value = array.opt(index);
                String label = "";
                if (value instanceof String) label = (String) value;
                else if (value instanceof JSONObject) {
                    JSONObject item = (JSONObject) value;
                    label = firstNonEmpty(item.optString("name", ""), item.optString("label", ""), item.optString("title", ""));
                }
                if (label.trim().isEmpty()) continue;
                if (result.length() > 0) result.append(", ");
                result.append(label.trim());
            }
        }
        return result.toString();
    }

    private static Object firstPresent(JSONObject object, String... keys) {
        for (String key : keys) {
            if (object.has(key) && object.opt(key) != JSONObject.NULL) return object.opt(key);
        }
        return null;
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value.trim();
        }
        return "";
    }

    private static String shortId(String value) {
        return value.length() <= 8 ? value : value.substring(0, 8);
    }

    private static byte[] hexToBytes(String value) {
        String clean = value.replaceAll("\\s+", "");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int index = 0; index + 1 < clean.length(); index += 2) {
            out.write(Integer.parseInt(clean.substring(index, index + 2), 16));
        }
        return out.toByteArray();
    }
}
