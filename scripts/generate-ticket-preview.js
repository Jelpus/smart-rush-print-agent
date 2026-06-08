const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { config } = require("../src/config");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value, currency) {
  if (value === null || value === undefined || value === "") return "";
  try {
    return new Intl.NumberFormat("es", {
      style: "currency",
      currency: normalizeCurrency(currency),
    }).format(Number(value));
  } catch {
    const number = Number(value);
    const amount = Number.isFinite(number) ? number.toFixed(2) : String(value);
    return currency ? `${amount} ${currency}` : amount;
  }
}

function normalizeCurrency(value) {
  const candidate = String(value || "USD").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(candidate)) return candidate;
  if (candidate === "EURO" || candidate === "EUROS") return "EUR";
  if (candidate === "$") return "USD";
  return "USD";
}

function safeTimeZone(value) {
  const candidate = String(value || "").trim();
  if (candidate === "Lima" || candidate === "Peru") return "America/Lima";
  if (candidate === "Barcelona" || candidate === "Madrid" || candidate === "Spain") {
    return "Europe/Madrid";
  }
  if (!candidate) return "UTC";
  try {
    new Intl.DateTimeFormat("es", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function formatDate(value, timeZone) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: safeTimeZone(timeZone),
  }).format(new Date(value));
}

