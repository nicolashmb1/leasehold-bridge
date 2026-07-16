import { LEASE_TERMS_SYNC_KIND, buildLeaseTermsBodyFromFact } from "./leaseTermsBodyFromFact.js";
import { buildLeaseTermsIdempotencyKey } from "./leaseTermsIdempotency.js";

/**
 * Emit lease_terms_sync intent signals from export facts.
 * @param {{ facts: Array<Record<string, unknown>>; propertyCode: string; syncedAt: string }} opts
 */
export function buildLeaseTermsSyncSignals({ facts, propertyCode, syncedAt }) {
  const property = String(propertyCode ?? "").trim().toUpperCase();
  const effectiveAt = String(syncedAt ?? new Date().toISOString());
  const signals = [];
  let skippedVacant = 0;

  for (const fact of facts) {
    if (!fact || typeof fact !== "object") continue;
    const unitLabel = String(fact.unit_label ?? "").trim();
    if (!unitLabel) continue;

    const built = buildLeaseTermsBodyFromFact(fact, effectiveAt);
    if (!built) {
      skippedVacant += 1;
      continue;
    }

    signals.push({
      schema_version: 2,
      kind: LEASE_TERMS_SYNC_KIND,
      source_channel: "leasehold_import",
      property_code: property,
      unit_label: unitLabel,
      idempotency_key: buildLeaseTermsIdempotencyKey({
        sourceSystem: "leasehold",
        propertyCode: property,
        unitLabel,
        effectiveAt,
        body: built.body,
      }),
      effective_at: effectiveAt,
      body: built.body,
    });
  }

  return { signals, skippedVacant };
}
