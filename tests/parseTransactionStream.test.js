import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTransactionStream,
  summarizeTransactionsByUnit,
} from "../src/parsers/parseTransactionStream.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplePath = path.join(PACKAGE_ROOT, "lhmirror", "RA0001H.Dat");

test("parseTransactionStream reads fixed 105-byte records", () => {
  const buffer = fs.readFileSync(samplePath);
  const parsed = parseTransactionStream(buffer);
  assert.ok(parsed.record_count > 5000);
  assert.equal(parsed.records[0].unit_label, "101");
});

test("summarizeTransactionsByUnit tracks last payment for unit 101", () => {
  const buffer = fs.readFileSync(samplePath);
  const parsed = parseTransactionStream(buffer);
  const summary = summarizeTransactionsByUnit(parsed.records);
  const unit101 = summary.get("101");
  assert.ok(unit101?.last_payment);
  assert.equal(unit101.last_payment.kind, "payment");
  // Mirror advances; last payment is the last payment row in stream order for 101.
  const streamLastPayment = [...parsed.records]
    .reverse()
    .find((r) => r.unit_label === "101" && r.kind === "payment" && r.amount_dollars != null);
  assert.ok(streamLastPayment);
  assert.equal(unit101.last_payment.date, streamLastPayment.date);
  assert.equal(unit101.last_payment.amount_dollars, streamLastPayment.amount_dollars);
});

test("summarizeTransactionsByUnit keeps more than the old 12-payment / 80-row caps", () => {
  const records = [];
  for (let i = 1; i <= 100; i += 1) {
    const mm = String(((i - 1) % 12) + 1).padStart(2, "0");
    const dd = String(((i - 1) % 28) + 1).padStart(2, "0");
    const yyyy = String(2020 + Math.floor((i - 1) / 12));
    records.push({
      unit_label: "101",
      date: `${mm}/${dd}/${yyyy}`,
      kind: i % 3 === 0 ? "billing" : "payment",
      amount_dollars: 1000 + i,
      balance_after_dollars: i,
      description: i % 3 === 0 ? "RENT" : `CHK ${i}`,
      reference: String(i),
    });
  }
  const summary = summarizeTransactionsByUnit(records);
  const unit = summary.get("101");
  assert.ok(unit);
  assert.equal(unit.recent_posted.length, 100, "all dated rows retained");
  const paymentCount = records.filter((r) => r.kind === "payment").length;
  assert.ok(paymentCount > 12);
  assert.equal(unit.recent_payments.length, paymentCount, "all payments retained");
  assert.equal(unit.last_payment?.reference, "100");
});

test("parseTransactionStream recognizes payments with 1-2 digit check refs", () => {
  const buffer = fs.readFileSync(samplePath);
  const parsed = parseTransactionStream(buffer);
  const payments = parsed.records.filter(
    (r) => r.unit_label === "203" && r.date === "03/31/2025" && r.kind === "payment"
  );
  assert.equal(payments.length, 2);
  const refs = payments.map((p) => p.reference).sort();
  assert.deepEqual(refs, ["1", "2"]);
  assert.equal(payments.find((p) => p.reference === "1")?.amount_dollars, 995);
  assert.equal(payments.find((p) => p.reference === "2")?.amount_dollars, 2446.21);
});

test("parseTransactionStream recognizes payments with 3-digit check refs", () => {
  const buffer = fs.readFileSync(samplePath);
  const parsed = parseTransactionStream(buffer);
  const unit304Payment = parsed.records.find(
    (r) => r.unit_label === "304" && r.date === "06/02/2026"
  );
  assert.ok(unit304Payment);
  assert.equal(unit304Payment.kind, "payment");
  assert.equal(unit304Payment.amount_dollars, 2122.35);
  assert.equal(unit304Payment.balance_after_dollars, 0);
  assert.equal(unit304Payment.reference, "110");
});

test("parseTransactionStream parses ADJ with signed delta and balance after", () => {
  const morrisPath = path.join(PACKAGE_ROOT, "lhmirror", "RA0007H.Dat");
  const buffer = fs.readFileSync(morrisPath);
  const parsed = parseTransactionStream(buffer);
  const adj = parsed.records.find(
    (r) => r.unit_label === "208" && r.date === "06/01/2026" && r.description === "ADJ"
  );
  assert.ok(adj);
  assert.equal(adj.kind, "adjustment");
  assert.equal(adj.prior_balance_dollars, 2769.97);
  assert.equal(adj.amount_dollars, -225);
  assert.equal(adj.balance_after_dollars, 2544.97);
});

test("parseTransactionStream parses NSF ERROR and KEY lines with signed amounts", () => {
  const westgrandPath = path.join(PACKAGE_ROOT, "lhmirror", "RA0001H.Dat");
  const morrisPath = path.join(PACKAGE_ROOT, "lhmirror", "RA0007H.Dat");
  const pennPath = path.join(PACKAGE_ROOT, "lhmirror", "RA0006H.Dat");

  const wg = parseTransactionStream(fs.readFileSync(westgrandPath)).records;
  const nsf = wg.find(
    (r) =>
      r.unit_label === "402" &&
      r.date === "06/05/2026" &&
      r.description?.startsWith("NSF") &&
      r.amount_dollars > 0
  );
  assert.ok(nsf);
  assert.equal(nsf.kind, "adjustment");
  assert.equal(nsf.amount_dollars, 1614.79);
  assert.equal(nsf.balance_after_dollars, 3833.59);

  const err = wg.find((r) => r.unit_label === "402" && r.date === "06/05/2026" && r.description === "ERROR");
  assert.ok(err);
  assert.equal(err.kind, "adjustment");
  assert.equal(err.amount_dollars, -50);

  const mo = parseTransactionStream(fs.readFileSync(morrisPath)).records;
  const key = mo.find((r) => r.unit_label === "212" && r.date === "05/13/2026" && r.description?.includes("KEYFOB"));
  assert.ok(key);
  assert.equal(key.kind, "other");
  assert.equal(key.amount_dollars, 75);
  assert.equal(key.balance_after_dollars, 125);

  const pe = parseTransactionStream(fs.readFileSync(pennPath)).records;
  const fobs = pe.find((r) => r.unit_label === "211" && r.date === "06/01/2026" && r.description?.includes("2KEY FOBS"));
  assert.ok(fobs);
  assert.equal(fobs.amount_dollars, 150);
  assert.equal(fobs.balance_after_dollars, 135.29);

  const errPenn = pe.find((r) => r.unit_label === "211" && r.date === "01/03/2026" && r.description === "ERROR");
  assert.ok(errPenn);
  assert.equal(errPenn.kind, "adjustment");
  assert.equal(errPenn.amount_dollars, 3100);

  const morder = wg.find((r) => r.unit_label === "401" && r.date === "12/13/2025" && r.description === "M-ORDER");
  assert.ok(morder);
  assert.equal(morder.kind, "payment");
  assert.equal(morder.amount_dollars, 1000);
});
