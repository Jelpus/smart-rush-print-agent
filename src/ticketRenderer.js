const iconv = require("iconv-lite");
const { config } = require("./config");

const ESC = 0x1b;
const GS = 0x1d;
const WIDTH = 32;
const BLANK_STRINGS = new Set(["null", "undefined", "nan"]);

function command(...bytes) {
  return Buffer.from(bytes);
}

function textBuffer(text) {
  return iconv.encode(String(text), config.printerEncoding);
}

function line(text = "") {
  return Buffer.concat([textBuffer(text), Buffer.from("\n")]);
}

function feed(lines) {
  return Buffer.from("\n".repeat(Math.max(0, lines)));
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  return BLANK_STRINGS.has(text.toLowerCase()) ? "" : text;
}

function cleanLineValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const trimmed = text.trim();
  if (!trimmed) return "";
  return BLANK_STRINGS.has(trimmed.toLowerCase()) ? "" : text;
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function center(text) {
  return Buffer.concat([command(ESC, 0x61, 0x01), line(text), command(ESC, 0x61, 0x00)]);
}

function centerRaw(buffer) {
  return Buffer.concat([command(ESC, 0x61, 0x01), buffer, command(ESC, 0x61, 0x00)]);
}

function bold(text) {
  return Buffer.concat([command(ESC, 0x45, 0x01), line(text), command(ESC, 0x45, 0x00)]);
}

function doubleSize(text) {
  return Buffer.concat([command(GS, 0x21, 0x11), line(text), command(GS, 0x21, 0x00)]);
}

function divider() {
  return line("-".repeat(WIDTH));
}

function contentBlockText(text = "") {
  const clean = cleanLineValue(text);
  return clean.length >= WIDTH ? clean : clean.padEnd(WIDTH, " ");
}

function contentLine(text = "") {
  return centerRaw(line(contentBlockText(text)));
}

function contentBold(text = "") {
  return centerRaw(
    Buffer.concat([
      command(ESC, 0x45, 0x01),
      line(contentBlockText(text)),
      command(ESC, 0x45, 0x00),
    ]),
  );
}

function contentDivider() {
  return contentLine("-".repeat(WIDTH));
}

function logoBlock(options = {}) {
  return options.logo ? Buffer.concat([options.logo, feed(1)]) : null;
}

function normalizeCurrency(value) {
  const candidate = String(value || "USD").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(candidate)) return candidate;
  if (candidate === "EURO" || candidate === "EUROS") return "EUR";
  if (candidate === "$") return "USD";
  return "USD";
}

function money(value, currency) {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    return new Intl.NumberFormat("es", {
      style: "currency",
      currency: normalizeCurrency(currency),
    })
      .format(Number(raw))
      .replace(/\u00a0/g, " ");
  } catch {
    const number = Number(raw);
    const amount = Number.isFinite(number) ? number.toFixed(2) : raw;
    return currency ? `${amount} ${currency}` : amount;
  }
}

function safeTimeZone(value) {
  const candidate = cleanText(value);
  if (candidate === "Lima" || candidate === "Peru") return "America/Lima";
  if (candidate === "Barcelona" || candidate === "Madrid" || candidate === "Spain") {
    return "Europe/Madrid";
  }
  if (!candidate) return undefined;
  try {
    new Intl.DateTimeFormat("es", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return undefined;
  }
}

function formatDate(value, timeZone) {
  const raw = cleanText(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: safeTimeZone(timeZone),
  })
    .format(date)
    .replace(/\u00a0/g, " ");
}

function twoColumns(left, right, width = 32) {
  const cleanLeft = cleanLineValue(left);
  const cleanRight = cleanLineValue(right);
  const space = Math.max(1, width - cleanLeft.length - cleanRight.length);
  return `${cleanLeft}${" ".repeat(space)}${cleanRight}`;
}

function payloadTimeZone(payload) {
  return firstText(payload.branch?.timezone, payload.timezone);
}

function isPreTicket(payload) {
  return payload.document_kind === "pre_ticket" || Boolean(payload.pre_ticket);
}

function isSmartRushTicket(payload) {
  return Boolean(payload.receipt_number || payload.payment || payload.business || payload.order);
}

