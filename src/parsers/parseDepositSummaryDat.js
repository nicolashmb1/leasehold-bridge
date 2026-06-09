const RECORD_START_RE = /(?=\d{3}\s+\d{2}\/\d{2}\/\d{4})/;

/**
 * Parses RA####S.Dat — concatenated per-unit deposit ledger lines.
 * Records are not newline-separated; split on unit + date, then read label + trailing amount.
 */
export function parseDepositSummaryDat(buffer) {
  const text = buffer.toString("ascii");
  const byUnit = new Map();
  const parts = text.split(RECORD_START_RE).filter(Boolean);

  for (const part of parts) {
    const head = part.match(/^(\d{3})\s+(\d{2}\/\d{2}\/\d{4})(.*)$/s);
    if (!head) continue;

    const unitLabel = head[1];
    const date = head[2];
    const rest = String(head[3] ?? "").trim();
    if (!rest) continue;

    // Malformed: date runs into amount with no label (e.g. 101 04/05/2015130 30).
    const compact = rest.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/);
    if (compact) {
      pushLine(byUnit, unitLabel, {
        date,
        label: "SECURITY",
        amount_dollars: Number.parseFloat(compact[1]),
      });
      continue;
    }

    const tail = rest.match(/^(.+?)\s+([\d.\-]+)\s*$/);
    if (!tail) continue;

    const label = tail[1].trim();
    const amountDollars = Number.parseFloat(tail[2]);
    pushLine(byUnit, unitLabel, { date, label, amount_dollars: amountDollars });
  }

  return {
    byUnit,
    line_count: [...byUnit.values()].reduce((n, rows) => n + rows.length, 0),
  };
}

function pushLine(byUnit, unitLabel, line) {
  const amountDollars = Number(line.amount_dollars);
  if (!Number.isFinite(amountDollars) || amountDollars === 0) return;

  const rows = byUnit.get(unitLabel) ?? [];
  rows.push(line);
  byUnit.set(unitLabel, rows);
}
