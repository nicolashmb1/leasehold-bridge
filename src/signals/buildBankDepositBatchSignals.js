/**
 * Turn Leasehold End-Batch# rows into Propera bank_deposit_batch signals.
 *
 * Doctrine: Leasehold is a staff member. This does not insert batches — it
 * describes the slip Leasehold closed; `createDepositBatch` writes Propera truth.
 *
 * @see ../parsers/parseDepositRegisterDat.js
 * @see ../../propera-v2/src/brain/financial/depositBatchSignal.js
 */

import {
  groupDepositRegisterBatches,
  parseDepositRegisterDat,
} from "../parsers/parseDepositRegisterDat.js";

function envelope(propertyCode, batch) {
  const n = Number(batch.batch_number);
  const date = String(batch.deposit_date || "").slice(0, 10);
  const totalCents = Math.round(Number(batch.total_cents) || 0);
  return {
    schema_version: 1,
    kind: "bank_deposit_batch",
    source_channel: "leasehold_import",
    property_code: propertyCode,
    idempotency_key: `leasehold:${propertyCode.toUpperCase()}:bank_batch:${n}`,
    effective_at: new Date(`${date}T12:00:00.000Z`).toISOString(),
    body: {
      batch_number: n,
      deposit_date: date,
      total_cents: totalCents,
      members: (batch.members || [])
        .filter((m) => m.kind === "payment" || (m.unit_label && m.amount_cents > 0))
        .map((m) => ({
          unit_label: m.unit_label || "",
          amount_cents: m.amount_cents,
          effective_date: m.date,
          cheque_ref: m.cheque_ref || "",
        })),
    },
  };
}

/**
 * @param {Buffer|null|undefined} registerBuffer A*D.Dat
 * @param {{ propertyCode: string, sinceDate?: string|null }} opts
 *   sinceDate = YYYY-MM-DD cutover (cash_live_from). Pre-cutover batches omitted —
 *   Propera also enforces this; bridge filter keeps the import payload small.
 */
export function buildBankDepositBatchSignals(registerBuffer, opts) {
  const propertyCode = String(opts?.propertyCode || "").trim();
  if (!propertyCode || !registerBuffer) {
    return { signals: [], problems: [], meta: { skipped: "no_register" } };
  }

  const sinceDate = String(opts?.sinceDate || "").trim().slice(0, 10);
  const sinceOk = /^\d{4}-\d{2}-\d{2}$/.test(sinceDate) ? sinceDate : null;

  const parsed = parseDepositRegisterDat(registerBuffer);
  const batches = groupDepositRegisterBatches(parsed.records);

  // Fail closed: no cutover date → emit nothing (never dump full D.Dat history).
  if (!sinceOk) {
    return {
      signals: [],
      problems: [],
      meta: {
        register_record_count: parsed.record_count,
        batch_count: batches.length,
        signal_count: 0,
        skipped_pre_cutover: batches.length,
        since_date: null,
        skipped: "bank_batch_from_required",
        problem_count: 0,
      },
    };
  }

  const signals = [];
  const problems = [];
  let skippedPreCutover = 0;

  for (const batch of batches) {
    if (!batch.batch_number || batch.batch_number <= 0) {
      problems.push({ date: batch.deposit_date, problem: "missing_batch_number" });
      continue;
    }
    if (!batch.deposit_date) {
      problems.push({ batch_number: batch.batch_number, problem: "missing_deposit_date" });
      continue;
    }
    if (String(batch.deposit_date).slice(0, 10) < sinceOk) {
      skippedPreCutover += 1;
      continue;
    }
    signals.push(envelope(propertyCode, batch));
  }

  return {
    signals,
    problems,
    meta: {
      register_record_count: parsed.record_count,
      batch_count: batches.length,
      signal_count: signals.length,
      skipped_pre_cutover: skippedPreCutover,
      since_date: sinceOk,
      problem_count: problems.length,
    },
  };
}
