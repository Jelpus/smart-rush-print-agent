package com.smartrush.printagent;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Currency;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

final class TicketRenderer {
    private static final int ESC = 0x1B;
    private static final int GS = 0x1D;
    private static final int WIDTH = 32;
    private static final int FEED_LINES_BEFORE_CUT = 6;
    private static final int MAX_LOGO_WIDTH = 192;
    private static final int MAX_LOGO_HEIGHT = 96;
    private static final Map<String, byte[]> LOGO_CACHE = new ConcurrentHashMap<>();

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
        String timeZone = payloadTimeZone(payload);

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

        String tableLabel = firstNonEmpty(order.optString("table_label", ""));
        if (!tableLabel.isEmpty()) bold(out, "MESA: " + tableLabel);
        if (!cleanText(order.opt("guests_count")).isEmpty()) line(out, twoColumns("Personas", cleanText(order.opt("guests_count"))));
        if (!firstNonEmpty(order.optString("sale_by", "")).isEmpty()) line(out, twoColumns("Canal", order.optString("sale_by")));
        if (!firstNonEmpty(order.optString("actor_name", "")).isEmpty()) line(out, twoColumns("Enviado por", order.optString("actor_name")));
        if (!firstNonEmpty(payload.optString("issued_at", "")).isEmpty()) line(out, twoColumns("Hora", formatDate(payload.optString("issued_at"), timeZone)));

        divider(out);

