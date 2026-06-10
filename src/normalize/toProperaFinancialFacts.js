import { parseLeaseholdDate, parseMoneyToCents } from "../lib/money.js";
import { classifyLeaseholdCharge } from "./classifyLeaseholdCharge.js";
import { extractAncillaryCharges } from "./extractAncillaryCharges.js";

function postedAmountCents(record) {
  const kind = String(record?.kind ?? "").trim().toLowerCase();
  if (kind === "adjustment") {
    return parseMoneyToCents(record?.amount_dollars);
  }
  if (kind === "billing") {
    const rent = Number(record?.rent_dollars);
    const extras = Number(record?.extras_dollars);
    if (Number.isFinite(rent) && Number.isFinite(extras)) {
      return parseMoneyToCents(rent + extras);
    }
    const prior = Number(record?.prior_balance_dollars);
    const after = Number(record?.balance_after_dollars);
    if (Number.isFinite(prior) && Number.isFinite(after)) {
      return parseMoneyToCents(after - prior);
    }
  }
  return parseMoneyToCents(record?.amount_dollars);
}

function normalizePostedTransaction(record) {
  const date = parseLeaseholdDate(record?.date);
  if (!date) return null;
  const description = String(
    record?.charge_label ?? record?.description ?? record?.kind ?? ""
  )
    .trim()
    .slice(0, 200);
  const classified = classifyLeaseholdCharge(record);
  const priorBalance = parseMoneyToCents(
    record?.prior_balance_dollars ?? record?.balance_before_dollars
  );

  return {
    date,
    kind: String(record?.kind ?? "other").trim().toLowerCase() || "other",
    description: description || String(record?.kind ?? "posted"),
    amount_cents: postedAmountCents(record),
    balance_after_cents: parseMoneyToCents(record?.balance_after_dollars),
    prior_balance_cents: priorBalance,
    reference: record?.reference != null ? String(record.reference) : null,
    charge_category: classified?.category ?? null,
    recurring: classified?.recurring ?? null,
  };
}

function balanceStatus(balanceCents) {
  if (balanceCents == null) return "unknown";
  if (balanceCents <= 0) return "paid_up";
  return "delinquent";
}

