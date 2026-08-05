/**
 * Turn Leasehold's deposit subledger into Propera deposit intents.
 *
 * Source is GL account `2030`. Each row carries the deposit type in its
 * transaction ref — `SRESECU` security, `SREKEY` key, `SREPET` pet — so no
 * description parsing is needed to classify one.
 *
 * ## The tenancy boundary is the whole problem
 *
 * Account `2030` **accumulates across tenancies** and Leasehold never clears
 * it, so a unit that has turned over shows every tenant's deposits added
 * together — PENN unit 318 carries 20,075 across four tenancies when the
 * sitting tenant's deposit is 5,500. Summing the account is always wrong.
 *
 * The owner's rule: current tenants need their whole history; prior
 * occupancies do not matter for backfill. So every row is attributed to a
 * tenancy, and only the current one is emitted.
 *
 * Boundaries are found with the four markers in `docs/LH_GL_FILE_FORMAT.md`
 * §6.5. This module uses the three that live in the GL; the primary one — the
 * ledger-history restart — is passed in by the caller, because it comes from
 * `RA####H.Dat`.
 *
 *   tenancyStart   passed in. Primary, complete, Leasehold's own boundary.
 *   VACANT #nnn    exact where present, ~half of turnovers. Confirms.
 *   refund         a 2030 debit by cheque: the previous tenant leaving.
 *   name change    the surname on the 2030 line changing for a unit.
 *
 * Where they disagree the signal is **not emitted** — it is reported. A wrong
 * boundary attaches a previous tenant's money to the current one, and that is
 * worse than a gap somebody can see.
 *
 * @see ../../docs/LH_GL_FILE_FORMAT.md 6.5
 * @see ../../../propera-v2/src/brain/financial/postDepositMovement.js
 */

import { refFamily } from "../parsers/parseGlYearFile.js";

const DEPOSIT_ACCOUNT = "2030";

/** Ref prefix -> Propera deposit kind. The ref classifies; the text does not. */
const KIND_BY_REF = {
  SRESECU: "security",
  SRJSECU: "security",
  SRERENT: "security",
  SREKEY: "key",
  SREPET: "pet",
};

function normStr(v) {
  return String(v ?? "").trim();
}

function toCents(dollars) {
  return Math.round((Number(dollars) || 0) * 100);
}

/**
 * Split `SURNAME #UNIT` into its parts. The unit token is what ties a row to a
 * tenancy; the name is what detects a boundary when no VACANT row exists.
 */
export function parseDepositDescription(description) {
  const raw = normStr(description);
  const m = /^(.*?)#\s*([A-Za-z0-9]+)\s*$/.exec(raw);
  if (!m) return { name: raw, unit: null, vacant: /vacant/i.test(raw) };
  const name = normStr(m[1]);
  return {
    name: /vacant/i.test(name) ? "" : name,
    unit: normStr(m[2]),
    vacant: /vacant/i.test(name),
  };
}

export function depositKindFor(ref) {
  const { family } = refFamily(ref);
  return KIND_BY_REF[family] || "other";
}