        JSONArray lines = payload.optJSONArray("lines");
        if (lines != null) {
            for (int index = 0; index < lines.length(); index += 1) {
                JSONObject item = lines.optJSONObject(index);
                if (item == null) continue;
                String quantity = firstNonEmpty(item.optString("quantity", ""), "1");
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
        writeLogoIfPresent(out, payload);
        JSONObject business = payload.optJSONObject("business");
        JSONObject tenant = payload.optJSONObject("tenant");
        JSONObject order = payload.optJSONObject("order");
        JSONObject payment = payload.optJSONObject("payment");
        JSONObject preTicket = payload.optJSONObject("pre_ticket");
        if (preTicket == null) preTicket = new JSONObject();
        JSONObject summary = preTicket.optJSONObject("summary");
        if (summary == null) summary = new JSONObject();
        JSONArray discounts = preTicket.optJSONArray("discounts");
        if (discounts == null) discounts = preTicket.optJSONArray("applied_promotions");

        double subtotal = finiteNumber(summary.opt("total_account"), 0);
        double totalPaid = finiteNumber(summary.opt("total_paid"), 0);
        boolean hasExplicitTotalDue = summary.has("total_due") && summary.opt("total_due") != JSONObject.NULL;
        double explicitTotalDue = finiteNumber(summary.opt("total_due"), 0);
        double totalDiscounts = finiteNumber(summary.opt("total_discounts"), 0);
        if (totalDiscounts <= 0 && discounts != null) {
            for (int index = 0; index < discounts.length(); index += 1) {
                JSONObject discount = discounts.optJSONObject(index);
                if (discount == null) continue;
                totalDiscounts += finiteNumber(firstPresent(discount, "amount", "discount"), 0);
            }
        }
        if (totalDiscounts <= 0 && hasExplicitTotalDue) {
            totalDiscounts = Math.max(0, subtotal - totalPaid - explicitTotalDue);
        }
        boolean hasPayments = totalPaid > 0;
        boolean hasDiscounts = totalDiscounts > 0;
        double totalAfterDiscounts = summary.has("total_after_discounts")
                ? finiteNumber(summary.opt("total_after_discounts"), 0)
                : Math.max(0, subtotal - totalDiscounts);
        double totalDue = hasExplicitTotalDue
                ? explicitTotalDue
                : Math.max(0, totalAfterDiscounts - totalPaid);

        String businessName = firstNonEmpty(
                business != null ? business.optString("display_name", "") : "",
                tenant != null ? tenant.optString("name", "") : "",
                payload.optString("title", ""),
                "SmartRush"
        );
        String currency = payment != null ? payment.optString("currency", "") : "";
        String timeZone = payloadTimeZone(payload);

        center(out, businessName);
        if (order != null && !firstNonEmpty(order.optString("table_label", "")).isEmpty()) {
            center(out, "Mesa " + firstNonEmpty(order.optString("table_label", "")));
        }
        center(out, "PRE-TICKET");
        if (!firstNonEmpty(payload.optString("receipt_number", "")).isEmpty()) center(out, firstNonEmpty(payload.optString("receipt_number", "")));
        contentDivider(out);

        if (!firstNonEmpty(payload.optString("issued_at", "")).isEmpty()) contentLine(out, twoColumns("Fecha", formatDate(payload.optString("issued_at"), timeZone)));
        if (order != null && !firstNonEmpty(order.optString("code", "")).isEmpty()) contentLine(out, twoColumns("Orden", order.optString("code")));
        if (order != null && !firstNonEmpty(order.optString("sale_by_label", "")).isEmpty()) contentLine(out, twoColumns("Canal", order.optString("sale_by_label")));
        if (order != null && !firstNonEmpty(order.optString("table_label", "")).isEmpty()) contentLine(out, twoColumns("Mesa", order.optString("table_label")));
        if (!firstNonEmpty(payload.optString("cashier", "")).isEmpty()) contentLine(out, twoColumns("Atendido por", payload.optString("cashier")));

        JSONArray sections = preTicket.optJSONArray("sections");
        boolean detailStarted = false;
        if (sections != null) {
            for (int sectionIndex = 0; sectionIndex < sections.length(); sectionIndex += 1) {
                JSONObject section = sections.optJSONObject(sectionIndex);
                if (section == null) continue;
                JSONArray items = section.optJSONArray("items");
                if (items == null || items.length() == 0) continue;
                if (!detailStarted) {
                    contentDivider(out);
                    contentBold(out, "DETALLE");
                    detailStarted = true;
                }
                for (int itemIndex = 0; itemIndex < items.length(); itemIndex += 1) {
                    JSONObject item = items.optJSONObject(itemIndex);
                    if (item == null) continue;
                    String quantity = firstNonEmpty(item.optString("quantity", ""), "1");
                    String name = firstNonEmpty(item.optString("name", ""), item.optString("text", ""));
                    contentLine(out, twoColumns(quantity + " x " + name, money(item.opt("line_total"), currency)));
                    String note = firstNonEmpty(item.optString("notes", ""));
                    if (!note.isEmpty()) contentLine(out, "  Nota: " + note);
                    contentLine(out, "");
                }
            }
        }

        contentDivider(out);
        if (!hasPayments && !hasDiscounts) {
            contentBold(out, twoColumns("TOTAL A PAGAR", money(totalDue, currency)));
        } else {
            contentLine(out, twoColumns("Subtotal", money(subtotal, currency)));
            if (hasDiscounts) contentLine(out, twoColumns("Descuento / promo", "-" + money(totalDiscounts, currency)));
            if (hasPayments) {
                if (hasDiscounts) contentLine(out, twoColumns("Total con descuento", money(totalAfterDiscounts, currency)));
                contentLine(out, twoColumns("Pagado", "-" + money(totalPaid, currency)));
            }
            contentBold(out, twoColumns("TOTAL A PAGAR", money(totalDue, currency)));
        }
        center(out, firstNonEmpty(payload.optString("footer", ""), "Documento no fiscal"));
        center(out, "Sistema automatizado por Smart Rush");
        finishTicket(out);
        return out.toByteArray();
    }

    private static byte[] renderSmartRushTicket(JSONObject payload) throws Exception {
        ByteArrayOutputStream out = startTicket();
        writeLogoIfPresent(out, payload);
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
        String timeZone = payloadTimeZone(payload);

        center(out, businessName);
        if (branch != null && !firstNonEmpty(branch.optString("name", "")).isEmpty() && !firstNonEmpty(branch.optString("name", "")).equals(businessName)) {
            center(out, firstNonEmpty(branch.optString("name", "")));
        }
        if (business != null && !firstNonEmpty(business.optString("billing_tax_id", "")).isEmpty()) center(out, "NIF/VAT: " + firstNonEmpty(business.optString("billing_tax_id", "")));
        if (!firstNonEmpty(payload.optString("receipt_number", "")).isEmpty()) center(out, receiptLabel + " " + firstNonEmpty(payload.optString("receipt_number", "")));
        contentDivider(out);

        if (!firstNonEmpty(payload.optString("issued_at", "")).isEmpty()) contentLine(out, twoColumns("Fecha", formatDate(payload.optString("issued_at"), timeZone)));
        if (order != null && !firstNonEmpty(order.optString("code", "")).isEmpty()) contentLine(out, twoColumns("Orden", order.optString("code")));
        else if (!firstNonEmpty(payload.optString("order_id", "")).isEmpty()) contentLine(out, twoColumns("Orden", shortId(payload.optString("order_id"))));
        if (order != null && !firstNonEmpty(order.optString("sale_by_label", "")).isEmpty()) contentLine(out, twoColumns("Canal", order.optString("sale_by_label")));
        if (order != null && !firstNonEmpty(order.optString("table_label", "")).isEmpty()) contentLine(out, "Mesa: " + firstNonEmpty(order.optString("table_label", "")));
        if (!firstNonEmpty(payload.optString("cashier", "")).isEmpty()) contentLine(out, twoColumns("Atendido por", payload.optString("cashier")));

        if (billing != null && !firstNonEmpty(billing.optString("name", "")).isEmpty()) {
            contentDivider(out);
            contentLine(out, twoColumns("Cliente", billing.optString("name")));
            if (!firstNonEmpty(billing.optString("vat", "")).isEmpty()) contentLine(out, twoColumns("VAT/NIF", billing.optString("vat")));
        }

        contentDivider(out);
        JSONArray lines = payload.optJSONArray("lines");
        if (lines != null) {
            for (int index = 0; index < lines.length(); index += 1) {
                JSONObject item = lines.optJSONObject(index);
                if (item == null) continue;
                String quantity = firstNonEmpty(item.optString("quantity", ""), "1");
                String name = firstNonEmpty(item.optString("name", ""), item.optString("text", ""));
                Object totalValue = firstPresent(item, "paid_amount", "line_total", "total", "price");
                Object unitValue = firstPresent(item, "unit_price", "price");
                String note = firstNonEmpty(item.optString("notes", ""));
                contentLine(out, twoColumns(name, money(totalValue, currency)));
                contentLine(out, "  " + quantity + " x " + money(unitValue, currency)
                        + (!note.isEmpty() ? " - " + note : ""));
            }
        }

        if (payment != null) {
            contentDivider(out);
            if (payment.has("subtotal")) contentLine(out, twoColumns("Subtotal", money(payment.opt("subtotal"), currency)));
            if (number(payment.opt("discount")) > 0) contentLine(out, twoColumns("Descuento", "-" + money(payment.opt("discount"), currency)));
            if (number(payment.opt("tip")) > 0) contentLine(out, twoColumns("Propina", money(payment.opt("tip"), currency)));
            if (payment.has("total")) contentBold(out, twoColumns("Total", money(payment.opt("total"), currency)));
            String method = firstNonEmpty(payment.optString("method_label", ""), payment.optString("method", ""));
            if (!method.isEmpty()) contentLine(out, twoColumns("Metodo", method));
            if (payment.has("cash_received")) contentLine(out, twoColumns("Recibido", money(payment.opt("cash_received"), currency)));
            if (payment.has("change_due")) contentLine(out, twoColumns("Cambio", money(payment.opt("change_due"), currency)));
        }

        contentDivider(out);
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

    private static void contentLine(ByteArrayOutputStream out, String text) throws Exception {
        command(out, ESC, 0x61, 0x01);
        line(out, contentBlockText(text));
        command(out, ESC, 0x61, 0x00);
    }

    private static void contentBold(ByteArrayOutputStream out, String text) throws Exception {
        command(out, ESC, 0x61, 0x01);
        command(out, ESC, 0x45, 0x01);
        line(out, contentBlockText(text));
        command(out, ESC, 0x45, 0x00);
        command(out, ESC, 0x61, 0x00);
    }

    private static void contentDivider(ByteArrayOutputStream out) throws Exception {
        contentLine(out, repeat("-", WIDTH));
    }

    private static String contentBlockText(String value) {
        String clean = cleanLineValue(value);
        if (clean.length() >= WIDTH) return clean;
        return clean + repeat(" ", WIDTH - clean.length());
    }

    private static void writeLogoIfPresent(ByteArrayOutputStream out, JSONObject payload) throws Exception {
        String logoUrl = logoUrlForPayload(payload);
        if (logoUrl.isEmpty()) return;

        try {
            byte[] logo = LOGO_CACHE.get(logoUrl);
            if (logo == null) {
                logo = downloadLogo(logoUrl);
                if (logo != null) LOGO_CACHE.put(logoUrl, logo);
            }
            if (logo != null) {
                out.write(logo);
                line(out, "");
            }
        } catch (Exception ignored) {
            // The logo is optional; printing must continue if the image cannot be fetched or decoded.
        }
    }

    private static String logoUrlForPayload(JSONObject payload) {
        JSONObject business = payload.optJSONObject("business");
        JSONObject settings = payload.optJSONObject("tenant_business_settings");
        return firstNonEmpty(
                business != null ? business.optString("brand_logo_url", "") : "",
                business != null ? business.optString("brandLogoUrl", "") : "",
                settings != null ? settings.optString("brand_logo_url", "") : "",
                settings != null ? settings.optString("brandLogoUrl", "") : "",
                payload.optString("brand_logo_url", ""),
                payload.optString("brandLogoUrl", "")
        );
    }

    private static byte[] downloadLogo(String logoUrl) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(logoUrl).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        connection.setInstanceFollowRedirects(true);

        try {
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) return null;

            try (InputStream input = connection.getInputStream()) {
                Bitmap bitmap = BitmapFactory.decodeStream(input);
                if (bitmap == null) return null;
                return renderBitmapLogo(bitmap);
            }
        } finally {
            connection.disconnect();
        }
    }