function leaseholdDateMs(raw) {
  const iso = parseLeaseholdDate(raw);
  if (!iso) return 0;
  const ms = new Date(`${iso}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Prefer latest meaningful payment over tiny trailing partials (e.g. $200 on $1300 rent).
 * Uses 20% of rent (min $500) — so $1000 on ~$2406 rent counts; $200 still does not.
 */
export function pickDisplayLastPayment(recentPayments, rentDollars) {
  const payments = Array.isArray(recentPayments) ? recentPayments.filter((p) => p?.date) : [];
  if (!payments.length) return null;

  const threshold =
    rentDollars != null && Number.isFinite(rentDollars)
      ? Math.max(rentDollars * 0.2, 500)
      : 500;

  const sorted = [...payments].sort(
    (a, b) => leaseholdDateMs(b.date) - leaseholdDateMs(a.date)
  );

  return (
    sorted.find(
      (p) => p.amount_dollars != null && Number(p.amount_dollars) >= threshold
    ) ?? sorted[0]
  );
}

/**
 * Emits financial snapshot facts only. `unit_label` is a join key to Propera
 * `unit_catalog_id` — never used to mutate unit layout (beds/baths/floor/notes).
 */
export function toProperaFinancialFacts({
  property,
  unitMaster,
  transactionSummary,
  depositsByUnit = new Map(),
  syncedAt = new Date().toISOString(),
  mirrorRoot,
}) {
  const facts = [];

  for (const unit of unitMaster.units) {
    const tx = transactionSummary.get(unit.unit_label);
    const lastPayment =
      pickDisplayLastPayment(tx?.recent_payments, unit.rent_dollars) ??
      tx?.last_payment ??
      null;
    const lastRecord = tx?.last_record ?? null;

    const postedNormalized = (tx?.recent_posted ?? [])
      .map((record, posted_sequence) => {
        const row = normalizePostedTransaction(record);
        return row ? { ...row, posted_sequence } : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.posted_sequence ?? 0) - (b.posted_sequence ?? 0);
      });
    const lastPostedBalance = postedNormalized.length
      ? postedNormalized[postedNormalized.length - 1].balance_after_cents
      : null;

    const balanceFromHistory =
      lastRecord?.balance_after_dollars ??
      tx?.last_balance_after_dollars ??
      null;
    const balanceDollars =
      balanceFromHistory != null && Number.isFinite(balanceFromHistory)
        ? balanceFromHistory
        : unit.balance_due_dollars;
    const balanceCents =
      lastPostedBalance != null
        ? lastPostedBalance
        : parseMoneyToCents(balanceDollars);
    const rentCents = parseMoneyToCents(unit.rent_dollars);
    const ancillary = extractAncillaryCharges(
      tx?.recent_posted ?? [],
      unit.recurring_charges ?? []
    );
    const deposits = depositsByUnit.get(unit.unit_label) ?? null;
    const securityDepositCents = parseMoneyToCents(deposits?.security_deposit_dollars);
    const otherDepositLiteralCents = parseMoneyToCents(
      deposits?.other_deposit_literal_dollars ?? deposits?.other_deposit_dollars
    );
    const leaseholdOtherTotalCents = parseMoneyToCents(
      deposits?.leasehold_other_deposit_total_dollars
    );
    const leaseholdSecurityCents = parseMoneyToCents(deposits?.leasehold_security_dollars);
    const leaseholdOtherCents = parseMoneyToCents(deposits?.leasehold_other_dollars);
    const leaseholdDepositTotalCents = parseMoneyToCents(
      deposits?.leasehold_deposit_total_dollars
    );
    const leaseholdGrandTotalCents = parseMoneyToCents(
      deposits?.leasehold_total_dollars ?? deposits?.leasehold_grand_total_dollars
    );
    const depositComponentSumCents = parseMoneyToCents(
      deposits?.deposit_component_sum_dollars
    );
    const ancillaryDepositCents = parseMoneyToCents(deposits?.ancillary_deposit_dollars);
    const otherDepositCents = parseMoneyToCents(deposits?.propera_other_deposit_dollars);
    const keyDepositCents = parseMoneyToCents(deposits?.key_deposit_dollars);
    const petDepositCents = parseMoneyToCents(deposits?.pet_deposit_dollars);
    const depositHistory = Array.isArray(deposits?.deposit_history)
      ? deposits.deposit_history.map((row) => ({
          date: parseLeaseholdDate(row?.date),
          label: String(row?.label ?? "").trim() || null,
          category: String(row?.category ?? "").trim() || null,
          amount_cents: parseMoneyToCents(row?.amount_dollars),
          source: row?.source ?? null,
        }))
      : [];

    facts.push({
      source_system: "leasehold",
      propera_property_code: property.propera_property_code,
      leasehold_ra_group: property.leasehold_ra_group,
      unit_label: unit.unit_label,
      tenant_name: unit.tenant_name,
      rent_cents: rentCents,
      security_deposit_cents: securityDepositCents,
      other_deposit_cents: otherDepositCents,
      key_deposit_cents: keyDepositCents,
      pet_deposit_cents: petDepositCents,
      balance_cents: balanceCents,
      balance_status: balanceStatus(balanceCents),
      lease_start: parseLeaseholdDate(unit.lease_start),
      lease_end: parseLeaseholdDate(unit.lease_end),
      last_payment_at: parseLeaseholdDate(lastPayment?.date),
      last_payment_cents: parseMoneyToCents(lastPayment?.amount_dollars),
      synced_at: syncedAt,
      mirror_root: mirrorRoot,
      payload: {
        phones: unit.phones,
        balance_from_unit_master_dollars: unit.balance_due_dollars,
        balance_from_last_transaction_dollars: balanceFromHistory,
        last_transaction_kind: lastRecord?.kind ?? null,
        last_transaction_date: parseLeaseholdDate(lastRecord?.date),
        recent_payment_count: tx?.recent_payments?.length ?? 0,
        posted_transactions: postedNormalized,
        ancillary_charges: ancillary.ancillary_charges,
        monthly_billing_extras_cents: ancillary.monthly_billing_extras_cents,
        monthly_billing_rent_cents: ancillary.monthly_billing_rent_cents,
        monthly_billing_at: ancillary.monthly_billing_at,
        deposits: deposits
          ? {
              security_deposit_cents: securityDepositCents,
              other_deposit_cents: otherDepositCents,
              other_deposit_literal_cents: otherDepositLiteralCents,
              key_deposit_cents: keyDepositCents,
              pet_deposit_cents: petDepositCents,
              ancillary_deposit_cents: ancillaryDepositCents,
              leasehold_other_deposit_total_cents: leaseholdOtherTotalCents,
              leasehold_security_cents: leaseholdSecurityCents,
              leasehold_other_cents: leaseholdOtherCents,
              leasehold_deposit_total_cents: leaseholdDepositTotalCents,
              leasehold_grand_total_cents: leaseholdGrandTotalCents,
              deposit_component_sum_cents: depositComponentSumCents,
              deposit_history: depositHistory,
              source: deposits.source ?? null,
            }
          : null,
      },
    });
  }

  return facts;
}
