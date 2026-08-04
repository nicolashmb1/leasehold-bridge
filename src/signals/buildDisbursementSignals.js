/**
 * Turn Leasehold's cheques into Propera disbursement signals.
 *
 * Doctrine: Leasehold is a staff member. This does not insert anything — it
 * produces the same signal a person recording a cheque in Propera would, and
 * `postPropertyDisbursement` handles both identically.
 *
 * A cheque appears in the GL as a credit to cash (`1000`) with ref `APE####`,
 * plus one or more records sharing that ref on other accounts. **Those
 * counterpart records are the destination** — never the payee text. Verified on
 * MORRIS 2026: the same payee appears under seven different category labels,
 * and 31% of outgoing money never reaches an expense account at all.
 *
 * Voids are `VCE####` — a debit back to cash against the same cheque number.
 * Material: three on MORRIS in 2026 returned 108,932.11.
 *
 * @see ../../docs/LH_GL_FILE_FORMAT.md 4
 * @see ../../../propera-v2/docs/PROPERA_FINANCE_PROPERTY_CASH.md 7.2
 */

import { groupTransactions, refFamily } from "../parsers/parseGlYearFile.js";

/** Leasehold's operating cash account. Property-specific by code, but 1000 across Grand. */
const CASH_ACCOUNT = "1000";

const CHEQUE = "APE";
const VOID = "VCE";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function toCents(dollars) {
  return Math.round((Number(dollars) || 0) * 100);
}

/**
 * Split a description into payee and the category label Leasehold appends.
 * The label is **discarded** — it is only kept for diagnostics, because the
 * counterpart account is authoritative. `GRAND MANAGEMENT GROUP Mgmt Fee`.
 */
export function splitDescription(description) {
  const s = String(description || "").trim();
  return { payee_name: s, raw: s };
}

/**
 * The channel-agnostic envelope. Mirrors `propera-v2/src/brain/financial/
 * disbursementSignal.js` — the brain validates this shape and decides what it
 * means; the bridge only reports what Leasehold did.
 *
 * The idempotency key is built from domain facts, not from a Leasehold row id,
 * so re-reading the same year file on a later sync produces the same key.
 */
function envelope(kind, propertyCode, date, amountCents, reference, body) {
  const ref = String(reference || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  const kindShort = kind === "disbursement_voided" ? "disb_void" : "disb";
  return {
    schema_version: 1,
    kind,
    source_channel: "leasehold_import",
    property_code: propertyCode,
    idempotency_key: `leasehold:${propertyCode.toUpperCase()}:${date}:${kindShort}:${Math.abs(amountCents)}:${ref ? `ref${ref}` : "ref0"}`,
    effective_at: new Date(`${date}T12:00:00.000Z`).toISOString(),
    body: { effective_date: date, amount_cents: amountCents, ...body },
  };
}

/**
 * @param {Array} records parsed GL records for one property-year
 * @param {{ propertyCode: string, cashAccount?: string }} opts
 */
export function buildDisbursementSignals(records, opts) {
  const propertyCode = String(opts?.propertyCode || "").trim();
  const cashAccount = String(opts?.cashAccount || CASH_ACCOUNT);

  const signals = [];
  const problems = [];

  for (const tx of groupTransactions(records)) {
    const { family, sequence } = refFamily(tx.ref);
    if (family !== CHEQUE && family !== VOID) continue;

    const cashLines = tx.lines.filter((l) => l.account_code === cashAccount);
    if (!cashLines.length) continue;

    const isVoid = family === VOID;
    // A cheque credits cash; a void debits it back.
    const amountDollars = isVoid
      ? cashLines.reduce((s, l) => s + l.debit_dollars, 0)
      : cashLines.reduce((s, l) => s + l.credit_dollars, 0);
    const amountCents = toCents(amountDollars);
    if (amountCents <= 0) continue;

    const counterparts = tx.lines.filter((l) => l.account_code !== cashAccount);
    const { payee_name } = splitDescription(cashLines[0].description);

    if (isVoid) {
      signals.push(
        envelope("disbursement_voided", propertyCode, tx.date, amountCents, `${CHEQUE}${sequence}`, {
          payee_name,
          reference: `${CHEQUE}${sequence}`,
          reason: payee_name || `voided in Leasehold (${tx.ref})`,
          allocations: [],
        })
      );
      continue;
    }

    if (!counterparts.length) {
      // Cash moved with no destination in the file. Never guess — a misfiled
      // cheque is worse than a reported one.
      problems.push({
        ref: tx.ref,
        date: tx.date,
        amount_cents: amountCents,
        problem: "no_counterpart_line",
      });
      continue;
    }

    // Where Leasehold filed the money. Reported as the source system's own
    // codes — a fact about Leasehold, not an instruction. Propera maps them.
    const allocations = counterparts.map((l) => ({
      external_account_code: l.account_code,
      amount_cents: toCents(l.debit_dollars - l.credit_dollars),
      memo: l.description || payee_name,
    }));

    const allocTotal = allocations.reduce((s, a) => s + a.amount_cents, 0);
    if (allocTotal !== amountCents) {
      problems.push({
        ref: tx.ref,
        date: tx.date,
        amount_cents: amountCents,
        allocations_total_cents: allocTotal,
        problem: "counterpart_total_mismatch",
      });
      continue;
    }

    // The counterpart line carries the clean payee; the cash line's description
    // has Leasehold's category label glued on ("SAMUEL ENGEL Checking 5").
    const cleanPayee = counterparts[0]?.description?.trim() || payee_name;

    signals.push(
      envelope("disbursement_sent", propertyCode, tx.date, amountCents, tx.ref, {
        payee_name: cleanPayee,
        payment_method: "check",
        check_number: String(sequence ?? ""),
        reference: tx.ref,
        memo: payee_name,
        allocations,
      })
    );
  }

  return {
    property_code: propertyCode,
    signal_count: signals.length,
    total_cents: signals
      .filter((s) => s.kind === "disbursement_sent")
      .reduce((sum, s) => sum + s.body.amount_cents, 0),
    void_count: signals.filter((s) => s.kind === "disbursement_voided").length,
    signals,
    problems,
  };
}

export { CASH_ACCOUNT, round2, toCents };
