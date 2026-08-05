/** Maps bridge export facts → Propera import API body (accounting-snapshots contract). */

import { buildLeaseTermsSyncSignals } from "../signals/buildLeaseTermsSyncSignals.js";
import { buildLedgerEventSignals } from "../signals/buildLedgerEventSignals.js";
import { buildExplicitLifecycleSignals } from "../signals/buildExplicitLifecycleSignals.js";
import { isLedgerMimicPilotUnit } from "../signals/ledgerMimicPilot.js";
import {
  shouldFilterSignals,
  readUnitDeltaMap,
  filterLeaseTermsSignalsByDelta,
  filterLedgerEventSignalsByDelta,
  buildUnitDeltaMapFromFacts,
  isSyncDeltaPilotProperty,
} from "./syncDeltaState.js";

function optionalCents(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function optionalString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function mapFact(row) {
  return {
    unit_label: String(row.unit_label ?? "").trim(),
    rent_cents: optionalCents(row.rent_cents),
    security_deposit_cents: optionalCents(row.security_deposit_cents),
    other_deposit_cents: optionalCents(row.other_deposit_cents),
    pet_deposit_cents: optionalCents(row.pet_deposit_cents),
    key_deposit_cents: optionalCents(row.key_deposit_cents),
    balance_cents: optionalCents(row.balance_cents),
    balance_status: optionalString(row.balance_status),
    lease_start: optionalString(row.lease_start),
    lease_end: optionalString(row.lease_end),
    last_payment_at: optionalString(row.last_payment_at),
    last_payment_cents: optionalCents(row.last_payment_cents),
    tenant_name: optionalString(row.tenant_name),
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload
        : {},
  };
}

/**
 * @param {Record<string, unknown>} exportResult
 * @param {{ propertyCursor?: Record<string, unknown> | null }} [options]
 */
export function buildImportPayload(exportResult, options = {}) {
  const facts = Array.isArray(exportResult?.facts) ? exportResult.facts : [];
  const propertyCode = String(exportResult?.property?.propera_property_code ?? "").trim().toUpperCase();
  const syncedAt =
    String(facts[0]?.synced_at ?? "").trim() || new Date().toISOString();
  const propertyCursor = options.propertyCursor ?? null;

  const leaseBuilt = buildLeaseTermsSyncSignals({
    facts,
    propertyCode,
    syncedAt,
  });

  const ledgerBuilt = buildLedgerEventSignals({
    facts,
    propertyCode,
    syncedAt,
    isPilotUnit: isLedgerMimicPilotUnit,
  });
  const lifecycleBuilt = buildExplicitLifecycleSignals(
    exportResult?.explicit_lifecycle_events
  );

  let leaseSignals = leaseBuilt.signals;
  let ledgerSignals = ledgerBuilt.signals;
  let skippedLeaseUnchanged = 0;
  let skippedLedgerKnown = 0;

  if (shouldFilterSignals(propertyCode, propertyCursor)) {
    const unitDeltaMap = readUnitDeltaMap(propertyCursor);
    const leaseFiltered = filterLeaseTermsSignalsByDelta(leaseSignals, unitDeltaMap);
    leaseSignals = leaseFiltered.signals;
    skippedLeaseUnchanged = leaseFiltered.skippedUnchanged;

    const ledgerFiltered = filterLedgerEventSignalsByDelta(ledgerSignals, unitDeltaMap);
    ledgerSignals = ledgerFiltered.signals;
    skippedLedgerKnown = ledgerFiltered.skippedKnown;
  }

  const unitDeltaMapFromExport = buildUnitDeltaMapFromFacts({
    facts,
    propertyCode,
    syncedAt,
  });

  return {
    source_system: "leasehold",
    propera_property_code: propertyCode,
    synced_at: syncedAt,
    facts: facts.map(mapFact),
    // Money out and deposits ride the same envelope. Propera routes by kind and
    // now reports anything it does not recognise rather than dropping it.
    signals: [
      ...leaseSignals,
      ...ledgerSignals,
      ...lifecycleBuilt.signals,
      ...(exportResult?.money_path_signals ?? []),
    ],
    delta_meta: {
      pilot: isSyncDeltaPilotProperty(propertyCode),
      filtering: shouldFilterSignals(propertyCode, propertyCursor),
      skipped_lease_unchanged: skippedLeaseUnchanged,
      skipped_ledger_known: skippedLedgerKnown,
      lease_signal_count: leaseSignals.length,
      ledger_signal_count: ledgerSignals.length,
      lifecycle_signal_count: lifecycleBuilt.signals.length,
      lifecycle_rejected: lifecycleBuilt.rejected,
      unit_delta_map: unitDeltaMapFromExport,
    },
    money_path_meta: exportResult?.money_path_meta ?? null,
    money_path_problems: exportResult?.money_path_problems ?? [],
  };
}
