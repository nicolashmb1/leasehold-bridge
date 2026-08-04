/**
 * `A<prefix>GL.Y##` — Leasehold's general ledger year file.
 *
 * 112-byte fixed-width records, no header. Each transaction is written as two
 * or more records sharing a date and a transaction ref, one per account — so
 * double entry is explicit in the file and does not have to be inferred.
 *
 * This is the **permanent** book. Unlike `RA####H.Dat`, which restarts when a
 * tenant moves out, nothing is ever removed here: MORRIS reaches back to 2020,
 * WESTGRAND to 2014. That is why money out is sourced from the GL and not from
 * the AP voucher register — and why it has no data-loss problem.
 *
 * @see ../../docs/LH_GL_FILE_FORMAT.md 2, 4
 */

const RECORD_BYTES = 112;

/** Delphi TDateTime — days since 1899-12-30. */
function delphiDateToIso(serial) {
  if (!Number.isFinite(serial) || serial < 30000 || serial > 60000) return null;
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Delphi Currency — a scaled int64. */
function currency(int64) {
  return Number(int64) / 10000;
}

export function parseGlRecord(buffer, index) {
  const off = index * RECORD_BYTES;
  const r = buffer.subarray(off, off + RECORD_BYTES);
  const date = delphiDateToIso(r.readDoubleLE(6));
  if (!date) return null;

  return {
    entity: r.toString("latin1", 0, 6).trim(),
    date,
    description: r.toString("latin1", 14, 54).trim(),
    account_code: r.toString("latin1", 54, 58).trim(),
    debit_dollars: currency(r.readBigInt64LE(59)),
    credit_dollars: currency(r.readBigInt64LE(67)),
    ref: r.toString("latin1", 75, 82).trim(),
  };
}

export function parseGlYearFile(buffer) {
  const recordCount = Math.floor(buffer.length / RECORD_BYTES);
  const records = [];
  let skipped = 0;
  for (let i = 0; i < recordCount; i += 1) {
    const rec = parseGlRecord(buffer, i);
    if (rec) records.push(rec);
    else skipped += 1;
  }
  return { record_bytes: RECORD_BYTES, record_count: recordCount, skipped, records };
}

/**
 * The ref family, with its sequence number stripped.
 * `APE3261` -> `APE`, `SRESECU` -> `SRESECU`.
 */
export function refFamily(ref) {
  const s = String(ref || "").trim();
  const m = /^([A-Za-z]+)(\d+)$/.exec(s);
  return m ? { family: m[1].toUpperCase(), sequence: Number(m[2]) } : { family: s.toUpperCase(), sequence: null };
}

/**
 * Group records into transactions by (date, ref). Both sides of a cheque share
 * these, so the counterpart line — which carries the destination account — is
 * found without parsing the payee text.
 */
export function groupTransactions(records) {
  const byKey = new Map();
  for (const rec of records) {
    const key = `${rec.date}|${rec.ref}`;
    const entry = byKey.get(key) || { date: rec.date, ref: rec.ref, lines: [] };
    entry.lines.push(rec);
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

export { RECORD_BYTES, delphiDateToIso };
