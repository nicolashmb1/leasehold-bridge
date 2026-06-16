import crypto from "crypto";

export function parseDateOnly(raw) {
  const text = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function fingerprintLeaseTermsBody(body) {
  const parts = [
    body.rent_cents,
    body.lease_start,
    body.lease_end,
    body.security_deposit_cents,
    body.other_deposit_cents,
    body.pet_deposit_cents,
    body.key_deposit_cents,
    body.tenant_net_rent_cents,
    body.rent_subsidy_cents,
    stableJson(body.charge_lines ?? []),
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12);
}

export function buildLeaseTermsIdempotencyKey({
  sourceSystem = "leasehold",
  propertyCode,
  unitLabel,
  effectiveAt,
  body,
}) {
  const source = String(sourceSystem ?? "leasehold").trim().toLowerCase() || "leasehold";
  const property = String(propertyCode ?? "").trim().toUpperCase();
  const unit = String(unitLabel ?? "").trim() || "unknown";
  const date = parseDateOnly(effectiveAt) || String(effectiveAt ?? "").slice(0, 10) || "unknown";
  const fp = fingerprintLeaseTermsBody(body ?? {});
  return `${source}:${property}:${unit}:${date}:lease_terms:${fp}`;
}