function isPrepTicket(payload, options = {}) {
  return (
    payload.type === "prep_ticket" ||
    ["bar_ticket", "kitchen_ticket", "food_ticket", "kds_ticket"].includes(options.jobType) ||
    ["BAR", "COCINA", "KITCHEN"].includes(String(payload.title || "").toUpperCase())
  );
}

function cleanList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];

  for (const value of values) {
    let label = "";
    if (typeof value === "string") label = value;
    else if (value && typeof value === "object") label = value.name || value.label || value.title || "";

    label = cleanText(label);
    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(label);
  }

  return result;
}

function mergeLists(...lists) {
  return cleanList(
    lists
      .filter(Array.isArray)
      .flat()
      .map((value) => {
        if (typeof value === "string") return value;
        if (value && typeof value === "object") return value.name || value.label || value.title || "";
        return "";
      }),
  );
}

function prepLineDetails(item) {
  const details = [];
  const variantLabel = firstText(item.variant_label, item.selected_variant?.name);

  if (variantLabel) details.push(`Variante: ${variantLabel}`);

  const extras = mergeLists(item.extras_labels, item.selected_extras);
  if (extras.length > 0) details.push(`Extras: ${extras.join(", ")}`);

  const combos = mergeLists(item.combo_labels, item.combo_selections);
  if (combos.length > 0) details.push(`Combo: ${combos.join(", ")}`);

  const note = firstText(item.note_label, item.notes);
  if (note) details.push(`Nota: ${note}`);

  if (item.sent_at) details.push(`Enviado: ${formatDate(item.sent_at, item.timezone)}`);

  return details;
}

function renderPrepTicket(payload) {
  const parts = [command(ESC, 0x40)];
  const title = firstText(payload.title, payload.printer?.role?.toUpperCase()) || "COMANDA";
  const order = payload.order || {};
  const timeZone = payloadTimeZone(payload);

  parts.push(center("*****"));
  parts.push(centerRaw(doubleSize(title)));
  parts.push(center("*****"));
  parts.push(divider());

  const tableLabel = firstText(order.table_label);
  if (tableLabel) parts.push(bold(`MESA: ${tableLabel}`));
  if (firstText(order.guests_count)) parts.push(line(twoColumns("Personas", order.guests_count)));
  if (firstText(order.sale_by)) parts.push(line(twoColumns("Canal", order.sale_by)));
  if (firstText(order.actor_name)) parts.push(line(twoColumns("Enviado por", order.actor_name)));
  if (firstText(payload.issued_at)) parts.push(line(twoColumns("Hora", formatDate(payload.issued_at, timeZone))));

  parts.push(divider());

  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  for (const item of lines) {
    const quantity = firstText(item.quantity) || 1;
    const name = firstText(item.name, item.text);
    parts.push(bold(`${quantity} x ${name}`));
    for (const detail of prepLineDetails(item)) {
      parts.push(line(`  - ${detail}`));
    }
    parts.push(line());
  }

  parts.push(divider());
  const printerName = firstText(payload.printer?.name);
  if (printerName) parts.push(center(printerName));
  parts.push(feed(config.feedLinesBeforeCut));

  if (config.cutAfterPrint) {
    parts.push(command(GS, 0x56, 0x00));
  }

  return Buffer.concat(parts);
}

function modifierLine(modifier, currency) {
  if (!modifier || typeof modifier !== "object") return "";
  const label = firstText(modifier.label, modifier.type);
  const value = firstText(modifier.value, modifier.name, modifier.title);
  const amount =
    modifier.amount !== null && modifier.amount !== undefined && Number(modifier.amount) !== 0
      ? ` (${money(modifier.amount, currency)})`
      : "";
  if (!value && !amount) return "";
  return [label || "Opcion", value].filter(Boolean).join(": ") + amount;
}

function hasPositiveAmount(value) {
  return Number(value || 0) > 0;
}

