/**
 * Parse `A<prefix>D.Dat` — deposit register (money-in / bank slips).
 *
 * 35-byte records: date MM/DD/YYYY (10) + description (17) + Currency amount (8).
 * `End-Batch# N` rows terminate a batch (one physical deposit slip).
 *
 * @see ../docs/LH_GL_FILE_FORMAT.md §6A.2
 */

const RECORD_BYTES = 35;

/** Delphi Currency — scaled int64 (dollars × 10000). */
function currencyDollars(buf, offset) {
  try {
    return Number(buf.readBigInt64LE(offset)) / 10000;
  } catch {
    return 0;
  }
}

function toCents(dollars) {
  return Math.round((Number(dollars) || 0) * 100);
}

function mmddyyyyToIso(raw) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(raw || "").trim());
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Description is `<unit>  <tenant cheque no.>` for rent, or free text / End-Batch#.
 */
export function parseDepositRegisterDescription(description) {
  const s = String(description || "").trim();
  const end = /^End-Batch#\s*(\d+)\s*$/i.exec(s);
  if (end) {
    return { kind: "end_batch", batch_number: Number(end[1]), unit_label: null, cheque_ref: null };
  }
  const unitCheque = /^(\d{3}|STORE\d{1,3})\s+(\S.*)$/i.exec(s);
  if (unitCheque) {
    return {
      kind: "payment",
      batch_number: null,
      unit_label: unitCheque[1].toUpperCase(),
      cheque_ref: unitCheque[2].trim(),
    };
  }
  return { kind: "other", batch_number: null, unit_label: null, cheque_ref: null, raw: s };
}

/**
 * @param {Buffer} buffer
 */
export function parseDepositRegisterDat(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const recordCount = Math.floor(buf.length / RECORD_BYTES);
  const records = [];

  for (let i = 0; i < recordCount; i += 1) {
    const off = i * RECORD_BYTES;
    const dateRaw = buf.toString("latin1", off, off + 10).trim();
    const date = mmddyyyyToIso(dateRaw);
    if (!date) continue;

    const description = buf.toString("latin1", off + 10, off + 27).trim();
    const amountDollars = currencyDollars(buf, off + 27);
    const parsed = parseDepositRegisterDescription(description);

    records.push({
      date,
      description,
      amount_dollars: amountDollars,
      amount_cents: toCents(amountDollars),
      ...parsed,
    });
  }

  return { record_bytes: RECORD_BYTES, record_count: recordCount, records };
}

/**
 * Group money lines into batches terminated by End-Batch# N.
 * @param {ReturnType<typeof parseDepositRegisterDat>['records']} records
 */
export function groupDepositRegisterBatches(records) {
  const batches = [];
  let current = [];

  for (const rec of records || []) {
    if (rec.kind === "end_batch") {
      const members = current.filter((r) => r.amount_cents > 0);
      const totalCents = members.reduce((s, r) => s + r.amount_cents, 0);
      batches.push({
        batch_number: rec.batch_number,
        deposit_date: rec.date,
        members,
        total_cents: totalCents,
      });
      current = [];
      continue;
    }
    current.push(rec);
  }

  return batches;
}

/**
 * 4-byte ASCII + CRLF counter file `A<prefix>BT.DAT`.
 * @param {Buffer} buffer
 */
export function parseBatchCounterDat(buffer) {
  const text = Buffer.isBuffer(buffer)
    ? buffer.toString("ascii")
    : String(buffer || "");
  const m = /(\d+)/.exec(text);
  if (!m) return { last_batch_number: null };
  return { last_batch_number: Number(m[1]) };
}
