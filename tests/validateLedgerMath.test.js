import test from "node:test";
import assert from "node:assert/strict";
import { loadPropertyMapping, listImportEnabledProperties } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";
import { validateUnitLedgerMath } from "../src/lib/validateLedgerMath.js";

test("ledger chain math holds for every unit on every enabled property", () => {
  const mapping = loadPropertyMapping();
  const enabled = listImportEnabledProperties(mapping);
  const syncedAt = "2026-06-07T12:00:00.000Z";
  let totalUnits = 0;
  const failures = [];

  for (const property of enabled) {
    const code = property.propera_property_code;
    const result = exportPropertySnapshots({
      mapping,
      properaPropertyCode: code,
      syncedAt,
    });

    for (const fact of result.facts) {
      totalUnits += 1;
      const posted = fact.payload?.posted_transactions ?? [];
      const report = validateUnitLedgerMath(posted, fact.balance_cents);
      assert.equal(
        report.adjacencyFails,
        0,
        `${code} unit ${fact.unit_label}: row-to-row math broke`
      );
      assert.equal(
        report.finalOk,
        true,
        `${code} unit ${fact.unit_label}: final balance != Leasehold stamp`
      );
      assert.equal(
        report.snapshotMatchesFinal,
        true,
        `${code} unit ${fact.unit_label}: snapshot header != ledger final`
      );
      if (!report.ok) failures.push(`${code}/${fact.unit_label}`);
    }
  }

  assert.equal(failures.length, 0, `chain failures: ${failures.join(", ")}`);
  assert.equal(totalUnits, 285);
});

test("Morris unit 208 ADJ and tail payments reconcile", () => {
  const mapping = loadPropertyMapping();
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "MORRIS",
    syncedAt: "2026-06-07T12:00:00.000Z",
  });
  const unit208 = result.facts.find((f) => f.unit_label === "208");
  assert.ok(unit208);
  assert.equal(unit208.balance_cents, 211997);

  const posted = unit208.payload.posted_transactions;
  const adj = posted.find((row) => row.date === "2026-06-01" && row.description === "ADJ");
  assert.ok(adj);
  assert.equal(adj.kind, "adjustment");
  assert.equal(adj.amount_cents, -22500);
  assert.equal(adj.balance_after_cents, 254497);

  const report = validateUnitLedgerMath(posted, unit208.balance_cents);
  assert.equal(report.ok, true);
  assert.equal(report.stampMismatches, 0);
  assert.equal(report.finalCents, 211997);
});