    private static byte[] renderBitmapLogo(Bitmap bitmap) throws Exception {
        int[] bounds = contentBounds(bitmap);
        if (bounds == null) return null;

        int sourceWidth = bounds[2] - bounds[0] + 1;
        int sourceHeight = bounds[3] - bounds[1] + 1;
        double scale = Math.min(1.0, Math.min((double) MAX_LOGO_WIDTH / sourceWidth, (double) MAX_LOGO_HEIGHT / sourceHeight));
        int width = Math.max(1, (int) Math.round(sourceWidth * scale));
        int height = Math.max(1, (int) Math.round(sourceHeight * scale));
        int rowBytes = (int) Math.ceil(width / 8.0);
        byte[] raster = new byte[rowBytes * height];

        for (int y = 0; y < height; y += 1) {
            int sourceY = bounds[1] + Math.min(sourceHeight - 1, (int) Math.floor(y / scale));
            for (int x = 0; x < width; x += 1) {
                int sourceX = bounds[0] + Math.min(sourceWidth - 1, (int) Math.floor(x / scale));
                if (isInk(bitmap.getPixel(sourceX, sourceY), 190)) {
                    raster[y * rowBytes + x / 8] |= (byte) (0x80 >> (x % 8));
                }
            }
        }

        ByteArrayOutputStream image = new ByteArrayOutputStream();
        command(image, ESC, 0x61, 0x01);
        command(image, GS, 0x76, 0x30, 0x00, rowBytes & 0xFF, (rowBytes >> 8) & 0xFF, height & 0xFF, (height >> 8) & 0xFF);
        image.write(raster);
        image.write('\n');
        command(image, ESC, 0x61, 0x00);
        return image.toByteArray();
    }

