/**
 * Recurring non-rent amounts live in unit master segment 1 (RA####.DAT).
 * Validated against Penn 412: $125 parking + $68.50 water + $45 pet = billing extras.
 *
 * Operator rules:
 * - Water: variable, usually has cents (e.g. 68.50, 86.23)
 * - Pet: round, typically $45–$50
 * - Parking: round, typically $75–$150 (also $30–$125 for extra/temp spots)
 */

function readAscii(buffer, start, end) {
  return buffer.subarray(start, end).toString("ascii");
}

/** Late-fee template amount repeated on many units — not a recurring rent charge. */
const LATE_FEE_TEMPLATE_DOLLARS = 75;

/** Rent security on file — last dollar amount in unit master segment 1. */
export function parseRentSecurityFromSegment1(segment1) {
  const text = readAscii(segment1, 0, segment1.length);
  const matches = text.match(/-?\d+\.\d+/g);
  if (!matches?.length) return null;
  const n = Number.parseFloat(matches[matches.length - 1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseRecurringSlotAmounts(segment1) {
  const text = readAscii(segment1, 0, segment1.length);
  const amounts = [...text.matchAll(/(\d+\.\d{2})/g)]
    .map((m) => Number.parseFloat(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!amounts.length) return [];

  const dropTrailingLateFee =
    amounts.length > 1 && amounts[amounts.length - 1] === LATE_FEE_TEMPLATE_DOLLARS;
  return dropTrailingLateFee ? amounts.slice(0, -1) : amounts;
}

export function classifyRecurringSlotDollars(dollars) {
  if (!Number.isFinite(dollars) || dollars <= 0) return null;

  const cents = Math.round(Math.round(dollars * 100) % 100);
  if (cents !== 0) return "water";

  // Pet — round, ~$40–$65 (validated: $45 on Penn 412)
  if (dollars >= 40 && dollars <= 65) return "pet";

  // Parking — round dollars; common $75–$150, also $30–$39 and $66–$200 (e.g. $125, $100, $50)
  if (dollars >= 75 && dollars <= 200) return "parking";
  if (dollars >= 30 && dollars < 40) return "parking";
  if (dollars >= 66 && dollars < 75) return "parking";

  if (dollars >= 15 && dollars < 40) return "other_monthly";

  return "other_monthly";
}

const SLOT_LABELS = {
  water: "Water",
  parking: "Parking",
  pet: "Pet fee (monthly)",
  other_monthly: "Other monthly",
};

export function buildRecurringChargesFromSegment1(segment1) {
  const amounts = parseRecurringSlotAmounts(segment1);
  const byCategory = new Map();

  for (const dollars of amounts) {
    const category = classifyRecurringSlotDollars(dollars);
    if (!category) continue;
    byCategory.set(category, {
      category,
      label: SLOT_LABELS[category] ?? category,
      amount_dollars: dollars,
    });
  }

  return [...byCategory.values()];
}
