import test from "node:test";
import assert from "node:assert/strict";
import { buildDisbursementSignals } from "../src/signals/buildDisbursementSignals.js";
import { refFamily, groupTransactions } from "../src/parsers/parseGlYearFile.js";

/** One parsed GL record. */
function rec(date, ref, account_code, { debit = 0, credit = 0, description = "" } = {}) {
  return {
    entity: "A540",
    date,
    description,
    account_code,
    debit_dollars: debit,
    credit_dollars: credit,
    ref,
  };
}

test("a ref splits into family and sequence", () => {
  assert.deepEqual(refFamily("APE3261"), { family: "APE", sequence: 3261 });
  assert.deepEqual(refFamily("VCE2960"), { family: "VCE", sequence: 2960 });
  assert.deepEqual(refFamily("SRESECU"), { family: "SRESECU", sequence: null });
});

test("both sides of a cheque group by date and ref", () => {
  const txs = groupTransactions([
    rec("2026-01-02", "APE2839", "1000", { credit: 17699.95 }),
    rec("2026-01-02", "APE2839", "1005", { debit: 17699.95 }),
    rec("2026-01-05", "APE2840", "1000", { credit: 100 }),
  ]);
  assert.equal(txs.length, 2);
  assert.equal(txs[0].lines.length, 2);
});

test("a cheque becomes a signal whose destination is the counterpart account", () => {
  const out = buildDisbursementSignals(
    [
      rec("2026-01-02", "APE2839", "1000", { credit: 17699.95, description: "SAMUEL ENGEL Checking 5" }),
      rec("2026-01-02", "APE2839", "1005", { debit: 17699.95, description: "SAMUEL ENGEL" }),
    ],
    { propertyCode: "MORRIS" }
  );

  assert.equal(out.signals.length, 1);
  const s = out.signals[0];
  assert.equal(s.kind, "disbursement_sent", "an event, not a record");
  assert.equal(s.schema_version, 1);
  assert.equal(s.source_channel, "leasehold_import");
  assert.equal(
    s.idempotency_key,
    "leasehold:MORRIS:2026-01-02:disb:1769995:refAPE2839",
    "built from domain facts, so a re-sync produces the same key"
  );
  assert.equal(s.body.reference, "APE2839");
  assert.equal(s.body.check_number, "2839");
  assert.equal(s.body.amount_cents, 1769995);
  assert.deepEqual(
    s.body.allocations.map((a) => a.external_account_code),
    ["1005"],
    "reports Leasehold's own code as a fact; the brain maps it"
  );
  assert.equal(s.body.payee_name, "SAMUEL ENGEL", "the clean name, not 'SAMUEL ENGEL Checking 5'");
  assert.equal(out.problems.length, 0);
});

// The description embeds a category label and the same payee appears under
// several of them, so the account code is the only reliable destination.
test("the category never comes from the payee text", () => {
  const out = buildDisbursementSignals(
    [
      rec("2026-03-02", "APE2900", "1000", { credit: 500, description: "GRAND MANAGEMENT GROUP Mgmt Fee" }),
      rec("2026-03-02", "APE2900", "5300", { debit: 500 }),
      rec("2026-03-03", "APE2901", "1000", { credit: 250, description: "GRAND MANAGEMENT GROUP Apt Repair" }),
      rec("2026-03-03", "APE2901", "5207", { debit: 250 }),
    ],
    { propertyCode: "MORRIS" }
  );
  assert.deepEqual(
    out.signals.map((s) => s.body.allocations[0].external_account_code),
    ["5300", "5207"],
    "same payee, two destinations"
  );
});

test("a cheque split across accounts emits a part each, totalling the cheque", () => {
  const out = buildDisbursementSignals(
    [
      rec("2026-04-01", "APE2910", "1000", { credit: 1000, description: "SPLIT PAYEE" }),
      rec("2026-04-01", "APE2910", "5110", { debit: 600 }),
      rec("2026-04-01", "APE2910", "5101", { debit: 400 }),
    ],
    { propertyCode: "MORRIS" }
  );
  const s = out.signals[0];
  assert.equal(s.body.allocations.length, 2);
  assert.equal(
    s.body.allocations.reduce((n, a) => n + a.amount_cents, 0),
    s.body.amount_cents,
    "the parts are the whole"
  );
  assert.equal(out.problems.length, 0);
});

test("a cheque whose parts do not total is reported, never posted", () => {
  const out = buildDisbursementSignals(
    [
      rec("2026-04-02", "APE2911", "1000", { credit: 1000 }),
      rec("2026-04-02", "APE2911", "5110", { debit: 600 }),
    ],
    { propertyCode: "MORRIS" }
  );
  assert.equal(out.signals.length, 0);
  assert.equal(out.problems[0].problem, "counterpart_total_mismatch");
});

test("cash moving with no destination is reported, never guessed", () => {
  const out = buildDisbursementSignals(
    [rec("2026-04-03", "APE2912", "1000", { credit: 1000, description: "MYSTERY" })],
    { propertyCode: "MORRIS" }
  );
  assert.equal(out.signals.length, 0);
  assert.equal(out.problems[0].problem, "no_counterpart_line");
});

test("a void debits cash back and points at the original cheque", () => {
  const out = buildDisbursementSignals(
    [rec("2026-06-29", "VCE2960", "1000", { debit: 100008.18, description: "Voided Tr-06/29/2026" })],
    { propertyCode: "MORRIS" }
  );
  const v = out.signals[0];
  assert.equal(v.kind, "disbursement_voided");
  assert.equal(v.body.reference, "APE2960", "names the cheque it cancels; the brain finds it");
  assert.equal(v.body.amount_cents, 10000818);
  assert.deepEqual(v.body.allocations, [], "a void restates no accounts");
});

test("tenant receipts and deposits are not disbursements", () => {
  const out = buildDisbursementSignals(
    [
      rec("2026-01-31", "RCE540", "1000", { debit: 195314.86, description: "Jan $ Rental Income" }),
      rec("2026-01-05", "SRESECU", "1000", { debit: 5008, description: "TENANT #101" }),
    ],
    { propertyCode: "MORRIS" }
  );
  assert.equal(out.signals.length, 0);
  assert.equal(out.problems.length, 0);
});
