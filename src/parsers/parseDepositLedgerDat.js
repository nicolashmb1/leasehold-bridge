const RECORD_BYTES = 171;

function readAscii(buffer, start, end) {
  return buffer.subarray(start, end).toString("ascii");
}

function parseDate(record) {
  const match = record.match(/\d{2}\/\d{2}\/\d{4}/);
  return match?.[0] ?? null;
}

function parseLabel(record, date) {
  if (!date) return null;
  const start = record.indexOf(date) + date.length;
  return record.slice(start, start + 18).trim();
}

function readTrailingAmount(record) {
  const parts = record.trimEnd().split(/\s+/);
  const tail = parts[parts.length - 1];
  const n = Number.parseFloat(tail);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isDepositBalanceRecord(record) {
  return /(?:0\.00\s+){3,}/.test(record);
}

const DEPOSIT_LABEL_RE =
  /^(?:RENT SECURITY|OTHER DEPOSIT|KEY DEPOSIT|KEY DEP(?:\s+ADJ)?|KEY$|\d+(?:ST|ND|RD)\s+KEY FOB|KEY FOB|ADDL.*KEY|PET DEPOSIT|SECURITY(?:\s+\d{1,3})?|SECURITY DEP(?:OSIT)?|SECURITY-)/i;

function isDepositReportLabel(label) {
  if (!label) return false;
  if (DEPOSIT_LABEL_RE.test(label)) return true;
  if (/PET/i.test(label)) return true;
  if (/REMOTE/i.test(label)) return true;
  return false;
}

/**
 * Parses RA####R.Dat fixed-width deposit report (171 bytes/record).
 * Deposit-category rows use a 0.00 column grid; trailing amount is balance on file.
 */
export function parseDepositLedgerDat(buffer) {
  const byUnit = new Map();

  for (let offset = 0; offset + RECORD_BYTES <= buffer.length; offset += RECORD_BYTES) {
    const record = readAscii(buffer, offset, offset + RECORD_BYTES);
    const unitLabel = record.slice(0, 3).trim();
    if (!/^\d{3}$/.test(unitLabel)) continue;

    const date = parseDate(record);
    const label = parseLabel(record, date);
    if (!isDepositReportLabel(label)) continue;
    if (!isDepositBalanceRecord(record)) continue;

    const balanceDollars = readTrailingAmount(record);
    if (balanceDollars == null) continue;

    const rows = byUnit.get(unitLabel) ?? [];
    rows.push({
      date,
      label,
      balance_dollars: balanceDollars,
    });
    byUnit.set(unitLabel, rows);
  }

  return { byUnit, record_count: Math.floor(buffer.length / RECORD_BYTES) };
}
