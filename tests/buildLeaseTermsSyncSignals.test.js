import test from "node:test";
import assert from "node:assert/strict";
import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";
import { buildImportPayload } from "../src/lib/buildImportPayload.js";
import { buildLeaseTermsSyncSignals } from "../src/signals/buildLeaseTermsSyncSignals.js";

test("buildImportPayload includes lease_terms_sync signals", () => {
  const mapping = loadPropertyMapping();
  const exportResult = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "WESTGRAND",
    syncedAt: "2026-06-15T12:00:00.000Z",
  });

  const payload = buildImportPayload(exportResult);
  assert.ok(Array.isArray(payload.signals));
  assert.ok(payload.signals.length > 0);
  assert.equal(payload.signals.length, payload.facts.filter((f) => String(f.tenant_name ?? "").trim()).length);

  const first = payload.signals[0];
  assert.equal(first.kind, "lease_terms_sync");
  assert.equal(first.source_channel, "leasehold_import");
  assert.equal(first.property_code, "WESTGRAND");
  assert.ok(String(first.unit_label ?? "").length > 0);
  assert.ok(String(first.idempotency_key ?? "").includes(":lease_terms:"));
  assert.ok(first.body?.rent_cents != null);
  assert.ok(Array.isArray(first.body?.charge_lines));
  assert.ok(Array.isArray(first.body?.parties));
  assert.equal(first.schema_version, 2);
});

test("buildLeaseTermsSyncSignals skips vacant units", () => {
  const { signals, skippedVacant } = buildLeaseTermsSyncSignals({
    propertyCode: "TEST",
    syncedAt: "2026-06-15T12:00:00.000Z",
    facts: [
      { unit_label: "101", tenant_name: "Occupied", rent_cents: 100000 },
      { unit_label: "999" },
    ],
  });
  assert.equal(signals.length, 1);
  assert.equal(skippedVacant, 1);
  assert.equal(signals[0].unit_label, "101");
  assert.ok(Array.isArray(signals[0].body.parties));
  assert.equal(signals[0].body.parties[0].full_name, "Occupied");
});