    private static int[] contentBounds(Bitmap bitmap) {
        int left = bitmap.getWidth();
        int right = -1;
        int top = bitmap.getHeight();
        int bottom = -1;

        for (int y = 0; y < bitmap.getHeight(); y += 1) {
            for (int x = 0; x < bitmap.getWidth(); x += 1) {
                if (!isInk(bitmap.getPixel(x, y), 245)) continue;
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
            }
        }

        if (right < left || bottom < top) return null;
        return new int[] { left, top, right, bottom };
    }

    private static boolean isInk(int pixel, int threshold) {
        int alpha = Color.alpha(pixel);
        if (alpha < 32) return false;

        double alphaRatio = alpha / 255.0;
        double red = Color.red(pixel) * alphaRatio + 255 * (1 - alphaRatio);
        double green = Color.green(pixel) * alphaRatio + 255 * (1 - alphaRatio);
        double blue = Color.blue(pixel) * alphaRatio + 255 * (1 - alphaRatio);
        double luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
        return luminance < threshold;
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
        String cleanLeft = cleanLineValue(left);
        String cleanRight = cleanLineValue(right);
        int spaces = Math.max(1, WIDTH - cleanLeft.length() - cleanRight.length());
        return cleanLeft + repeat(" ", spaces) + cleanRight;
    }

