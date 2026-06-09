/** Maps bridge export facts → Propera import API body (accounting-snapshots contract). */

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

export function buildImportPayload(exportResult) {
  const facts = Array.isArray(exportResult?.facts) ? exportResult.facts : [];
  const propertyCode = String(exportResult?.property?.propera_property_code ?? "").trim().toUpperCase();
  const syncedAt =
    String(facts[0]?.synced_at ?? "").trim() || new Date().toISOString();

  return {
    source_system: "leasehold",
    propera_property_code: propertyCode,
    synced_at: syncedAt,
    facts: facts.map(mapFact),
  };
}