function row(label, value, strong = false) {
  if (value === null || value === undefined || value === "") return "";
  return `<div class="row ${strong ? "strong" : ""}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

function renderTicket(payload) {
  const currency = payload.payment?.currency || "";
  const businessName = payload.business?.display_name || payload.tenant?.name || "SmartRush";
  const receiptLabel = payload.receipt_type === "invoice" ? "Factura" : "Ticket";
  const address = [payload.branch?.address, payload.branch?.city, payload.branch?.country]
    .filter(Boolean)
    .join(" - ");
  const lines = Array.isArray(payload.lines) ? payload.lines : [];

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ticket ${escapeHtml(payload.receipt_number || "")}</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #fff;
      --ink: #171717;
      --muted: #5f5f5f;
      --rule: #2f2f2f;
      --bg: #e9edf2;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: start center;
      background: var(--bg);
      color: var(--ink);
      font-family: Arial, Helvetica, sans-serif;
      padding: 24px;
    }

    .ticket {
      width: 74mm;
      max-width: calc(100vw - 32px);
      background: var(--paper);
      padding: 5mm 4mm;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      font-size: 11px;
      line-height: 1.35;
    }

    .center {
      text-align: center;
    }

    .business {
      font-size: 17px;
      font-weight: 800;
      line-height: 1.15;
      margin-bottom: 3px;
    }

    .logo {
      display: block;
      max-width: 36mm;
      max-height: 18mm;
      object-fit: contain;
      margin: 0 auto 8px;
    }

    .branch,
    .muted {
      color: var(--muted);
    }

    .rule {
      border: 0;
      border-top: 1px dashed var(--rule);
      margin: 9px 0;
    }

    .meta {
      display: grid;
      gap: 2px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: baseline;
    }

    .strong {
      font-weight: 800;
      font-size: 12px;
    }

    .item {
      margin: 0 0 7px;
    }

    .item-main {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-weight: 700;
    }

    .item-main span:first-child {
      min-width: 0;
      flex: 1 1 auto;
      overflow-wrap: anywhere;
    }

    .item-main span:last-child {
      max-width: 34%;
      min-width: 0;
      flex: 0 1 auto;
      text-align: right;
      overflow-wrap: anywhere;
    }

    .note {
      color: var(--muted);
      margin-top: 2px;
      font-size: 10px;
    }

    .thanks {
      margin-top: 10px;
      font-weight: 800;
      text-align: center;
    }

    @media print {
      body {
        background: white;
        padding: 0;
      }

      .ticket {
        width: 74mm;
        margin: 0 auto;
        box-shadow: none;
      }

      @page {
        size: 80mm auto;
        margin: 0;
      }
    }
  </style>
</head>
<body>
  <main class="ticket">
    <section class="center">
      ${payload.business?.logo_url ? `<img class="logo" alt="${escapeHtml(businessName)}" src="${escapeHtml(payload.business.logo_url)}">` : ""}
      <div class="business">${escapeHtml(businessName)}</div>
      ${payload.branch?.name && payload.branch.name !== businessName ? `<div class="branch">${escapeHtml(payload.branch.name)}</div>` : ""}
      ${
        payload.business?.billing_tax_name && payload.business.billing_tax_name !== businessName
          ? `<div class="muted">Razon social: ${escapeHtml(payload.business.billing_tax_name)}</div>`
          : ""
      }
      ${address ? `<div class="muted">${escapeHtml(address)}</div>` : ""}
      ${payload.business?.billing_tax_id ? `<div class="muted">NIF/VAT: ${escapeHtml(payload.business.billing_tax_id)}</div>` : ""}
      ${payload.business?.billing_address ? `<div class="muted">${escapeHtml(payload.business.billing_address)}</div>` : ""}
      ${payload.business?.billing_email ? `<div class="muted">${escapeHtml(payload.business.billing_email)}</div>` : ""}
      ${payload.receipt_number ? `<div class="muted">${escapeHtml(receiptLabel)} ${escapeHtml(payload.receipt_number)}</div>` : ""}
    </section>

    <hr class="rule">

    <section class="meta">
      ${row("Fecha", formatDate(payload.issued_at, payload.branch?.timezone))}
      ${row("Orden", payload.order?.code || String(payload.order_id || "").slice(0, 8))}
      ${row("Canal", payload.order?.sale_by_label)}
      ${row("Mesa", payload.order?.table_label)}
      ${row("Atendido por", payload.cashier)}
    </section>

    ${
      payload.billing?.name
        ? `<hr class="rule">
    <section class="meta">
      ${row("Cliente", payload.billing.name)}
      ${row("VAT/NIF", payload.billing.vat)}
      ${row("Direccion", payload.billing.address)}
      ${row("Email", payload.billing.email)}
    </section>`
        : ""
    }

    <hr class="rule">

    <section>
      ${lines
        .map((item) => {
          const quantity = item.quantity || 1;
          const total = money(item.paid_amount ?? item.line_total ?? item.total ?? item.price, currency);
          const unitPrice = money(item.unit_price ?? item.price, currency);
          return `<article class="item">
            <div class="item-main">
              <span>${escapeHtml(item.name || item.text || "")}</span>
              <span>${escapeHtml(total)}</span>
            </div>
            <div class="note">${escapeHtml(`${quantity} x ${unitPrice}${item.notes ? ` - ${item.notes}` : ""}`)}</div>
          </article>`;
        })
        .join("")}
    </section>

    <hr class="rule">

    <section class="meta">
      ${row("Subtotal", money(payload.payment?.subtotal, currency))}
      ${payload.payment?.discount ? row("Descuento", `-${money(payload.payment.discount, currency)}`) : ""}
      ${payload.payment?.tip ? row("Propina", money(payload.payment.tip, currency)) : ""}
      ${row("Total", money(payload.payment?.total, currency), true)}
      ${row("Metodo", payload.payment?.method_label || payload.payment?.method)}
      ${row("Recibido", money(payload.payment?.cash_received, currency))}
      ${row("Cambio", money(payload.payment?.change_due, currency))}
      ${row("Referencia", payload.payment?.reference)}
    </section>

    <hr class="rule">

    <footer class="center muted">
      <p>Gracias por su compra.</p>
      <p>Sistema automatizado por Smart Rush</p>
      <p>www.smartrush.io</p>
      ${payload.payment_id ? `<p>Pago: ${escapeHtml(payload.payment_id)}</p>` : ""}
    </footer>
  </main>
</body>
</html>`;
}

async function main() {
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!adminKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required only for local preview generation");
  }

  const supabase = createClient(config.supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from(config.tableName)
    .select("payload")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No print_jobs found to preview");

  const outputPath = path.resolve("preview-ticket.html");
  fs.writeFileSync(outputPath, renderTicket(data.payload), "utf8");
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