function renderPreTicket(payload, options = {}) {
  const parts = [command(ESC, 0x40)];
  const logo = logoBlock(options);
  const businessName = firstText(payload.business?.display_name, payload.tenant?.name, payload.title) || "SmartRush";
  const preTicket = payload.pre_ticket || {};
  const summary = preTicket.summary || {};
  const sections = Array.isArray(preTicket.sections) ? preTicket.sections : [];
  const discounts = Array.isArray(preTicket.discounts)
    ? preTicket.discounts
    : Array.isArray(preTicket.applied_promotions)
      ? preTicket.applied_promotions
      : [];
  const currency = payload.payment?.currency;
  const timeZone = payloadTimeZone(payload);
  const hasPayments = Boolean(summary.has_payments) || hasPositiveAmount(summary.total_paid);
  const hasDiscounts = discounts.length > 0 || hasPositiveAmount(summary.total_discounts);

  if (logo) parts.push(logo);
  parts.push(center(businessName));
  const tableLabel = firstText(payload.order?.table_label);
  if (tableLabel) parts.push(center(`Mesa ${tableLabel}`));
  parts.push(center("PRE-TICKET"));
  const receiptNumber = firstText(payload.receipt_number);
  if (receiptNumber) parts.push(center(receiptNumber));
  parts.push(contentDivider());

  if (firstText(payload.issued_at)) parts.push(contentLine(twoColumns("Fecha", formatDate(payload.issued_at, timeZone))));
  const orderCode = firstText(
    payload.order?.code,
    payload.order_id !== undefined && payload.order_id !== null ? String(payload.order_id).slice(0, 8) : "",
  );
  if (orderCode) parts.push(contentLine(twoColumns("Orden", orderCode)));
  if (firstText(payload.order?.sale_by_label)) parts.push(contentLine(twoColumns("Canal", payload.order.sale_by_label)));
  if (firstText(payload.order?.guests_count)) parts.push(contentLine(twoColumns("Personas", payload.order.guests_count)));
  if (firstText(payload.cashier)) parts.push(contentLine(twoColumns("Atendido por", payload.cashier)));

  for (const section of sections) {
    const items = Array.isArray(section.items) ? section.items : [];
    const label = firstText(section.label, section.key) || "Detalle";
    parts.push(contentDivider());
    parts.push(contentBold(twoColumns(label.toUpperCase(), money(section.total ?? 0, currency))));

    if (items.length === 0) {
      parts.push(contentLine("  Sin items"));
      continue;
    }

    for (const item of items) {
      const quantity = firstText(item.quantity) || 1;
      const name = firstText(item.name, item.text);
      parts.push(contentLine(twoColumns(`${quantity} x ${name}`, money(item.line_total, currency))));
      parts.push(contentLine(twoColumns("  Unitario", money(item.unit_price, currency))));
      if (firstText(item.status_label)) parts.push(contentLine(twoColumns("  Estado", item.status_label)));
      parts.push(contentLine(twoColumns("  Pagado", money(item.paid_amount || 0, currency))));
      if (hasPositiveAmount(item.discount_amount)) {
        parts.push(contentLine(twoColumns("  Descuento", `-${money(item.discount_amount, currency)}`)));
      }
      parts.push(contentLine(twoColumns("  Pendiente", money(item.outstanding_amount || 0, currency))));

      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      for (const modifier of modifiers) {
        const detail = modifierLine(modifier, currency);
        if (detail) parts.push(contentLine(`  - ${detail}`));
      }

      const note = firstText(item.notes);
      if (note) parts.push(contentLine(`  Nota: ${note}`));
      parts.push(contentLine());
    }
  }

  if (hasDiscounts) {
    parts.push(contentDivider());
    parts.push(contentBold("DESCUENTOS / PROMOS"));
    if (discounts.length === 0) {
      parts.push(contentLine(twoColumns("Descuentos aplicados", `-${money(summary.total_discounts || 0, currency)}`)));
    } else {
      for (const discount of discounts) {
        const name = firstText(discount.name, discount.description) || "Descuento";
        const amount = discount.amount ?? discount.discount;
        parts.push(contentLine(twoColumns(name, `-${money(amount, currency)}`)));
        const description = firstText(discount.description);
        if (description && description !== name) {
          parts.push(contentLine(`  ${description}`));
        }
      }
    }
  }

  parts.push(contentDivider());
  if (!hasPayments && !hasDiscounts) {
    parts.push(contentBold(twoColumns("Total cuenta", money(summary.total_account, currency))));
  } else {
    parts.push(contentLine(twoColumns("Total cuenta", money(summary.total_account, currency))));
    if (hasDiscounts) {
      parts.push(contentLine(twoColumns("Total descuentos", `-${money(summary.total_discounts || 0, currency)}`)));
    }
    if (hasPayments) {
      parts.push(contentLine(twoColumns("Total pagado", money(summary.total_paid || 0, currency))));
    }
    parts.push(contentBold(twoColumns("Total por pagar", money(summary.total_due, currency))));
  }

  parts.push(contentDivider());
  parts.push(center(firstText(payload.footer) || "Documento no fiscal"));
  parts.push(center("Sistema automatizado por Smart Rush"));
  parts.push(center("www.smartrush.io"));
  parts.push(feed(config.feedLinesBeforeCut));

  if (config.cutAfterPrint) {
    parts.push(command(GS, 0x56, 0x00));
  }

  return Buffer.concat(parts);
}

