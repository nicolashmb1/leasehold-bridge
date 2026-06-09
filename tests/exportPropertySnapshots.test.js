import test from "node:test";
import assert from "node:assert/strict";
import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";

test("exportPropertySnapshots emits Propera contract for WESTGRAND", () => {
  const mapping = loadPropertyMapping();
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "WESTGRAND",
    syncedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(result.facts.length, 22);
  const unit101 = result.facts.find((f) => f.unit_label === "101");
  assert.ok(unit101);
  assert.equal(unit101.source_system, "leasehold");
  assert.equal(unit101.propera_property_code, "WESTGRAND");
  assert.equal(unit101.leasehold_ra_group, "RA0001");
  assert.equal(unit101.rent_cents, 141300);
  assert.equal(unit101.security_deposit_cents, 211250);
  assert.equal(unit101.other_deposit_cents, 24000);
  assert.equal(unit101.payload?.deposits?.other_deposit_literal_cents, 15000);
  assert.equal(unit101.payload?.deposits?.ancillary_deposit_cents, 9000);
  assert.equal(unit101.last_payment_cents, 143822);
  assert.equal(unit101.balance_status, "paid_up");

  const unit202 = result.facts.find((f) => f.unit_label === "202");
  assert.ok(unit202);
  assert.equal(unit202.security_deposit_cents, 287700);
  assert.equal(unit202.key_deposit_cents, 15000);
  assert.equal(unit202.other_deposit_cents, null);
  assert.equal(unit202.payload?.deposits?.leasehold_deposit_total_cents, 302700);

  const unit205 = result.facts.find((f) => f.unit_label === "205");
  assert.ok(unit205);
  assert.equal(unit205.security_deposit_cents, 260000);
  assert.equal(unit205.key_deposit_cents, 15000);
  assert.equal(unit205.other_deposit_cents, null);
  assert.equal(unit205.payload?.deposits?.leasehold_other_deposit_total_cents, 15000);

  const unit206 = result.facts.find((f) => f.unit_label === "206");
  assert.ok(unit206);
  assert.equal(unit206.key_deposit_cents, 10000);
  assert.equal(unit206.pet_deposit_cents, 50000);
  assert.equal(unit206.other_deposit_cents, null);
  assert.equal(unit206.payload?.deposits?.leasehold_other_deposit_total_cents, 60000);

  const unit304 = result.facts.find((f) => f.unit_label === "304");
  assert.ok(unit304);
  assert.equal(unit304.balance_cents, 0);
  assert.equal(unit304.balance_status, "paid_up");
  assert.equal(unit304.last_payment_cents, 212235);
  assert.equal(unit304.last_payment_at, "2026-06-02");

  const unit305 = result.facts.find((f) => f.unit_label === "305");
  assert.ok(unit305);
  assert.equal(unit305.last_payment_at, "2026-06-01");
  assert.equal(unit305.last_payment_cents, 211907);

  const unit406 = result.facts.find((f) => f.unit_label === "406");
  assert.ok(unit406);
  assert.equal(unit406.last_payment_at, "2026-05-04");
  assert.equal(unit406.last_payment_cents, 202800);

  const unit201 = result.facts.find((f) => f.unit_label === "201");
  assert.ok(unit201);
  assert.equal(unit201.security_deposit_cents, 486600);
  assert.equal(unit201.key_deposit_cents, 20000);
  assert.equal(unit201.other_deposit_cents, null);
  assert.equal(unit201.last_payment_at, "2026-05-21");
  assert.equal(unit201.last_payment_cents, 130000);

  const unit304Posted = unit304.payload?.posted_transactions;
  assert.ok(Array.isArray(unit304Posted));
  assert.ok(unit304Posted.length > 0);
  assert.ok(unit304Posted.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)));
  const unit304Payments = unit304Posted.filter((row) => row.kind === "payment");
  assert.ok(unit304Payments.length > 0);
});

test("exportPropertySnapshots includes deposit cents for PENN unit 203", () => {
  const mapping = loadPropertyMapping();
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "PENN",
    syncedAt: "2026-06-07T12:00:00.000Z",
  });

  const unit203 = result.facts.find((f) => f.unit_label === "203");
  assert.ok(unit203);
  assert.equal(unit203.security_deposit_cents, 490650);
  assert.equal(unit203.key_deposit_cents, 20000);
  assert.equal(unit203.payload?.deposits?.source, "unit_master+deposit_dat");
});
