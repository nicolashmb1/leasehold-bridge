/** Mirrors propera-app tenantLedgerMath invariants against bridge export payloads. */

export function accountingPostedChargePaymentCols(tx) {
  let chargeCol = 0;
  let paymentCol = 0;

  if (tx.kind === "adjustment" && tx.amount_cents != null && tx.amount_cents !== 0) {
    if (tx.amount_cents < 0) paymentCol = Math.abs(tx.amount_cents);
    else chargeCol = tx.amount_cents;
    return { chargeCol, paymentCol };
  }

  const amount = tx.amount_cents != null ? Math.max(0, tx.amount_cents) : 0;
  if (tx.kind === "payment") paymentCol = amount;
  else if (tx.kind === "billing" || tx.kind === "late_fee" || tx.kind === "charge") chargeCol = amount;
  else if (amount > 0) chargeCol = amount;

  return { chargeCol, paymentCol };
}

function ledgerRows(posted) {
  return posted.filter((tx) => tx.amount_cents != null && tx.amount_cents !== 0);
}

/** Count rows where stamped prior + delta != stamped after (true parser drift). */
export function countPerRowStampMismatches(posted) {
  const rows = ledgerRows(posted);
  let mismatches = 0;
  let running = null;

  for (const tx of rows) {
    const { chargeCol, paymentCol } = accountingPostedChargePaymentCols(tx);
    const delta = chargeCol - paymentCol;

    if (tx.prior_balance_cents != null && tx.balance_after_cents != null) {
      const expected = tx.prior_balance_cents + delta;
      if (expected !== tx.balance_after_cents) mismatches += 1;
      running = tx.balance_after_cents;
      continue;
    }

    if (running == null) {
      if (tx.prior_balance_cents != null) running = tx.prior_balance_cents;
      else if (tx.balance_after_cents != null) running = tx.balance_after_cents - delta;
      else running = 0;
    }

    running += delta;
    if (tx.balance_after_cents != null) {
      if (running !== tx.balance_after_cents) mismatches += 1;
      running = tx.balance_after_cents;
    }
  }

  return mismatches;
}

/** Opening for display: anchor on first row prior when the window includes it. */
export function deriveLedgerOpeningBalance(posted) {
  const rows = ledgerRows(posted);
  if (!rows.length) return 0;

  const firstPrior = rows[0]?.prior_balance_cents;
  if (firstPrior != null) return firstPrior;

  let totalDelta = 0;
  let lastImportStamp = null;

  for (const tx of rows) {
    const { chargeCol, paymentCol } = accountingPostedChargePaymentCols(tx);
    totalDelta += chargeCol - paymentCol;
    if (tx.balance_after_cents != null) lastImportStamp = tx.balance_after_cents;
  }

  if (lastImportStamp != null) return lastImportStamp - totalDelta;

  for (const tx of rows) {
    if (tx.balance_after_cents == null) continue;
    const { chargeCol, paymentCol } = accountingPostedChargePaymentCols(tx);
    return tx.balance_after_cents - chargeCol + paymentCol;
  }

  return 0;
}

export function validateUnitLedgerMath(posted, snapshotBalanceCents = null) {
  const rows = ledgerRows(posted);
  if (!rows.length) {
    return {
      ok: true,
      rowCount: 0,
      adjacencyFails: 0,
      finalOk: snapshotBalanceCents == null || snapshotBalanceCents === 0,
      stampMismatches: 0,
    };
  }

  const stampMismatches = countPerRowStampMismatches(posted);
  let running = deriveLedgerOpeningBalance(posted);
  let adjacencyFails = 0;
  let prev = running;

  for (const tx of rows) {
    if (tx.prior_balance_cents != null) running = tx.prior_balance_cents;
    const { chargeCol, paymentCol } = accountingPostedChargePaymentCols(tx);
    running += chargeCol - paymentCol;
    if (running - prev !== chargeCol - paymentCol && tx.prior_balance_cents == null) adjacencyFails += 1;
    prev = running;
  }

  const lastStamp = [...rows].reverse().find((tx) => tx.balance_after_cents != null)?.balance_after_cents ?? null;
  const finalOk =
    lastStamp != null
      ? running === lastStamp
      : snapshotBalanceCents == null || running === snapshotBalanceCents;

  return {
    ok: adjacencyFails === 0 && finalOk,
    rowCount: rows.length,
    adjacencyFails,
    finalOk,
    stampMismatches,
    finalCents: running,
    snapshotBalanceCents,
    snapshotMatchesFinal:
      snapshotBalanceCents == null ? true : running === snapshotBalanceCents,
  };
}