    private static String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < count; index += 1) builder.append(value);
        return builder.toString();
    }

    private static String cleanText(Object value) {
        if (value == null || value == JSONObject.NULL) return "";
        String text = String.valueOf(value).trim();
        if (text.isEmpty()) return "";
        String lower = text.toLowerCase(Locale.ROOT);
        if ("null".equals(lower) || "undefined".equals(lower) || "nan".equals(lower)) return "";
        return text;
    }

    private static String cleanLineValue(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return "";
        String lower = trimmed.toLowerCase(Locale.ROOT);
        if ("null".equals(lower) || "undefined".equals(lower) || "nan".equals(lower)) return "";
        return value;
    }

    private static String money(Object value, String currencyCode) {
        String raw = cleanText(value);
        if (raw.isEmpty()) return "";
        double amount = number(raw);
        if (Double.isNaN(amount)) return raw;
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

    private static double finiteNumber(Object value, double fallback) {
        double amount = number(value);
        return Double.isNaN(amount) || Double.isInfinite(amount) ? fallback : amount;
    }

    private static String formatDate(String value, String timeZone) {
        String clean = cleanText(value);
        if (clean.isEmpty()) return "";
        try {
            OffsetDateTime date = OffsetDateTime.parse(clean);
            String zone = safeTimeZone(timeZone);
            if (!zone.isEmpty()) {
                return date.atZoneSameInstant(ZoneId.of(zone)).format(DateTimeFormatter.ofPattern("dd/MM/yy HH:mm"));
            }
            return date.format(DateTimeFormatter.ofPattern("dd/MM/yy HH:mm"));
        } catch (Exception ignored) {
            return clean;
        }
    }

    private static String safeTimeZone(String value) {
        String candidate = cleanText(value);
        if ("Lima".equals(candidate) || "Peru".equals(candidate)) return "America/Lima";
        if ("Barcelona".equals(candidate) || "Madrid".equals(candidate) || "Spain".equals(candidate)) {
            return "Europe/Madrid";
        }
        if (candidate.isEmpty()) return "";
        try {
            ZoneId.of(candidate);
            return candidate;
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String payloadTimeZone(JSONObject payload) {
        JSONObject branch = payload.optJSONObject("branch");
        return firstNonEmpty(
                branch != null ? branch.optString("timezone", "") : "",
                payload.optString("timezone", "")
        );
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
            String clean = cleanText(value);
            if (!clean.isEmpty()) return clean;
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
