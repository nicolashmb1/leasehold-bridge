import test from "node:test";
import assert from "node:assert/strict";
import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";
import { extractAncillaryCharges } from "../src/normalize/extractAncillaryCharges.js";

test("extractAncillaryCharges reads monthly billing extras for unit 101", () => {
  const mapping = loadPropertyMapping();
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "WESTGRAND",
    syncedAt: "2026-06-07T12:00:00.000Z",
  });
  const unit101 = result.facts.find((f) => f.unit_label === "101");
  assert.ok(unit101);
  assert.ok(Array.isArray(unit101.payload.ancillary_charges));
  assert.ok(unit101.payload.monthly_billing_extras_cents > 0);
  const recurring = unit101.payload.ancillary_charges.filter((row) => row.recurring);
  assert.ok(recurring.length > 0);
  assert.ok(recurring.some((row) => row.amount_cents > 0));
});

test("extractAncillaryCharges classifies late fees separately from recurring charges", () => {
  const mapping = loadPropertyMapping();
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "WESTGRAND",
    syncedAt: "2026-06-07T12:00:00.000Z",
  });
  const unit402 = result.facts.find((f) => f.unit_label === "402");
  assert.ok(unit402);
  const lateFees = unit402.payload.ancillary_charges.filter((row) => row.category === "late_fee");
  assert.ok(lateFees.length > 0);
  assert.equal(lateFees[0].recurring, false);
});

test("Penn 412 splits parking water pet from unit master", () => {
  const mapping = loadPropertyMapping();
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "PENN",
    syncedAt: "2026-06-07T12:00:00.000Z",
  });
  const unit412 = result.facts.find((f) => f.unit_label === "412");
  assert.ok(unit412);
  assert.equal(unit412.rent_cents, 286100);

  const monthly = unit412.payload.ancillary_charges.filter((row) => row.recurring);
  const parking = monthly.find((row) => row.category === "parking");
  const water = monthly.find((row) => row.category === "water");
  const pet = monthly.find((row) => row.category === "pet");

  assert.ok(parking);
  assert.equal(parking.amount_cents, 12500);
  assert.equal(parking.source, "unit_master_segment1");

  assert.ok(water);
  assert.equal(water.amount_cents, 6850);

  assert.ok(pet);
  assert.equal(pet.amount_cents, 4500);

  const monthlyTotal = monthly.reduce((sum, row) => sum + row.amount_cents, 0);
  assert.equal(monthlyTotal, 23850);
  assert.equal(unit412.payload.monthly_billing_extras_cents, 23850);
});

test("Murray 104 one-time PET FEE is pet deposit, not monthly pet fee", () => {
  const mapping = loadPropertyMapping();
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "MURRAY",
    syncedAt: "2026-06-07T12:00:00.000Z",
  });
  const unit104 = result.facts.find((f) => f.unit_label === "104");
  assert.ok(unit104);

  const recurringPet = unit104.payload.ancillary_charges.filter(
    (row) => row.category === "pet" && row.recurring
  );
  assert.equal(recurringPet.length, 0);

  const petDeposit = unit104.payload.ancillary_charges.filter(
    (row) => row.category === "pet_deposit"
  );
  assert.equal(petDeposit.length, 1);
  assert.equal(petDeposit[0].amount_cents, 50000);
  assert.equal(petDeposit[0].label, "Pet deposit");
  assert.equal(petDeposit[0].recurring, false);
});

test("Penn 323 can have monthly pet fee and one-time pet deposit", () => {
  const mapping = loadPropertyMapping();
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "PENN",
    syncedAt: "2026-06-07T12:00:00.000Z",
  });
  const unit323 = result.facts.find((f) => f.unit_label === "323");
  assert.ok(unit323);

  const monthly = unit323.payload.ancillary_charges.find(
    (row) => row.category === "pet" && row.recurring
  );
  assert.ok(monthly);
  assert.match(monthly.label, /monthly/i);

  const deposit = unit323.payload.ancillary_charges.find((row) => row.category === "pet_deposit");
  assert.ok(deposit);
  assert.equal(deposit.label, "Pet deposit");
});

test("extractAncillaryCharges finds explicit water lines in history", () => {
  const rows = extractAncillaryCharges([
    {
      unit_label: "101",
      date: "07/05/2014",
      kind: "charge",
      amount_dollars: 13.19,
      charge_label: "WATER BILL",
      description: "WATER BILL",
    },
  ]);
  assert.ok(rows.ancillary_charges.some((row) => row.category === "water"));
});
