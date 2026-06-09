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

test("renders a detailed SmartRush pre-ticket payload", () => {
  const buffer = renderTicket({
    document_kind: "pre_ticket",
    receipt_number: "PRE-ORDER1",
    issued_at: "2026-06-09T11:06:00.073Z",
    business: { display_name: "Restaurante Sheiki" },
    branch: { timezone: "Europe/Madrid" },
    order: {
      table_label: "T2",
      guests_count: 4,
      sale_by_label: "Sala",
    },
    cashier: "caja@example.com",
    payment: { currency: "EUR" },
    pre_ticket: {
      summary: {
        total_account: 30,
        total_paid: 8,
        total_discounts: 3.5,
        total_due: 18.5,
        has_payments: true,
      },
      sections: [
        {
          key: "new",
          label: "Nuevo",
          total: 18.5,
          items: [
            {
              name: "Capuccino",
              quantity: 1,
              unit_price: 5,
              line_total: 5,
              paid_amount: 0,
              discount_amount: 0,
              outstanding_amount: 5,
              status_label: "Nuevo",
              notes: "sin canela",
              modifiers: [
                { label: "Variante", value: "Venti", amount: null },
                { label: "Extra", value: "Azucar", amount: 0.5 },
              ],
            },
          ],
        },
        { key: "delivered", label: "Entregado", total: 11.5, items: [] },
        { key: "paid", label: "Pagado", total: 0, items: [] },
        { key: "returns", label: "Devoluciones", total: 0, items: [] },
      ],
      discounts: [
        {
          name: "Promo 2x1",
          amount: 3.5,
          description: "2 x 1 en Copa de Cerveza",
        },
      ],
    },
  });

  const text = buffer.toString("latin1");
  assert.equal(text.includes("PRE-TICKET"), true);
  assert.equal(text.includes("Restaurante Sheiki"), true);
  assert.equal(text.includes("NUEVO"), true);
  assert.equal(text.includes("ENTREGADO"), true);
  assert.equal(text.includes("PAGADO"), true);
  assert.equal(text.includes("DEVOLUCIONES"), true);
  assert.equal(text.includes("1 x Capuccino"), true);
  assert.equal(text.includes("Estado"), true);
  assert.equal(text.includes("Pendiente"), true);
  assert.equal(text.includes("Variante: Venti"), true);
  assert.equal(text.includes("Extra: Azucar"), true);
  assert.equal(text.includes("Nota: sin canela"), true);
  assert.equal(text.includes("DESCUENTOS / PROMOS"), true);
  assert.equal(text.includes("Promo 2x1"), true);
  assert.equal(text.includes("Total cuenta"), true);
  assert.equal(text.includes("Total pagado"), true);
  assert.equal(text.includes("Total por pagar"), true);
});

test("renders only account total for a pre-ticket without payments or discounts", () => {
  const buffer = renderTicket({
    document_kind: "pre_ticket",
    payment: { currency: "EUR" },
    pre_ticket: {
      summary: {
        total_account: 12,
        total_paid: 0,
        total_discounts: 0,
        total_due: 12,
        has_payments: false,
      },
      sections: [],
      discounts: [],
    },
  });

  const text = buffer.toString("latin1");
  assert.equal(text.includes("Total cuenta"), true);
  assert.equal(text.includes("Total pagado"), false);
  assert.equal(text.includes("Total por pagar"), false);
  assert.equal(text.includes("DESCUENTOS / PROMOS"), false);
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

test("renders prep ticket selected variants and selected extras", () => {
  const buffer = renderTicket({
    type: "prep_ticket",
    title: "BAR",
    issued_at: "2026-06-08T10:40:34.851Z",
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
        name: "Capuccino",
        notes: "sin azucar moreno",
        quantity: 1,
        note_label: "sin azucar moreno",
        extras_labels: ["Azucar"],
        variant_label: "Venti",
        selected_extras: [
          {
            id: "d79da39e-c303-4148-ba2c-cca930642356",
            name: "Azucar",
            price: 0.5,
          },
        ],
        selected_variant: {
          id: "f0644faf-c163-48f7-96af-86ce33733fcb",
          name: "Venti",
          price_adjustment: 2,
        },
      },
    ],
  });

  const text = buffer.toString("latin1");
  assert.equal(text.includes("1 x Capuccino"), true);
  assert.equal(text.includes("Variante: Venti"), true);
  assert.equal(text.includes("Extras: Azucar"), true);
  assert.equal(text.includes("Nota: sin azucar moreno"), true);
});
