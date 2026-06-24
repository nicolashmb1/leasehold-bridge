import { parseAccountingAncillaryCharges } from "./accountingLedgerParse.js";
import { deriveNetRentFromSnapshotPayload } from "./netRentEnrichment.js";
import { buildPrefilledChargeLines } from "./unitChargePrefill.js";

export const LEASE_TERMS_SYNC_KIND = "lease_terms_sync";

function parseDateOnly(raw) {
  const text = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeCents(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.max(0, Math.round(Number(value)));
}

function readDepositCents(fact, field) {
  const top = fact[field];
  if (top != null && Number.isFinite(Number(top))) {
    return Math.max(0, Math.round(Number(top)));
  }
  const payload =
    fact.payload && typeof fact.payload === "object" ? fact.payload : null;
  const deposits =
    payload?.deposits && typeof payload.deposits === "object" ? payload.deposits : null;
  const nested = deposits?.[field];
  if (nested != null && Number.isFinite(Number(nested))) {
    return Math.max(0, Math.round(Number(nested)));
  }
  return null;
}

export function isOccupiedSnapshotUnit(fact) {
  const name = String(fact.tenant_name ?? "").trim();
  if (name.length > 0) return true;
  const rent = fact.rent_cents != null ? Number(fact.rent_cents) : null;
  if (rent != null && Number.isFinite(rent) && rent > 0) return true;
  if (parseDateOnly(fact.lease_start) || parseDateOnly(fact.lease_end)) return true;
  return false;
}

/** Build lease_terms_sync body from export fact — LH adapter output (no Propera DB reads). */
export function buildLeaseTermsBodyFromFact(fact, syncedAt) {
  if (!isOccupiedSnapshotUnit(fact)) return null;

  const payload = fact.payload && typeof fact.payload === "object" ? fact.payload : {};
  const rentCents = normalizeCents(fact.rent_cents != null ? Number(fact.rent_cents) : null);
  const leaseStart = parseDateOnly(fact.lease_start);
  const leaseEnd = parseDateOnly(fact.lease_end);
  if (leaseStart && leaseEnd && leaseEnd < leaseStart) {
    return null;
  }

  const securityCents = readDepositCents(fact, "security_deposit_cents");
  const otherCents = readDepositCents(fact, "other_deposit_cents");
  const petCents = readDepositCents(fact, "pet_deposit_cents");
  const keyCents = readDepositCents(fact, "key_deposit_cents");
  const hasDeposits =
    securityCents != null || otherCents != null || petCents != null || keyCents != null;

  const pattern = deriveNetRentFromSnapshotPayload(
    payload,
    rentCents ?? (fact.rent_cents != null ? Number(fact.rent_cents) : null)
  );
  const hasNetRent =
    pattern.tenantNetRentCents != null &&
    pattern.subsidyCents != null &&
    pattern.sampleMonths >= 3;

  const ancillary = parseAccountingAncillaryCharges(payload);
  const chargeLines = buildPrefilledChargeLines(ancillary);

  const body = {
    rent_cents: rentCents,
    lease_start: leaseStart,
    lease_end: leaseEnd,
    charge_lines: chargeLines,
  };
  if (securityCents != null) body.security_deposit_cents = securityCents;
  if (otherCents != null) body.other_deposit_cents = otherCents;
  if (petCents != null) body.pet_deposit_cents = petCents;
  if (keyCents != null) body.key_deposit_cents = keyCents;

  if (hasNetRent) {
    body.tenant_net_rent_cents = pattern.tenantNetRentCents;
    body.rent_subsidy_cents = pattern.subsidyCents;
    body.rent_subsidy_label = "Credit";
    body.net_rent_derived_at = syncedAt;
  }

  if (hasDeposits) {
    body.deposits_derived_at = syncedAt;
  }

  return { body, hasNetRent, hasDeposits };
}
