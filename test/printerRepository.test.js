const assert = require("node:assert/strict");
const test = require("node:test");

const { roleForJobType, targetRoleForJob } = require("../src/printerRepository");

test("maps print job types to printer roles", () => {
  assert.equal(roleForJobType("sales_ticket"), "receipt");
  assert.equal(roleForJobType("invoice"), "receipt");
  assert.equal(roleForJobType("test_ticket"), "receipt");
  assert.equal(roleForJobType("kitchen_ticket"), "kitchen");
  assert.equal(roleForJobType("food_ticket"), "kitchen");
  assert.equal(roleForJobType("kds_ticket"), "kitchen");
  assert.equal(roleForJobType("bar_ticket"), "bar");
});

test("uses metadata role before job type fallback", () => {
  assert.equal(
    targetRoleForJob({
      job_type: "sales_ticket",
      meta: { printer_role: "bar" },
    }),
    "bar",
  );

  assert.equal(
    targetRoleForJob({
      job_type: "sales_ticket",
      meta: { target_role: "kitchen", printer_role: "bar" },
    }),
    "kitchen",
  );
});
