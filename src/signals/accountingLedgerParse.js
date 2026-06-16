/** Parse ancillary + posted lines from snapshot payload fragments. */

export function parseAccountingAncillaryCharges(payload) {
  const raw = payload?.ancillary_charges;
  if (!Array.isArray(raw)) return [];

  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const amountRaw = item.amount_cents;
    const amountCents =
      amountRaw == null || amountRaw === ""
        ? null
        : Number.isFinite(Number(amountRaw))
          ? Math.round(Number(amountRaw))
          : null;
    const date = String(item.last_posted_at ?? "").trim().slice(0, 10);
    out.push({
      category: String(item.category ?? "other").trim().toLowerCase() || "other",
      label: String(item.label ?? item.category ?? "Charge").trim() || "Charge",
      amount_cents: amountCents,
      last_posted_at: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      recurring: item.recurring !== false,
    });
  }
  return out;
}

export function parseAccountingPostedTransactions(payload) {
  const raw = payload?.posted_transactions;
  if (!Array.isArray(raw)) return [];

  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const date = String(item.date ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const amountRaw = item.amount_cents;
    const amountCents =
      amountRaw == null || amountRaw === ""
        ? null
        : Number.isFinite(Number(amountRaw))
          ? Math.round(Number(amountRaw))
          : null;
    out.push({
      date,
      kind: String(item.kind ?? "other").trim().toLowerCase() || "other",
      description: String(item.description ?? item.kind ?? "Posted").trim().slice(0, 200) || "Posted",
      amount_cents: amountCents,
    });
  }
  return out;
}
