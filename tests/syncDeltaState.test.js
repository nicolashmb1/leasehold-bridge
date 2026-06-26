import test from "node:test";
import assert from "node:assert/strict";
import {
  filterLeaseTermsSignalsByDelta,
  filterLedgerEventSignalsByDelta,
  shouldFilterSignals,
  mergePropertyDeltaCursor,
  buildUnitDeltaMapFromFacts,
} from "../src/lib/syncDeltaState.js";
import { fingerprintLeaseTermsBody } from "../src/signals/leaseTermsIdempotency.js";

const LEASE_BODY_A = {
  rent_cents: 240600,
  lease_start: "2025-06-01",
  lease_end: "2026-05-31",
  security_deposit_cents: 240600,
  charge_lines: [],
};

test("shouldFilterSignals — off until baseline seeded (WESTFIELD pilot)", () => {
  assert.equal(shouldFilterSignals("WESTGRAND", null), false);
  assert.equal(shouldFilterSignals("WESTFIELD", { fingerprint: "abc" }), false);
  assert.equal(
    shouldFilterSignals("WESTFIELD", { delta: { baselineSeededAt: "2026-06-24T00:00:00.000Z" } }),
    true
  );
});

test("filterLeaseTermsSignalsByDelta — skips unchanged unit fingerprint", () => {
  const fp = fingerprintLeaseTermsBody(LEASE_BODY_A);
  const signals = [
    {
      unit_label: "314",
      kind: "lease_terms_sync",
      body: LEASE_BODY_A,
    },
    {
      unit_label: "412",
      kind: "lease_terms_sync",
      body: { ...LEASE_BODY_A, rent_cents: 255000 },
    },
  ];

  const { signals: kept, skippedUnchanged } = filterLeaseTermsSignalsByDelta(signals, {
    "314": { leaseTermsFp: fp },
    "412": { leaseTermsFp: fingerprintLeaseTermsBody({ ...LEASE_BODY_A, rent_cents: 240600 }) },
  });

  assert.equal(skippedUnchanged, 1);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].unit_label, "412");
});

test("filterLedgerEventSignalsByDelta — skips known idempotency keys", () => {
  const key = "leasehold:WESTFIELD:101:2026-06-03:payment:253100:ref16878";
  const { signals: kept, skippedKnown } = filterLedgerEventSignalsByDelta(
    [
      { unit_label: "101", idempotency_key: key },
      {
        unit_label: "101",
        idempotency_key: "leasehold:WESTFIELD:101:2026-06-04:payment:100000:ref16879",
      },
    ],
    { "101": { ledgerKeys: [key] } }
  );

  assert.equal(skippedKnown, 1);
  assert.equal(kept.length, 1);
  assert.ok(String(kept[0].idempotency_key).includes("ref16879"));
});

test("mergePropertyDeltaCursor — seeds baseline on first successful import", () => {
  const unitMap = {
    "314": { leaseTermsFp: "abc123", ledgerKeys: ["key1"] },
  };
  const merged = mergePropertyDeltaCursor({ fingerprint: "fp1" }, unitMap, { seedBaseline: true });
  assert.ok(merged.delta.baselineSeededAt);
  assert.equal(merged.delta.units["314"].leaseTermsFp, "abc123");
  assert.deepEqual(merged.delta.units["314"].ledgerKeys, ["key1"]);
});

test("buildUnitDeltaMapFromFacts — captures lease fp and ledger keys", () => {
  const map = buildUnitDeltaMapFromFacts({
    propertyCode: "WESTFIELD",
    syncedAt: "2026-06-24T12:00:00.000Z",
    facts: [
      {
        unit_label: "101",
        tenant_name: "Tenant",
        rent_cents: 240600,
        lease_start: "2025-06-01",
        lease_end: "2026-05-31",
        payload: {
          posted_transactions: [
            {
              date: "2026-06-03",
              amount_cents: 253100,
              kind: "payment",
              posted_sequence: 45,
              description: "CK",
            },
          ],
        },
      },
    ],
  });

  assert.ok(map["101"].leaseTermsFp);
  assert.equal(map["101"].ledgerKeys.length, 1);
  assert.ok(map["101"].ledgerKeys[0].includes(":payment:"));
});
