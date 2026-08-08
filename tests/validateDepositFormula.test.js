import test from "node:test";
import assert from "node:assert/strict";
import { loadPropertyMapping, listImportEnabledProperties } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";
import { validatePropertyDepositFormula } from "../src/lib/validateDepositFormula.js";

test("deposit formula holds for every unit on every import-enabled property", () => {
  const mapping = loadPropertyMapping();
  const enabled = listImportEnabledProperties(mapping);
  const syncedAt = "2026-06-08T12:00:00.000Z";
  let totalUnits = 0;
  const failures = [];

  for (const property of enabled) {
    const code = property.propera_property_code;
    const result = exportPropertySnapshots({
      mapping,
      properaPropertyCode: code,
      syncedAt,
    });
    totalUnits += result.facts.length;
    const report = validatePropertyDepositFormula(result.facts);
    for (const row of report.failures) {
      failures.push(`${code}/${row.unit}`);
    }
  }

  assert.equal(failures.length, 0, `deposit formula failures: ${failures.join(", ")}`);
  assert.ok(totalUnits >= 285, `expected >= 285 units, got ${totalUnits}`);
  assert.equal(enabled.length, 5);
});
