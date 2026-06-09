import { parseLeaseholdDate, parseMoneyToCents } from "../lib/money.js";
import { categoryLabel, classifyLeaseholdCharge } from "./classifyLeaseholdCharge.js";

function leaseholdDateMs(raw) {
  const iso = parseLeaseholdDate(raw);
  if (!iso) return 0;
  const ms = new Date(`${iso}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function latestBilling(recentPosted) {
  const billings = (recentPosted ?? []).filter((r) => r?.kind === "billing" && r?.date);
  if (!billings.length) return null;
  return [...billings].sort((a, b) => leaseholdDateMs(b.date) - leaseholdDateMs(a.date))[0];
}

function pushLine(lines, seen, line) {
  const key = `${line.category}:${line.label}`;
  if (seen.has(key)) return;
  seen.add(key);
  lines.push(line);
}

function applyUnitMasterRecurring(lines, seen, unitRecurring, billingDate, explicitByCategory) {
  if (!Array.isArray(unitRecurring) || !unitRecurring.length) return 0;

  const storagePosted = explicitByCategory?.get("storage");
  let sum = 0;
  for (const row of unitRecurring) {
    const dollars = row.amount_dollars;
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    if (
      row.category === "pet" &&
      storagePosted?.recurring &&
      Math.abs(storagePosted.amount_dollars - dollars) < 0.02
    ) {
      continue;
    }
    sum += dollars;
    pushLine(lines, seen, {
      category: row.category,
      label: row.label,
      amount_cents: parseMoneyToCents(dollars),
      last_posted_at: billingDate,
      recurring: true,
      source: "unit_master_segment1",
    });
  }
  return sum;
}

/**
 * Non-rent charges from Leasehold:
 * - unit master segment 1 slots (water / parking / pet — validated Penn 412)
 * - monthly billing extras field when master slots unavailable
 * - explicit posted lines (WATER, PARKING SPOT, late fees, fines, …)
 */
export function extractAncillaryCharges(recentPosted, unitRecurring = []) {
  const posted = Array.isArray(recentPosted) ? recentPosted : [];
  const lines = [];
  const seen = new Set();

  const billing = latestBilling(posted);
  const extrasDollars =
    billing?.extras_dollars != null && Number.isFinite(billing.extras_dollars)
      ? Math.max(0, billing.extras_dollars)
      : 0;

  const explicitByCategory = new Map();

  for (const record of posted) {
    if (!record || record.kind === "payment" || record.kind === "billing") continue;

    const classified = classifyLeaseholdCharge(record);
    if (!classified) continue;

    const amount =
      record.amount_dollars != null && Number.isFinite(record.amount_dollars)
        ? Math.abs(record.amount_dollars)
        : null;
    if (amount == null || amount <= 0) continue;

    const existing = explicitByCategory.get(classified.category);
    const recordMs = leaseholdDateMs(record.date);
    if (!existing || recordMs >= existing.ms) {
      explicitByCategory.set(classified.category, {
        ms: recordMs,
        amount_dollars: amount,
        label: classified.label,
        recurring: classified.recurring,
        date: parseLeaseholdDate(record.date),
      });
    }
  }

  const billingDate = parseLeaseholdDate(billing?.date);
  const masterSum = applyUnitMasterRecurring(lines, seen, unitRecurring, billingDate, explicitByCategory);

  let categorizedMonthly = masterSum;
  for (const [category, row] of explicitByCategory) {
    if (!row.recurring) continue;
    if (seen.has(`${category}:${row.label || categoryLabel(category)}`)) continue;
    categorizedMonthly += row.amount_dollars;
    pushLine(lines, seen, {
      category,
      label: row.label || categoryLabel(category),
      amount_cents: parseMoneyToCents(row.amount_dollars),
      last_posted_at: row.date,
      recurring: true,
      source: "posted_line",
    });
  }

  if (masterSum <= 0 && extrasDollars > 0.009) {
    const remainder = Math.max(0, extrasDollars - categorizedMonthly);
    if (remainder > 0.009) {
      pushLine(lines, seen, {
        category: "other_monthly",
        label:
          categorizedMonthly > 0
            ? "Other monthly (billing extras)"
            : "Water, parking & other (billing)",
        amount_cents: parseMoneyToCents(remainder),
        last_posted_at: billingDate,
        recurring: true,
        source: "monthly_billing_extras",
      });
    }
  } else if (masterSum > 0 && extrasDollars > 0.009) {
    const remainder = Math.max(0, extrasDollars - masterSum);
    if (remainder > 0.5) {
      pushLine(lines, seen, {
        category: "other_monthly",
        label: "Other monthly (billing extras)",
        amount_cents: parseMoneyToCents(remainder),
        last_posted_at: billingDate,
        recurring: true,
        source: "monthly_billing_extras",
      });
    }
  }

  for (const [category, row] of explicitByCategory) {
    if (row.recurring) continue;
    pushLine(lines, seen, {
      category,
      label: row.label || categoryLabel(category),
      amount_cents: parseMoneyToCents(row.amount_dollars),
      last_posted_at: row.date,
      recurring: false,
      source: "posted_line",
    });
  }

  return {
    ancillary_charges: lines.sort((a, b) => {
      if (a.recurring !== b.recurring) return a.recurring ? -1 : 1;
      return String(a.category).localeCompare(String(b.category));
    }),
    monthly_billing_extras_cents: parseMoneyToCents(extrasDollars),
    monthly_billing_rent_cents: parseMoneyToCents(billing?.rent_dollars ?? billing?.amount_dollars),
    monthly_billing_at: parseLeaseholdDate(billing?.date),
  };
}
