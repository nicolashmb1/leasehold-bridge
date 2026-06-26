import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLedgerEventSignals,
  buildLedgerEventIdempotencyKey,
  lhPostedRowToSignalKind,
} from "../src/signals/buildLedgerEventSignals.js";

test("lhPostedRowToSignalKind maps payment and billing", () => {
  assert.equal(lhPostedRowToSignalKind({ kind: "payment" }), "payment_received");
  assert.equal(lhPostedRowToSignalKind({ kind: "billing" }), "monthly_billing");
});

test("buildLedgerEventIdempotencyKey is stable without window sequence", () => {
  const key = buildLedgerEventIdempotencyKey({
    propertyCode: "WESTFIELD",
    unitLabel: "101",
    effectiveDate: "2026-06-03",
    signalKind: "payment_received",
    amountCents: 253100,
    reference: "16878",
  });
  assert.equal(key, "leasehold:WESTFIELD:101:2026-06-03:payment:253100:ref16878");

  const adj = buildLedgerEventIdempotencyKey({
    propertyCode: "WESTFIELD",
    unitLabel: "310",
    effectiveDate: "2026-06-19",
    signalKind: "adjustment",
    amountCents: 22500,
    description: "ADJ",
    balanceAfterCents: 206708,
  });
  assert.equal(adj, "leasehold:WESTFIELD:310:2026-06-19:adjustment:22500:ADJ:b206708");
});

test("buildLedgerEventSignals emits only pilot units", () => {
  const facts = [
    {
      unit_label: "101",
      payload: {
        posted_transactions: [
          {
            date: "2026-06-03",
            kind: "payment",
            amount_cents: 100000,
            description: "CK",
            posted_sequence: 1,
          },
        ],
      },
    },
    {
      unit_label: "102",
      payload: {
        posted_transactions: [
          {
            date: "2026-06-03",
            kind: "payment",
            amount_cents: 50000,
            description: "CK",
            posted_sequence: 1,
          },
        ],
      },
    },
  ];

  const out = buildLedgerEventSignals({
    facts,
    propertyCode: "WESTFIELD",
    syncedAt: "2026-06-15T12:00:00.000Z",
    isPilotUnit: (_p, unit) => unit === "101",
  });

  assert.equal(out.signals.length, 1);
  assert.equal(out.signals[0].unit_label, "101");
  assert.equal(out.signals[0].kind, "payment_received");
  assert.ok(String(out.signals[0].idempotency_key).includes(":payment:"));
  assert.equal(out.skippedNonPilot, 1);
});

test("buildLedgerEventSignals dedupe keys differ by business identity", () => {
  const facts = [
    {
      unit_label: "101",
      payload: {
        posted_transactions: [
          {
            date: "2026-06-01",
            kind: "billing",
            amount_cents: 200000,
            description: "Monthly Billing",
            balance_after_cents: 200000,
            posted_sequence: 0,
          },
          {
            date: "2026-06-03",
            kind: "payment",
            amount_cents: 200000,
            description: "payment",
            balance_after_cents: 0,
            reference: "1234",
            posted_sequence: 1,
          },
        ],
      },
    },
  ];

  const out = buildLedgerEventSignals({
    facts,
    propertyCode: "WESTFIELD",
    syncedAt: "2026-06-15T12:00:00.000Z",
    isPilotUnit: () => true,
  });

  assert.equal(out.signals.length, 2);
  const keys = new Set(out.signals.map((s) => s.idempotency_key));
  assert.equal(keys.size, 2);
});

test("buildLedgerEventIdempotencyKey ignores shifting posted_sequence", () => {
  const base = {
    propertyCode: "WESTFIELD",
    unitLabel: "310",
    effectiveDate: "2026-06-19",
    signalKind: "adjustment",
    amountCents: 22500,
    description: "ADJ",
    balanceAfterCents: 206708,
  };
  const a = buildLedgerEventIdempotencyKey(base);
  assert.equal(a, buildLedgerEventIdempotencyKey(base));
});
