const iconv = require("iconv-lite");
const { config } = require("./config");

const ESC = 0x1b;
const GS = 0x1d;

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
  return line("--------------------------------");
}

function normalizeCurrency(value) {
  const candidate = String(value || "USD").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(candidate)) return candidate;
  if (candidate === "EURO" || candidate === "EUROS") return "EUR";
  if (candidate === "$") return "USD";
  return "USD";
}

function money(value, currency) {
  if (value === null || value === undefined || value === "") return "";
  try {
    return new Intl.NumberFormat("es", {
      style: "currency",
      currency: normalizeCurrency(currency),
    })
      .format(Number(value))
      .replace(/\u00a0/g, " ");
  } catch {
    const number = Number(value);
    const amount = Number.isFinite(number) ? number.toFixed(2) : String(value);
    return currency ? `${amount} ${currency}` : amount;
  }
}

function safeTimeZone(value) {
  const candidate = String(value || "").trim();
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
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: safeTimeZone(timeZone),
  })
    .format(date)
    .replace(/\u00a0/g, " ");
}

function twoColumns(left, right, width = 32) {
  const cleanLeft = String(left || "");
  const cleanRight = String(right || "");
  const space = Math.max(1, width - cleanLeft.length - cleanRight.length);
  return `${cleanLeft}${" ".repeat(space)}${cleanRight}`;
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
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      if (value && typeof value === "object") return value.name || value.label || value.title || "";
      return "";
    })
    .filter(Boolean);
}

function prepLineDetails(item) {
  const details = [];

  if (item.variant_label) details.push(`Variante: ${item.variant_label}`);
  else if (item.selected_variant?.name) details.push(`Variante: ${item.selected_variant.name}`);

  const extras = cleanList(item.extras_labels).concat(cleanList(item.selected_extras));
  if (extras.length > 0) details.push(`Extras: ${extras.join(", ")}`);

  const combos = cleanList(item.combo_labels).concat(cleanList(item.combo_selections));
  if (combos.length > 0) details.push(`Combo: ${combos.join(", ")}`);

  const note = item.note_label || item.notes;
  if (note) details.push(`Nota: ${note}`);

  if (item.sent_at) details.push(`Enviado: ${formatDate(item.sent_at, item.timezone)}`);

  return details;
}

function renderPrepTicket(payload) {
  const parts = [command(ESC, 0x40)];
  const title = payload.title || payload.printer?.role?.toUpperCase() || "COMANDA";
  const order = payload.order || {};

  parts.push(center("*****"));
  parts.push(centerRaw(doubleSize(title)));
  parts.push(center("*****"));
  parts.push(divider());

  if (order.table_label) parts.push(bold(`MESA: ${order.table_label}`));
  if (order.guests_count) parts.push(line(twoColumns("Personas", order.guests_count)));
  if (order.sale_by) parts.push(line(twoColumns("Canal", order.sale_by)));
  if (order.actor_name) parts.push(line(twoColumns("Enviado por", order.actor_name)));
  if (payload.issued_at) parts.push(line(twoColumns("Hora", formatDate(payload.issued_at, payload.branch?.timezone))));

  parts.push(divider());

  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  for (const item of lines) {
    const quantity = item.quantity || 1;
    const name = item.name || item.text || "";
    parts.push(bold(`${quantity} x ${name}`));
    for (const detail of prepLineDetails(item)) {
      parts.push(line(`  - ${detail}`));
    }
    parts.push(line());
  }

  parts.push(divider());
  if (payload.printer?.name) parts.push(center(payload.printer.name));
  parts.push(feed(config.feedLinesBeforeCut));

  if (config.cutAfterPrint) {
    parts.push(command(GS, 0x56, 0x00));
  }

  return Buffer.concat(parts);
}

