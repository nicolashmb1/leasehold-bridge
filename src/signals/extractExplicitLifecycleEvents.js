import { tryReadMirrorFile } from "../lib/mirrorRoot.js";
import { parseRentNoticeDat } from "../parsers/parseRentNoticeDat.js";

/**
 * Collect explicit possession/notice events from LH mirror files.
 * Returns bridge-internal events for buildExplicitLifecycleSignals.
 *
 * @param {{ mirrorRoot: string, raGroup: string, properaPropertyCode: string }} opts
 */
export function extractExplicitLifecycleEvents(opts) {
  const raGroup = String(opts?.raGroup || "").trim();
  const propertyCode = String(opts?.properaPropertyCode || "").trim().toUpperCase();
  const mirrorRoot = String(opts?.mirrorRoot || "").trim();
  if (!raGroup || !propertyCode || !mirrorRoot) {
    return { events: [], probe: { rn: { parse_status: "missing", byte_length: 0 } } };
  }

  const rnBuffer = tryReadMirrorFile(mirrorRoot, `${raGroup}RN.DAT`);
  const rnParsed = parseRentNoticeDat(rnBuffer);
  const events = [];

  for (const row of rnParsed.records) {
    const eventKind = String(row.event_kind || "").trim();
    const evidenceKind = String(row.evidence_kind || "").trim();
    const unitLabel = String(row.unit_label || "").trim();
    const effectiveDate = String(row.effective_date || "").trim().slice(0, 10);
    const sourceEventId = String(row.source_event_id || "").trim();
    if (!eventKind || !evidenceKind || !unitLabel || !effectiveDate || !sourceEventId) continue;
    events.push({
      event_kind: eventKind,
      evidence_kind: evidenceKind,
      property_code: propertyCode,
      unit_label: unitLabel,
      effective_date: effectiveDate,
      source_event_id: sourceEventId,
      target_ready_date: row.target_ready_date ?? null,
      tenant_roster_id: row.tenant_roster_id ?? null,
      override_reason: row.override_reason ?? "",
      source_file: `${raGroup}RN.DAT`,
      recorded_at: row.recorded_at ?? "",
      causation_id: row.causation_id ?? sourceEventId,
    });
  }

  return {
    events,
    probe: {
      rn: {
        parse_status: rnParsed.parse_status,
        byte_length: rnParsed.byte_length,
        record_count: rnParsed.records.length,
      },
    },
  };
}
