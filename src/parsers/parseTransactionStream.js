const RECORD_BYTES = 105;

/** `{prior} {label} {delta} {balance_after}` — NSF, ERROR, KEY/FOB, collection fees, etc. */
function parseKeyedLedgerLine(tail) {
  const m = tail.match(/^\s*([\d.\-]+)\s{2,}(.+?)\s{2,}([\d.\-]+)\s+([\d.\-]+)\s*$/);
  if (!m) return null;

  const prior = Number.parseFloat(m[1]);
  const label = m[2].trim();
  const delta = Number.parseFloat(m[3]);
  const after = Number.parseFloat(m[4]);
  if (!label || !Number.isFinite(delta) || !Number.isFinite(after)) return null;

  const upper = label.toUpperCase();
  const base = {
    prior_balance_dollars: Number.isFinite(prior) ? prior : null,
    balance_after_dollars: after,
    charge_label: label,
    description: label,
  };

  if (upper.startsWith("NSF") && delta >= 0) {
    return { ...base, kind: "other", amount_dollars: Math.abs(delta) };
  }
  if (/\bKEY\b|\bFOB\b|\bFOBS\b/.test(upper)) {
    return { ...base, kind: "other", amount_dollars: Math.abs(delta) };
  }
  if (
    delta > 0 &&
    Number.isFinite(prior) &&
    Math.abs(prior - delta - after) < 0.02
  ) {
    return {
      ...base,
      kind: "payment",
      amount_dollars: delta,
      description: label,
    };
  }
  if (delta < 0) {
    if (Number.isFinite(prior) && Math.abs(prior - delta - after) < 0.02) {
      return { ...base, kind: "adjustment", amount_dollars: Math.abs(delta) };
    }
    return { ...base, kind: "adjustment", amount_dollars: delta };
  }
  return { ...base, kind: "other", amount_dollars: Math.abs(delta) };
}