function renderSmartRushTicket(payload, options = {}) {
  const parts = [command(ESC, 0x40)];
  const logo = logoBlock(options);
  const businessName = firstText(payload.business?.display_name, payload.tenant?.name, payload.title) || "SmartRush";
  const branchName = firstText(payload.branch?.name);
  const address = [payload.branch?.address, payload.branch?.city, payload.branch?.country]
    .map(cleanText)
    .filter(Boolean)
    .join(" - ");
  const currency = payload.payment?.currency;
  const receiptLabel = payload.receipt_type === "invoice" ? "Factura" : "Ticket";
  const timeZone = payloadTimeZone(payload);

  if (logo) parts.push(logo);
  parts.push(center(businessName));
  if (branchName && branchName !== businessName) parts.push(center(branchName));
  const billingTaxName = firstText(payload.business?.billing_tax_name);
  if (billingTaxName && billingTaxName !== businessName) {
    parts.push(center(`Razon social: ${billingTaxName}`));
  }
  if (address) parts.push(center(address));
  const billingTaxId = firstText(payload.business?.billing_tax_id);
  if (billingTaxId) parts.push(center(`NIF/VAT: ${billingTaxId}`));
  const billingAddress = firstText(payload.business?.billing_address);
  if (billingAddress) parts.push(center(billingAddress));
  const billingEmail = firstText(payload.business?.billing_email);
  if (billingEmail) parts.push(center(billingEmail));
  const receiptNumber = firstText(payload.receipt_number);
  if (receiptNumber) parts.push(center(`${receiptLabel} ${receiptNumber}`));
  parts.push(contentDivider());

  if (firstText(payload.issued_at)) parts.push(contentLine(twoColumns("Fecha", formatDate(payload.issued_at, timeZone))));
  const orderCode = firstText(
    payload.order?.code,
    payload.order_id !== undefined && payload.order_id !== null ? String(payload.order_id).slice(0, 8) : "",
  );
  if (orderCode) parts.push(contentLine(twoColumns("Orden", orderCode)));
  if (firstText(payload.order?.sale_by_label)) parts.push(contentLine(twoColumns("Canal", payload.order.sale_by_label)));
  const tableLabel = firstText(payload.order?.table_label);
  if (tableLabel) parts.push(contentLine(`Mesa: ${tableLabel}`));
  if (firstText(payload.cashier)) parts.push(contentLine(twoColumns("Atendido por", payload.cashier)));

  if (firstText(payload.billing?.name)) {
    parts.push(contentDivider());
    parts.push(contentLine(twoColumns("Cliente", payload.billing.name)));
    if (firstText(payload.billing.vat)) parts.push(contentLine(twoColumns("VAT/NIF", payload.billing.vat)));
    if (firstText(payload.billing.address)) parts.push(contentLine(twoColumns("Direccion", payload.billing.address)));
    if (firstText(payload.billing.email)) parts.push(contentLine(twoColumns("Email", payload.billing.email)));
  }

  parts.push(contentDivider());

  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  for (const item of lines) {
    const quantity = firstText(item.quantity) || 1;
    const name = firstText(item.name, item.text);
    const total = money(item.paid_amount ?? item.line_total ?? item.total ?? item.price, currency);
    const unitPrice = money(item.unit_price ?? item.price, currency);
    const note = firstText(item.notes);
    parts.push(contentLine(twoColumns(name, total)));
    parts.push(contentLine(`  ${quantity} x ${unitPrice}${note ? ` - ${note}` : ""}`));
  }

  parts.push(contentDivider());
  if (payload.payment?.subtotal !== undefined) {
    parts.push(contentLine(twoColumns("Subtotal", money(payload.payment.subtotal, currency))));
  }
  if (payload.payment?.discount) {
    parts.push(contentLine(twoColumns("Descuento", `-${money(payload.payment.discount, currency)}`)));
  }
  if (payload.payment?.tip) {
    parts.push(contentLine(twoColumns("Propina", money(payload.payment.tip, currency))));
  }
  if (payload.payment?.total !== undefined) {
    parts.push(contentBold(twoColumns("Total", money(payload.payment.total, currency))));
  }
  const paymentMethod = firstText(payload.payment?.method_label, payload.payment?.method);
  if (paymentMethod) {
    parts.push(contentLine(twoColumns("Metodo", paymentMethod)));
  }
  if (payload.payment?.cash_received !== undefined) {
    parts.push(contentLine(twoColumns("Recibido", money(payload.payment.cash_received, currency))));
  }
  if (payload.payment?.change_due !== undefined) {
    parts.push(contentLine(twoColumns("Cambio", money(payload.payment.change_due, currency))));
  }
  if (firstText(payload.payment?.reference)) {
    parts.push(contentLine(twoColumns("Referencia", payload.payment.reference)));
  }

  parts.push(contentDivider());
  parts.push(center(firstText(payload.footer) || "Gracias por su compra."));
  parts.push(center("Sistema automatizado por Smart Rush"));
  parts.push(center("www.smartrush.io"));
  const paymentId = firstText(payload.payment_id);
  if (paymentId) parts.push(contentLine(`Pago: ${paymentId}`));
  parts.push(feed(config.feedLinesBeforeCut));

  if (config.cutAfterPrint) {
    parts.push(command(GS, 0x56, 0x00));
  }

  return Buffer.concat(parts);
}

