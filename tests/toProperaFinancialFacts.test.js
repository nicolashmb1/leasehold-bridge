import test from "node:test";
import assert from "node:assert/strict";
import { pickDisplayLastPayment } from "../src/normalize/toProperaFinancialFacts.js";

test("pickDisplayLastPayment prefers newest payment >= 20% rent (min $500)", () => {
  const recent = [
    { date: "03/23/2026", amount_dollars: 1500 },
    { date: "03/28/2026", amount_dollars: 1000 },
    { date: "04/23/2026", amount_dollars: 500 },
    { date: "06/02/2026", amount_dollars: 1000 },
  ];

  const picked = pickDisplayLastPayment(recent, 2406);
  assert.equal(picked?.date, "06/02/2026");
  assert.equal(picked?.amount_dollars, 1000);
});

test("pickDisplayLastPayment still skips tiny partials on typical rent", () => {
  const recent = [
    { date: "05/01/2026", amount_dollars: 1300 },
    { date: "06/01/2026", amount_dollars: 200 },
  ];

  const picked = pickDisplayLastPayment(recent, 1300);
  assert.equal(picked?.date, "05/01/2026");
  assert.equal(picked?.amount_dollars, 1300);
});
