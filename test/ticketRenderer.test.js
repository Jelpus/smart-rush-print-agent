const assert = require("node:assert/strict");
const test = require("node:test");

const { renderTicket } = require("../src/ticketRenderer");

test("renders a structured ticket as ESC/POS bytes", () => {
  const buffer = renderTicket({
    title: "SmartRush",
    orderNumber: "A-102",
    lines: ["2 x Cafe", { quantity: 1, name: "Bocadillo", note: "Sin tomate" }],
    footer: "Gracias",
  });

  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(buffer[0], 0x1b);
  assert.equal(buffer[1], 0x40);
  assert.equal(buffer.includes(Buffer.from("SmartRush")), true);
});

test("passes raw base64 payload through", () => {
  const expected = Buffer.from([0x1b, 0x40, 0x0a]);
  const buffer = renderTicket({ rawBase64: expected.toString("base64") });

  assert.deepEqual(buffer, expected);
});

test("passes raw hex payload through", () => {
  const buffer = renderTicket({ rawHex: "1b 40 0a" });

  assert.deepEqual(buffer, Buffer.from([0x1b, 0x40, 0x0a]));
});

test("renders a SmartRush sales ticket payload", () => {
  const buffer = renderTicket({
    receipt_number: "T-DUMMY-MQ2HL6Q2",
    business: { display_name: "Memena" },
    branch: { name: "Santiago de Surco" },
    order: { code: "DUMMY-LOCAL-AGENT", table_label: "TEST" },
    cashier: "SmartRush Dummy",
    payment: {
      subtotal: 12,
      total: 12,
      currency: "PEN",
      method_label: "Efectivo",
      cash_received: 12,
      change_due: 0,
    },
    lines: [
      {
        quantity: 1,
        name: "Ticket dummy agente local",
        notes: "Prueba de cola print_jobs",
        line_total: 10,
      },
      {
        quantity: 1,
        name: "Servicio prueba",
        line_total: 2,
      },
    ],
  });

  const text = buffer.toString("latin1");
  assert.equal(text.includes("Memena"), true);
  assert.equal(text.includes("T-DUMMY-MQ2HL6Q2"), true);
  assert.equal(text.includes("Ticket dummy agente local"), true);
  assert.equal(text.includes("Total"), true);
});

test("renders a prep ticket with variants and notes", () => {
  const buffer = renderTicket({
    type: "prep_ticket",
    title: "BAR",
    issued_at: "2026-06-08T10:30:06.178Z",
    order: {
      sale_by: "on-site",
      actor_name: "guillermo@jelpus.com",
      table_label: "T1",
      guests_count: 4,
    },
    printer: {
      name: "Impresora BAR",
      role: "bar",
    },
    lines: [
      {
        name: "Cafe con leche",
        notes: "sin canela",
        quantity: 1,
        variant_label: "Leche de Avena",
        extras_labels: ["Extra caliente"],
        combo_labels: ["Desayuno"],
      },
    ],
  });

  const text = buffer.toString("latin1");
  assert.equal(text.includes("BAR"), true);
  assert.equal(text.includes("MESA: T1"), true);
  assert.equal(text.includes("1 x Cafe con leche"), true);
  assert.equal(text.includes("Variante: Leche de Avena"), true);
  assert.equal(text.includes("Extras: Extra caliente"), true);
  assert.equal(text.includes("Combo: Desayuno"), true);
  assert.equal(text.includes("Nota: sin canela"), true);
});