function renderStructuredTicket(payload) {
  const parts = [command(ESC, 0x40)];

  if (payload.title) {
    parts.push(center(payload.title));
    parts.push(line("--------------------------------"));
  }

  if (payload.orderNumber) parts.push(bold(`Pedido: ${payload.orderNumber}`));
  if (payload.table) parts.push(line(`Mesa: ${payload.table}`));
  if (payload.customer) parts.push(line(`Cliente: ${payload.customer}`));
  if (payload.createdAt) parts.push(line(`Fecha: ${payload.createdAt}`));

  if (payload.orderNumber || payload.table || payload.customer || payload.createdAt) {
    parts.push(line("--------------------------------"));
  }

  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  for (const item of lines) {
    if (typeof item === "string") {
      parts.push(line(item));
      continue;
    }

    if (item && typeof item === "object") {
      const quantity = item.quantity || item.qty || "";
      const name = item.name || item.text || "";
      const note = item.note || item.notes || "";
      const price = item.price ? ` ${item.price}` : "";
      const prefix = quantity ? `${quantity} x ` : "";
      parts.push(line(`${prefix}${name}${price}`));
      if (note) parts.push(line(`  ${note}`));
    }
  }

  if (payload.text) {
    parts.push(line(payload.text));
  }

  if (payload.footer) {
    parts.push(line("--------------------------------"));
    parts.push(center(payload.footer));
  }

  parts.push(feed(config.feedLinesBeforeCut));

  if (config.cutAfterPrint) {
    parts.push(command(GS, 0x56, 0x00));
  }

  return Buffer.concat(parts);
}

function renderTicket(payload, options = {}) {
  if (!payload) {
    throw new Error("Print job payload is empty");
  }

  if (typeof payload === "string") {
    return renderStructuredTicket({ text: payload });
  }

  if (payload.rawBase64) {
    return Buffer.from(payload.rawBase64, "base64");
  }

  if (payload.rawHex) {
    return Buffer.from(payload.rawHex.replace(/\s+/g, ""), "hex");
  }

  if (isPreTicket(payload)) {
    return renderPreTicket(payload, options);
  }

  if (isPrepTicket(payload, options)) {
    return renderPrepTicket(payload);
  }

  if (isSmartRushTicket(payload)) {
    return renderSmartRushTicket(payload, options);
  }

  return renderStructuredTicket(payload);
}

module.exports = {
  renderTicket,
};
