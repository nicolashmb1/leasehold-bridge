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
 * @param {{ propertyCode: string }} opts
 */
export function buildBankDepositBatchSignals(registerBuffer, opts) {
  const propertyCode = String(opts?.propertyCode || "").trim();
  if (!propertyCode || !registerBuffer) {
    return { signals: [], problems: [], meta: { skipped: "no_register" } };
  }

  const parsed = parseDepositRegisterDat(registerBuffer);
  const batches = groupDepositRegisterBatches(parsed.records);
  const signals = [];
  const problems = [];

  for (const batch of batches) {
    if (!batch.batch_number || batch.batch_number <= 0) {
      problems.push({ date: batch.deposit_date, problem: "missing_batch_number" });
      continue;
    }
    if (!batch.deposit_date) {
      problems.push({ batch_number: batch.batch_number, problem: "missing_deposit_date" });
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
      problem_count: problems.length,
    },
  };
}