function renderSmartRushTicket(payload) {
  const parts = [command(ESC, 0x40)];
  const businessName = payload.business?.display_name || payload.tenant?.name || payload.title || "SmartRush";
  const branchName = payload.branch?.name;
  const address = [payload.branch?.address, payload.branch?.city, payload.branch?.country]
    .filter(Boolean)
    .join(" - ");
  const currency = payload.payment?.currency;
  const receiptLabel = payload.receipt_type === "invoice" ? "Factura" : "Ticket";

  parts.push(center(businessName));
  if (branchName && branchName !== businessName) parts.push(center(branchName));
  if (payload.business?.billing_tax_name && payload.business.billing_tax_name !== businessName) {
    parts.push(center(`Razon social: ${payload.business.billing_tax_name}`));
  }
  if (address) parts.push(center(address));
  if (payload.business?.billing_tax_id) parts.push(center(`NIF/VAT: ${payload.business.billing_tax_id}`));
  if (payload.business?.billing_address) parts.push(center(payload.business.billing_address));
  if (payload.business?.billing_email) parts.push(center(payload.business.billing_email));
  if (payload.receipt_number) parts.push(center(`${receiptLabel} ${payload.receipt_number}`));
  parts.push(divider());

  if (payload.issued_at) parts.push(line(twoColumns("Fecha", formatDate(payload.issued_at, payload.branch?.timezone))));
  if (payload.order?.code || payload.order_id) {
    parts.push(line(twoColumns("Orden", payload.order?.code || String(payload.order_id).slice(0, 8))));
  }
  if (payload.order?.sale_by_label) parts.push(line(twoColumns("Canal", payload.order.sale_by_label)));
  if (payload.order?.table_label) parts.push(line(`Mesa: ${payload.order.table_label}`));
  if (payload.cashier) parts.push(line(twoColumns("Atendido por", payload.cashier)));

  if (payload.billing?.name) {
    parts.push(divider());
    parts.push(line(twoColumns("Cliente", payload.billing.name)));
    if (payload.billing.vat) parts.push(line(twoColumns("VAT/NIF", payload.billing.vat)));
    if (payload.billing.address) parts.push(line(twoColumns("Direccion", payload.billing.address)));
    if (payload.billing.email) parts.push(line(twoColumns("Email", payload.billing.email)));
  }

  parts.push(divider());

  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  for (const item of lines) {
    const quantity = item.quantity || 1;
    const name = item.name || item.text || "";
    const total = money(item.paid_amount ?? item.line_total ?? item.total ?? item.price, currency);
    const unitPrice = money(item.unit_price ?? item.price, currency);
    parts.push(line(twoColumns(name, total)));
    parts.push(line(`  ${quantity} x ${unitPrice}${item.notes ? ` - ${item.notes}` : ""}`));
  }

  parts.push(divider());
  if (payload.payment?.subtotal !== undefined) {
    parts.push(line(twoColumns("Subtotal", money(payload.payment.subtotal, currency))));
  }
  if (payload.payment?.discount) {
    parts.push(line(twoColumns("Descuento", `-${money(payload.payment.discount, currency)}`)));
  }
  if (payload.payment?.tip) {
    parts.push(line(twoColumns("Propina", money(payload.payment.tip, currency))));
  }
  if (payload.payment?.total !== undefined) {
    parts.push(bold(twoColumns("Total", money(payload.payment.total, currency))));
  }
  if (payload.payment?.method_label || payload.payment?.method) {
    parts.push(line(twoColumns("Metodo", payload.payment.method_label || payload.payment.method)));
  }
  if (payload.payment?.cash_received !== undefined) {
    parts.push(line(twoColumns("Recibido", money(payload.payment.cash_received, currency))));
  }
  if (payload.payment?.change_due !== undefined) {
    parts.push(line(twoColumns("Cambio", money(payload.payment.change_due, currency))));
  }
  if (payload.payment?.reference) {
    parts.push(line(twoColumns("Referencia", payload.payment.reference)));
  }

  parts.push(divider());
  parts.push(center(payload.footer || "Gracias por su compra."));
  parts.push(center("Sistema automatizado por Smart Rush"));
  parts.push(center("www.smartrush.io"));
  if (payload.payment_id) parts.push(line(`Pago: ${payload.payment_id}`));
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

  if (isPrepTicket(payload, options)) {
    return renderPrepTicket(payload);
  }

  if (isSmartRushTicket(payload)) {
    return renderSmartRushTicket(payload);
  }

  return renderStructuredTicket(payload);
}

module.exports = {
  renderTicket,
};
