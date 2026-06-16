import { classifyLeaseholdCharge } from "../normalize/classifyLeaseholdCharge.js";

const LH_KIND_TO_SIGNAL = {
  payment: "payment_received",
  billing: "monthly_billing",
  late_fee: "late_fee",
  adjustment: "adjustment",
};

/**
 * @param {Record<string, unknown>} row — normalized posted_transactions item
 */
export function lhPostedRowToSignalKind(row) {
  const lhKind = String(row?.kind ?? "").trim().toLowerCase();
  if (LH_KIND_TO_SIGNAL[lhKind]) return LH_KIND_TO_SIGNAL[lhKind];

  const classified = classifyLeaseholdCharge({
    kind: lhKind,
    charge_label: row?.description,
    description: row?.description,
  });
  if (classified?.category === "late_fee") return "late_fee";
  if (classified?.category === "fine") return "fine";
  return "one_time_charge";
}

/**
 * @param {{ sourceSystem?: string; propertyCode: string; unitLabel: string; effectiveDate: string; signalKind: string; amountCents: number | null; postedSequence?: number | null; reference?: string | null }} opts
 */
export function buildLedgerEventIdempotencyKey(opts) {
  const source = String(opts.sourceSystem ?? "leasehold").trim().toLowerCase() || "leasehold";
  const property = String(opts.propertyCode ?? "").trim().toUpperCase();
  const unit = String(opts.unitLabel ?? "").trim() || "unknown";
  const date = String(opts.effectiveDate ?? "").trim().slice(0, 10) || "unknown";
  const kindShort =
    {
      payment_received: "payment",
      monthly_billing: "billing",
      late_fee: "late_fee",
      fine: "fine",
      one_time_charge: "charge",
      adjustment: "adjustment",
    }[opts.signalKind] ?? "event";
  const amount =
    opts.amountCents != null && Number.isFinite(Number(opts.amountCents))
      ? Math.abs(Math.round(Number(opts.amountCents)))
      : 0;
  const seq =
    opts.postedSequence != null && Number.isFinite(Number(opts.postedSequence))
      ? `seq${Math.round(Number(opts.postedSequence))}`
      : null;
  const ref = String(opts.reference ?? "").trim();
  const tail = seq || (ref ? `ref${ref.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}` : "seq0");
  return `${source}:${property}:${unit}:${date}:${kindShort}:${amount}:${tail}`;
}

/**
 * @param {{ facts: Array<Record<string, unknown>>; propertyCode: string; syncedAt: string; isPilotUnit?: (property: string, unit: string) => boolean }} opts
 */
export function buildLedgerEventSignals({ facts, propertyCode, syncedAt, isPilotUnit }) {
  const property = String(propertyCode ?? "").trim().toUpperCase();
  const effectiveAt = String(syncedAt ?? new Date().toISOString());
  const signals = [];
  let skippedNonPilot = 0;
  let skippedEmpty = 0;

  for (const fact of facts) {
    if (!fact || typeof fact !== "object") continue;
    const unitLabel = String(fact.unit_label ?? "").trim();
    if (!unitLabel) continue;

    if (typeof isPilotUnit === "function" && !isPilotUnit(property, unitLabel)) {
      skippedNonPilot += 1;
      continue;
    }

    const payload = fact.payload && typeof fact.payload === "object" ? fact.payload : {};
    const posted = Array.isArray(payload.posted_transactions) ? payload.posted_transactions : [];

    for (const row of posted) {
      if (!row || typeof row !== "object") continue;
      const effectiveDate = String(row.date ?? "").trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) continue;

      const amountRaw = row.amount_cents;
      const amountCents =
        amountRaw == null || amountRaw === ""
          ? null
          : Number.isFinite(Number(amountRaw))
            ? Math.round(Number(amountRaw))
            : null;
      if (amountCents == null || amountCents === 0) {
        skippedEmpty += 1;
        continue;
      }

      const signalKind = lhPostedRowToSignalKind(row);
      const postedSequence =
        row.posted_sequence != null && Number.isFinite(Number(row.posted_sequence))
          ? Math.round(Number(row.posted_sequence))
          : null;

      signals.push({
        schema_version: 1,
        kind: signalKind,
        source_channel: "leasehold_import",
        property_code: property,
        unit_label: unitLabel,
        idempotency_key: buildLedgerEventIdempotencyKey({
          sourceSystem: "leasehold",
          propertyCode: property,
          unitLabel,
          effectiveDate,
          signalKind,
          amountCents,
          postedSequence,
          reference: row.reference,
        }),
        effective_at: effectiveAt,
        body: {
          effective_date: effectiveDate,
          amount_cents: amountCents,
          description: String(row.description ?? row.kind ?? signalKind).trim().slice(0, 200),
          reference: row.reference != null ? String(row.reference).trim() || null : null,
          balance_after_cents:
            row.balance_after_cents != null && Number.isFinite(Number(row.balance_after_cents))
              ? Math.round(Number(row.balance_after_cents))
              : null,
          recurring: row.recurring === true,
          lh_kind: String(row.kind ?? "").trim().toLowerCase() || null,
          posted_sequence: postedSequence,
          confidence: "high",
        },
      });
    }
  }

  return { signals, skippedNonPilot, skippedEmpty };
}