function envelope(kind, propertyCode, date, amountCents, ref, body) {
  const safeRef = String(ref || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  return {
    schema_version: 1,
    kind,
    source_channel: "leasehold_import",
    property_code: propertyCode,
    idempotency_key: `leasehold:${propertyCode.toUpperCase()}:${date}:dep:${Math.abs(amountCents)}:${safeRef ? `ref${safeRef}` : "ref0"}`,
    effective_at: new Date(`${date}T12:00:00.000Z`).toISOString(),
    body: { effective_date: date, amount_cents: amountCents, ...body },
  };
}

/**
 * @param {Array} records parsed GL records for one property-year set
 * @param {{
 *   propertyCode: string,
 *   tenancyStarts?: Record<string, string>,  unit label -> ISO date
 *   graceDays?: number,
 * }} opts
 */
export function buildDepositSignals(records, opts) {
  const propertyCode = normStr(opts?.propertyCode);
  const tenancyStarts = opts?.tenancyStarts || {};
  const graceDays = Number.isFinite(opts?.graceDays) ? opts.graceDays : 0;

  const signals = [];
  const problems = [];
  const boundaries = {};

  // Every 2030 row, grouped by the unit it names.
  const byUnit = new Map();
  const unattributed = [];
  for (const rec of records) {
    if (rec.account_code !== DEPOSIT_ACCOUNT) continue;
    const { family } = refFamily(rec.ref);
    const parsed = parseDepositDescription(rec.description);
    const row = { ...rec, ...parsed, family };

    // A refund leaves by cheque and names a person, not a unit. It marks a
    // move-out but carries no unit, so it cannot be attributed here.
    if (family === "APE" || family === "VCE" || !parsed.unit) {
      unattributed.push(row);
      continue;
    }
    if (!byUnit.has(parsed.unit)) byUnit.set(parsed.unit, []);
    byUnit.get(parsed.unit).push(row);
  }

  for (const [unit, rows] of byUnit) {
    rows.sort((a, b) => a.date.localeCompare(b.date));

    // Markers found in the GL itself.
    const vacantDates = rows.filter((r) => r.vacant).map((r) => r.date);
    const namedRows = rows.filter((r) => r.name);
    const nameChanges = [];
    for (let i = 1; i < namedRows.length; i += 1) {
      if (namedRows[i].name !== namedRows[i - 1].name) nameChanges.push(namedRows[i].date);
    }

    const declared = normStr(tenancyStarts[unit]) || null;
    const lastVacant = vacantDates.length ? vacantDates[vacantDates.length - 1] : null;
    const lastNameChange = nameChanges.length ? nameChanges[nameChanges.length - 1] : null;

    // The three markers do not carry equal weight, and treating them as if
    // they did blocks real deposits. A ledger restart, a VACANT posting and a
    // refund each mean Leasehold *processed* a turnover. A change of surname
    // means only that a different name was typed — MORRIS unit 319 gained
    // "MATOS DIAZ" on an existing tenancy while the sitting tenant kept being
    // charged, no VACANT, no refund, ledger never restarted. That is a
    // co-tenant or a top-up, not a move-in.
    //
    // So: a name change corroborates, it never vetoes.
    const start = declared || lastVacant || lastNameChange;
    const strong = [declared, lastVacant].filter(Boolean);
    const strongAgree =
      strong.length < 2 ||
      Math.abs(Date.parse(strong[0]) - Date.parse(strong[1])) <= graceDays * 86400000;
    const nameAgrees =
      !lastNameChange ||
      (Boolean(start) &&
        Math.abs(Date.parse(lastNameChange) - Date.parse(start)) <= graceDays * 86400000);

    boundaries[unit] = {
      used: start,
      declared,
      vacant: lastVacant,
      name_change: lastNameChange,
      agrees: strongAgree,
      // Worth a look, but not worth withholding the money over.
      note: !nameAgrees && lastNameChange
        ? `a different name appears on ${lastNameChange} without a turnover — co-tenant or top-up?`
        : "",
    };

    if (!start) {
      problems.push({ unit, problem: "no_tenancy_boundary", rows: rows.length });
      continue;
    }
    if (!strongAgree) {
      // Two markers that each mean a processed turnover, disagreeing. Never
      // guess between them on money.
      problems.push({
        unit,
        problem: "boundary_markers_disagree",
        declared,
        vacant: lastVacant,
      });
      continue;
    }

    const cutoff = new Date(Date.parse(start) - graceDays * 86400000).toISOString().slice(0, 10);
    for (const r of rows) {
      if (r.date < cutoff) continue; // a prior occupancy — not wanted for backfill
      const amountCents = toCents(r.credit_dollars - r.debit_dollars);
      if (amountCents === 0) continue;

      signals.push(
        envelope("deposit_movement", propertyCode, r.date, Math.abs(amountCents), `${r.ref}:${unit}:${r.date}`, {
          unit_label: unit,
          resident_name: r.name || null,
          deposit_kind: depositKindFor(r.ref),
          movement_kind: amountCents > 0 ? "receipt" : "adjustment_decrease",
          movement_reason: r.vacant ? "move_in" : "import",
          reference: r.ref,
          tenancy_start: start,
          memo: r.description,
        })
      );
    }
  }

  return {
    property_code: propertyCode,
    signal_count: signals.length,
    total_cents: signals.reduce((s, x) => s + x.body.amount_cents, 0),
    boundaries,
    signals,
    problems,
    // Refunds and unit-less rows: reported so they are visible, not dropped.
    unattributed: unattributed.map((r) => ({
      date: r.date,
      ref: r.ref,
      description: r.description,
      amount_cents: toCents(r.debit_dollars - r.credit_dollars),
    })),
  };
}

export { DEPOSIT_ACCOUNT, KIND_BY_REF };
