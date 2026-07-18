import crypto from "node:crypto";

const KIND_MAP = Object.freeze({
  move_out_planned: "occupancy_move_out_planned",
  move_out_recorded: "occupancy_move_out_recorded",
  move_in_recorded: "occupancy_move_in_recorded",
  move_out_plan_withdrawn: "occupancy_move_out_plan_withdrawn",
});

const EVIDENCE_BY_EVENT = Object.freeze({
  move_out_planned: new Set(["signed_notice"]),
  move_out_recorded: new Set(["leasehold_move_out_action", "keys_returned"]),
  move_in_recorded: new Set(["leasehold_move_in_action", "keys_issued"]),
  move_out_plan_withdrawn: new Set(["notice_withdrawn"]),
});

function dateOnly(value) {
  const text = String(value ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const d = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? text : "";
}

function idempotencyKey(event, commandKind) {
  const material = [
    "leasehold",
    commandKind,
    String(event.property_code ?? "").trim().toUpperCase(),
    String(event.unit_label ?? "").trim(),
    String(event.source_event_id ?? "").trim(),
    dateOnly(event.effective_date),
  ].join("|");
  return `leasehold-lifecycle:${crypto.createHash("sha256").update(material).digest("hex")}`;
}

/**
 * Translate only explicit Leasehold possession/notice evidence. Snapshot silence,
 * party-name replacement, lease start, and lease end are intentionally rejected.
 */
export function buildExplicitLifecycleSignals(events) {
  const signals = [];
  const rejected = [];
  for (const event of Array.isArray(events) ? events : []) {
    const eventKind = String(event?.event_kind ?? "").trim();
    const commandKind = KIND_MAP[eventKind];
    const evidenceKind = String(event?.evidence_kind ?? "").trim();
    const effectiveDate = dateOnly(event?.effective_date);
    const unitLabel = String(event?.unit_label ?? "").trim();
    const propertyCode = String(event?.property_code ?? "").trim().toUpperCase();
    const sourceEventId = String(event?.source_event_id ?? "").trim();

    if (
      !commandKind ||
      !EVIDENCE_BY_EVENT[eventKind]?.has(evidenceKind) ||
      !effectiveDate ||
      !unitLabel ||
      !propertyCode ||
      !sourceEventId
    ) {
      rejected.push({
        source_event_id: sourceEventId || null,
        reason: "explicit_authoritative_evidence_required",
      });
      continue;
    }

    signals.push({
      schema_version: 1,
      kind: commandKind,
      source_channel: "leasehold_import",
      property_code: propertyCode,
      unit_label: unitLabel,
      effective_at: `${effectiveDate}T12:00:00.000Z`,
      recorded_at: new Date().toISOString(),
      idempotency_key: idempotencyKey(event, commandKind),
      causation_id: String(event.causation_id || sourceEventId),
      actor_id: "leasehold-bridge",
      body: {
        target_ready_date: dateOnly(event.target_ready_date) || null,
        tenant_roster_id: event.tenant_roster_id || null,
        override_reason: String(event.override_reason || ""),
        evidence: {
          kind: evidenceKind,
          source_event_id: sourceEventId,
          source_file: String(event.source_file || ""),
          source_recorded_at: String(event.recorded_at || ""),
        },
      },
    });
  }
  return { signals, rejected };
}