function parseRecord(buffer, index) {
  const raw = buffer.subarray(index * RECORD_BYTES, (index + 1) * RECORD_BYTES).toString("ascii");
  const unit = raw.slice(0, 10).trim();
  // Fixed 10-char unit field; date is always columns 10–19 (MM/DD/YYYY).
  // Do not require a leading numeric unit for the date match — commercial labels
  // like STORE1 would otherwise lose the date and drop out of history.
  const dateField = raw.slice(10, 20).trim();
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(dateField) ? dateField : null;

  if (!unit || !date) {
    return { unit_label: unit || null, date: null, kind: "unknown", raw };
  }

  const tail = raw.slice(20);

  if (tail.includes("Monthly Billing")) {
    const fourField = tail.match(
      /^([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+Monthly Billing\s+([\d.\-]+)/
    );
    if (fourField) {
      return {
        unit_label: unit,
        date,
        kind: "billing",
        prior_balance_dollars: Number.parseFloat(fourField[1]),
        rent_dollars: Number.parseFloat(fourField[2]),
        extras_dollars: Number.parseFloat(fourField[3]),
        amount_dollars: Number.parseFloat(fourField[2]),
        balance_after_dollars: Number.parseFloat(fourField[4]),
        description: "Monthly Billing",
        raw,
      };
    }
    const legacy = tail.match(/([\d.]+)\s+([\d.\-]+)\s+Monthly Billing\s+([\d.\-]+)/);
    return {
      unit_label: unit,
      date,
      kind: "billing",
      amount_dollars: legacy ? Number.parseFloat(legacy[1]) : null,
      prior_balance_dollars: legacy ? Number.parseFloat(legacy[2]) : null,
      balance_after_dollars: legacy ? Number.parseFloat(legacy[3]) : null,
      description: "Monthly Billing",
      raw,
    };
  }

  if (tail.includes("CK")) {
    const m = tail.match(/([\d.\-]+)\s+CK\s+([\d.\-]+)\s+([\d.\-]+)/);
    return {
      unit_label: unit,
      date,
      kind: "payment",
      amount_dollars: m ? Number.parseFloat(m[2]) : null,
      balance_after_dollars: m ? Number.parseFloat(m[3]) : null,
      description: "CK",
      raw,
    };
  }

  if (tail.includes("LATE FEE")) {
    const m = tail.match(/([\d.\-]+)\s+LATE FEE\s*(.*?)\s+([\d.\-]+)\s+([\d.\-]+)/);
    const before = m ? Number.parseFloat(m[1]) : null;
    const delta = m ? Number.parseFloat(m[3]) : null;
    const after = m ? Number.parseFloat(m[4]) : null;
    const description = m ? `LATE FEE ${m[2].trim()}`.trim() : "LATE FEE";
    if (
      delta != null &&
      delta < 0 &&
      Number.isFinite(before) &&
      Number.isFinite(after) &&
      Math.abs(before + delta - after) < 0.02
    ) {
      return {
        unit_label: unit,
        date,
        kind: "adjustment",
        prior_balance_dollars: before,
        amount_dollars: delta,
        balance_after_dollars: after,
        description,
        raw,
      };
    }
    return {
      unit_label: unit,
      date,
      kind: "late_fee",
      balance_before_dollars: before,
      prior_balance_dollars: before,
      amount_dollars: delta != null ? Math.abs(delta) : null,
      balance_after_dollars: after,
      description,
      raw,
    };
  }

  const paymentWithCheck = tail.match(/^\s*([\d.\-]+)\s+(\d{1,10})\s+([\d.\-]+)\s+([\d.\-]+)/);
  if (paymentWithCheck) {
    return {
      unit_label: unit,
      date,
      kind: "payment",
      prior_balance_dollars: Number.parseFloat(paymentWithCheck[1]),
      amount_dollars: Number.parseFloat(paymentWithCheck[3]),
      balance_after_dollars: Number.parseFloat(paymentWithCheck[4]),
      reference: paymentWithCheck[2],
      description: "payment",
      raw,
    };
  }

  const keyed = parseKeyedLedgerLine(tail);
  if (keyed) {
    return {
      unit_label: unit,
      date,
      raw,
      ...keyed,
    };
  }

  const otherCharge = tail.match(/^\s*([\d.\-]+)\s+(Other Chg|LATE FEE|WATER|PET|RENT|ADJ)/i);
  if (otherCharge) {
    const label = String(otherCharge[2] ?? "").trim();
    if (label.toUpperCase() === "ADJ") {
      const adjMatch = tail.match(/ADJ\s+([\d.\-]+)\s+([\d.\-]+)\s*$/i);
      if (adjMatch) {
        const prior = Number.parseFloat(otherCharge[1]);
        const delta = Number.parseFloat(adjMatch[1]);
        const after = Number.parseFloat(adjMatch[2]);
        return {
          unit_label: unit,
          date,
          kind: "adjustment",
          prior_balance_dollars: Number.isFinite(prior) ? prior : null,
          amount_dollars: Number.isFinite(delta) ? delta : null,
          balance_after_dollars: Number.isFinite(after) ? after : null,
          charge_label: "ADJ",
          description: "ADJ",
          raw,
        };
      }
    }

    const nums = tail.match(/([\d.\-]+)\s*$/);
    const amount = nums ? Number.parseFloat(nums[1]) : null;
    const labelMatch = tail.match(
      /\s{2,}([A-Za-z][A-Za-z0-9 \/\-\.:']+?)\s+[\d.\-]+\s+[\d.\-]+\s*$/
    );
    return {
      unit_label: unit,
      date,
      kind: "charge",
      amount_dollars: amount,
      charge_label: labelMatch?.[1]?.trim() ?? label,
      description: labelMatch?.[1]?.trim() ?? tail.trim(),
      raw,
    };
  }

  return {
    unit_label: unit,
    date,
    kind: "other",
    description: tail.trim(),
    raw,
  };
}

export function parseTransactionStream(buffer) {
  const recordCount = Math.floor(buffer.length / RECORD_BYTES);
  const records = [];
  for (let i = 0; i < recordCount; i += 1) {
    records.push(parseRecord(buffer, i));
  }
  return {
    record_bytes: RECORD_BYTES,
    record_count: recordCount,
    records,
  };
}

export function summarizeTransactionsByUnit(records) {
  const byUnit = new Map();

  for (const record of records) {
    const unit = String(record.unit_label ?? "").trim();
    // Apartments (101) and commercial masters (STORE1) — keep bounded.
    if (!unit || !/^(\d{3}|STORE\d{1,3})$/i.test(unit)) continue;

    const existing = byUnit.get(unit) || {
      unit_label: unit,
      last_record: null,
      last_balance_after_dollars: null,
      last_payment: null,
      recent_payments: [],
      recent_posted: [],
    };

    existing.last_record = record;

    if (record.balance_after_dollars != null && Number.isFinite(record.balance_after_dollars)) {
      existing.last_balance_after_dollars = record.balance_after_dollars;
    }

    if (record.date) {
      existing.recent_posted.push(record);
      if (existing.recent_posted.length > 80) {
        existing.recent_posted = existing.recent_posted.slice(-80);
      }
    }

    if (record.kind === "payment" && record.amount_dollars != null) {
      existing.last_payment = record;
      existing.recent_payments.push(record);
      if (existing.recent_payments.length > 12) {
        existing.recent_payments = existing.recent_payments.slice(-12);
      }
    }

    byUnit.set(unit, existing);
  }

  for (const existing of byUnit.values()) {
    const last = existing.last_record;
    if (!last?.date) continue;
    const alreadyIncluded = existing.recent_posted.some(
      (row) =>
        row.date === last.date &&
        row.kind === last.kind &&
        row.amount_dollars === last.amount_dollars &&
        row.balance_after_dollars === last.balance_after_dollars
    );
    if (!alreadyIncluded) {
      existing.recent_posted.push(last);
      if (existing.recent_posted.length > 81) {
        existing.recent_posted = existing.recent_posted.slice(-81);
      }
    }
  }

  return byUnit;
}
