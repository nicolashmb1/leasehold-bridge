import test from "node:test";
import assert from "node:assert/strict";

import { buildExplicitLifecycleSignals } from "../src/signals/buildExplicitLifecycleSignals.js";

test("maps explicit Leasehold move-out evidence to canonical command signal", () => {
  const event = {
    event_kind: "move_out_recorded",
    evidence_kind: "keys_returned",
    source_event_id: "LH-AUDIT-42",
    source_file: "actions-2026-07-18.dat",
    property_code: "westfield",
    unit_label: "2B",
    effective_date: "2026-07-18",
    recorded_at: "2026-07-18T18:00:00.000Z",
    target_ready_date: "2026-07-25",
  };
  const first = buildExplicitLifecycleSignals([event]);
  const retry = buildExplicitLifecycleSignals([event]);
  assert.equal(first.rejected.length, 0);
  assert.equal(first.signals.length, 1);
  assert.equal(first.signals[0].kind, "occupancy_move_out_recorded");
  assert.equal(first.signals[0].source_channel, "leasehold_import");
  assert.equal(first.signals[0].body.evidence.source_event_id, "LH-AUDIT-42");
  assert.equal(first.signals[0].idempotency_key, retry.signals[0].idempotency_key);
});

test("does not infer physical events from replacement or lease dates", () => {
  const out = buildExplicitLifecycleSignals([
    {
      event_kind: "move_out_recorded",
      evidence_kind: "tenant_name_replaced",
      source_event_id: "snapshot-row-7",
      property_code: "WESTFIELD",
      unit_label: "2B",
      effective_date: "2026-07-18",
    },
    {
      event_kind: "lease_started",
      evidence_kind: "lease_start",
      source_event_id: "lease-8",
      property_code: "WESTFIELD",
      unit_label: "2B",
      effective_date: "2026-07-18",
    },
  ]);
  assert.equal(out.signals.length, 0);
  assert.equal(out.rejected.length, 2);
});

test("evidence authority is command-specific", () => {
  const out = buildExplicitLifecycleSignals([
    {
      event_kind: "move_out_recorded",
      evidence_kind: "signed_notice",
      source_event_id: "notice-is-not-keys",
      property_code: "WESTFIELD",
      unit_label: "2B",
      effective_date: "2026-07-18",
    },
    {
      event_kind: "move_in_recorded",
      evidence_kind: "keys_returned",
      source_event_id: "wrong-key-direction",
      property_code: "WESTFIELD",
      unit_label: "2B",
      effective_date: "2026-07-18",
    },
  ]);
  assert.equal(out.signals.length, 0);
  assert.equal(out.rejected.length, 2);
});

test("portal and bridge domain facts differ only by provenance envelope", () => {
  const out = buildExplicitLifecycleSignals([
    {
      event_kind: "move_in_recorded",
      evidence_kind: "keys_issued",
      source_event_id: "LH-KEYS-9",
      property_code: "WESTFIELD",
      unit_label: "2B",
      effective_date: "2026-07-18",
      tenant_roster_id: "33333333-3333-4333-8333-333333333333",
    },
  ]);
  const signal = out.signals[0];
  assert.deepEqual(
    {
      command_kind: signal.kind,
      property_code: signal.property_code,
      effective_date: signal.effective_at.slice(0, 10),
      tenant_roster_id: signal.body.tenant_roster_id,
    },
    {
      command_kind: "occupancy_move_in_recorded",
      property_code: "WESTFIELD",
      effective_date: "2026-07-18",
      tenant_roster_id: "33333333-3333-4333-8333-333333333333",
    }
  );
});

