import { parseRentSecurityFromSegment1 } from "../parsers/parseUnitMasterRecurring.js";

const KEY_LABEL_RE = /^KEY DEPOSIT$|^KEY DEP$/;
const OTHER_DEPOSIT_LABEL = "OTHER DEPOSIT";
const RENT_SECURITY_LABEL = "RENT SECURITY";

function normalizeDepositLabel(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function isKeyDepositLabel(normalized) {
  if (normalized === "KEY") return true;
  if (KEY_LABEL_RE.test(normalized)) return true;
  if (/^KEY DEP ADJ$/i.test(normalized)) return true;
  if (/KEY FOB/i.test(normalized)) return true;
  if (/ADDL.*KEY/i.test(normalized)) return true;
  return false;
}

export function classifyDepositLabel(raw) {
  const normalized = normalizeDepositLabel(raw);
  if (normalized === RENT_SECURITY_LABEL) return "rent_security";
  if (normalized === OTHER_DEPOSIT_LABEL) return "other_deposit";
  if (isKeyDepositLabel(normalized)) return "key_deposit";
  if (normalized.includes("PET")) return "pet_deposit";
  if (/REMOTE/i.test(normalized)) return "ancillary";
  if (/CREDIT/i.test(normalized) && /REM/i.test(normalized)) return "ancillary";
  if (isSecurityTopUpLabel(normalized)) return "rent_security";
  return null;
}

function isSecurityTopUpLabel(label) {
  const normalized = normalizeDepositLabel(label);
  if (normalized === RENT_SECURITY_LABEL || normalized === OTHER_DEPOSIT_LABEL) return false;
  if (isKeyDepositLabel(normalized)) return false;
  if (normalized.includes("PET")) return false;
  if (/REMOTE/i.test(normalized)) return false;
  if (normalized.startsWith("SECURITY-")) return true;
  if (/^SECURITY(?:\s+\d{1,3})?$/.test(normalized)) return true;
  if (normalized === "SECURITY DEP" || normalized === "SECURITY DEPOSIT") return true;
  return normalized === "SECURITY";
}

function parseLeaseholdDate(date) {
  const match = String(date ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return 0;
  return Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
}

function sortByDate(lines) {
  return [...lines].sort(
    (a, b) => parseLeaseholdDate(a?.date) - parseLeaseholdDate(b?.date)
  );
}

function readLineAmount(line) {
  const amount = Number(line?.balance_dollars ?? line?.amount_dollars);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function readSignedLineAmount(line) {
  const amount = Number(line?.balance_dollars ?? line?.amount_dollars);
  return Number.isFinite(amount) && amount !== 0 ? amount : null;
}

function moneyClose(a, b, epsilon = 0.02) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}

function roundMoney(dollars) {
  if (dollars == null || !Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100) / 100;
}

/** Small SECURITY DEPOSIT rows are rent-increase top-ups, not turnover openings. */
const SECURITY_OPENING_MIN_DOLLARS = 500;

function isSecurityOpeningLabel(label, amount = null) {
  const normalized = normalizeDepositLabel(label);
  if (normalized === RENT_SECURITY_LABEL || normalized === "SECURITY DEP") return true;
  if (normalized === "SECURITY DEPOSIT") {
    return amount == null || amount >= SECURITY_OPENING_MIN_DOLLARS;
  }
  return false;
}

/** Rent-increase increments — not opening resets (SECURITY DEP / Rent Security). */
function isSecurityIncrementLabel(label, amount = null) {
  const normalized = normalizeDepositLabel(label);
  if (normalized === "SECURITY DEPOSIT" && amount != null && amount < SECURITY_OPENING_MIN_DOLLARS) {
    return true;
  }
  if (isSecurityOpeningLabel(label, amount)) return false;
  if (normalized === OTHER_DEPOSIT_LABEL) return false;
  if (isKeyDepositLabel(normalized)) return false;
  if (normalized.includes("PET")) return false;
  if (/REMOTE/i.test(normalized)) return false;
  if (/CREDIT/i.test(normalized) && /REM/i.test(normalized)) return false;
  if (normalized.startsWith("SECURITY-")) return true;
  if (/^SECURITY(?:\s+\d{1,3})?$/.test(normalized)) return true;
  return normalized === "SECURITY";
}

function latestOpeningFromLines(lines) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const sorted = sortByDate(
    lines.filter((line) => {
      const amount = readLineAmount(line);
      return isSecurityOpeningLabel(line?.label, amount);
    })
  );
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const amount = readLineAmount(sorted[i]);
    if (amount != null) return amount;
  }
  return null;
}

function latestSecurityOpeningBalance(ledgerLines, summaryLines) {
  return latestOpeningFromLines(ledgerLines) ?? latestOpeningFromLines(summaryLines);
}

/**
 * Turnover anchor — RENT SECURITY / SECURITY DEP / large SECURITY DEPOSIT, plus very
 * large plain SECURITY (e.g. Westfield 202 @ $3,885). Mid-size SECURITY rows (e.g. $603
 * rent bumps on unit 404) are increments, not turnover.
 */
/** Plain SECURITY turnover (e.g. Westfield 202 @ $3,885). $2,099-style rows are rent bumps. */
const SECURITY_TURNOVER_PLAIN_MIN_DOLLARS = 3000;
/** KEY + SECURITY same-day turnover (e.g. Murray 504 @ $1,392.50); excludes KEY FOB + $67.50 rent bump. */
const SECURITY_KEY_TURNOVER_CLUSTER_MIN_DOLLARS = 1000;

function isSecurityTurnoverLine(label, amount = null) {
  if (isSecurityOpeningLabel(label, amount)) return true;
  const normalized = normalizeDepositLabel(label);
  return (
    normalized === "SECURITY" &&
    amount != null &&
    amount >= SECURITY_TURNOVER_PLAIN_MIN_DOLLARS
  );
}

/** Same-day SECURITY cluster (e.g. 2849.50 + 1000 on turnover day). */
function securityClusterSumByDate(lines) {
  const byDate = new Map();
  if (!Array.isArray(lines)) return byDate;
  for (const line of lines) {
    const normalized = normalizeDepositLabel(line?.label);
    const amount = readLineAmount(line);
    if (amount == null) continue;
    if (
      normalized !== "SECURITY" &&
      !isSecurityOpeningLabel(line?.label, amount) &&
      !isSecurityTurnoverLine(line?.label, amount)
    ) {
      continue;
    }
    const lineDate = parseLeaseholdDate(line.date);
    if (!lineDate) continue;
    byDate.set(lineDate, (byDate.get(lineDate) ?? 0) + amount);
  }
  return byDate;
}

function linesOnDate(lines, dayMs) {
  if (!Array.isArray(lines)) return [];
  return lines.filter((line) => parseLeaseholdDate(line.date) === dayMs);
}

function daySecurityClusterDollars(dayLines) {
  let sum = 0;
  for (const line of dayLines) {
    const amount = readLineAmount(line);
    if (amount == null) continue;
    const normalized = normalizeDepositLabel(line?.label);
    if (
      normalized === "SECURITY" ||
      isSecurityOpeningLabel(line?.label, amount) ||
      isSecurityTurnoverLine(line?.label, amount)
    ) {
      sum += amount;
    }
  }
  return sum;
}

function dayHasMisPostedTurnoverKey(dayLines) {
  const hasOpening = dayLines.some((line) => isSecurityOpeningSummaryLine(line));
  if (!hasOpening) return false;
  return dayLines.some((line) => {
    if (normalizeDepositLabel(line?.label) !== "SECURITY") return false;
    const amount = readLineAmount(line);
    if (amount == null) return false;
    return (
      amount >= TURNOVER_DAY_KEY_SECURITY_MIN_DOLLARS &&
      amount <= TURNOVER_DAY_KEY_SECURITY_MAX_DOLLARS
    );
  });
}

/**
 * True when a calendar day starts a new deposit era (turnover), not a mid-lease rent bump.
 * Lone plain SECURITY (e.g. Penn 210 @ $11,019) and small SECURITY DEPOSIT top-ups
 * (Penn 220 @ $787.50) must not advance the anchor. Mid-lease KEY FOB / 2nd KEY rows
 * are never turnover anchors — only security-opening days qualify.
 */
function isDepositEraTurnoverDay(summaryLines, ledgerLines, dayMs) {
  const dayLines = [
    ...linesOnDate(summaryLines, dayMs),
    ...linesOnDate(ledgerLines, dayMs),
  ];
  if (!dayLines.length) return false;

  const hasKey = dayLines.some(
    (line) => classifyDepositLabel(line?.label) === "key_deposit"
  );
  const hasRentSecurity = dayLines.some(
    (line) => normalizeDepositLabel(line?.label) === RENT_SECURITY_LABEL
  );
  const hasOtherDeposit = dayLines.some(
    (line) => classifyDepositLabel(line?.label) === "other_deposit"
  );
  const cluster = daySecurityClusterDollars(dayLines);
  const hasSecurityOpening = dayLines.some((line) => {
    const amount = readLineAmount(line);
    return amount != null && isSecurityOpeningLabel(line?.label, amount);
  });

  if (hasRentSecurity) return true;
  if (
    hasKey &&
    (hasSecurityOpening ||
      cluster >= SECURITY_KEY_TURNOVER_CLUSTER_MIN_DOLLARS ||
      hasOtherDeposit)
  ) {
    return true;
  }
  if (hasOtherDeposit && cluster >= SECURITY_TURNOVER_PLAIN_MIN_DOLLARS) return true;
  if (dayHasMisPostedTurnoverKey(dayLines)) return true;
  if (hasSecurityOpening && cluster >= SECURITY_TURNOVER_PLAIN_MIN_DOLLARS) return true;
  return false;
}

/** Latest security turnover date — deposit lines before this are pre-era (stale R.Dat). */
export function latestSecurityTurnoverDate(summaryLines, ledgerLines) {
  const candidateDates = new Set();

  for (const lines of [summaryLines, ledgerLines]) {
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      const lineDate = parseLeaseholdDate(line.date);
      if (!lineDate) continue;
      const amount = readLineAmount(line);
      if (isSecurityTurnoverLine(line?.label, amount)) {
        candidateDates.add(lineDate);
      }
    }
  }

  for (const byDate of [
    securityClusterSumByDate(summaryLines),
    securityClusterSumByDate(ledgerLines),
  ]) {
    for (const lineDate of byDate.keys()) {
      candidateDates.add(lineDate);
    }
  }

  let latest = 0;
  for (const dayMs of candidateDates) {
    if (!isDepositEraTurnoverDay(summaryLines, ledgerLines, dayMs)) continue;
    if (dayMs > latest) latest = dayMs;
  }
  return latest;
}

function isSummaryDepositLine(line) {
  return line?.amount_dollars != null && line?.balance_dollars == null;
}

function hasSummaryCategoryOnOrAfter(summaryLines, category, anchorDate) {
  if (!anchorDate) return false;
  return sortByDate(summaryLines).some((line) => {
    if (classifyDepositLabel(line?.label) !== category) return false;
    const amount =
      category === "ancillary" ? readSignedLineAmount(line) : readLineAmount(line);
    if (amount == null) return false;
    return parseLeaseholdDate(line.date) >= anchorDate;
  });
}

function usesSignedCategoryAmount(category) {
  return category === "ancillary" || category === "key_deposit";
}

function isCurrentNonSecurityLine(line, category, summaryLines, anchorDate) {
  if (classifyDepositLabel(line?.label) !== category) return false;
  const amount = usesSignedCategoryAmount(category)
    ? readSignedLineAmount(line)
    : readLineAmount(line);
  if (amount == null) return false;

  const lineDate = parseLeaseholdDate(line.date);
  if (!anchorDate || lineDate >= anchorDate) return true;

  if (isSummaryDepositLine(line)) return false;

  return hasSummaryCategoryOnOrAfter(summaryLines, category, anchorDate);
}

function filterCurrentCategoryLines(lines, category, summaryLines, anchorDate) {
  if (!Array.isArray(lines) || !lines.length) return [];
  return lines.filter((line) =>
    isCurrentNonSecurityLine(line, category, summaryLines, anchorDate)
  );
}

function sumCurrentCategoryNet(lines, category, summaryLines, anchorDate, signed) {
  let net = 0;
  let hasAny = false;
  for (const line of filterCurrentCategoryLines(lines, category, summaryLines, anchorDate)) {
    const amount = signed ? readSignedLineAmount(line) : readLineAmount(line);
    if (amount == null) continue;
    net += amount;
    hasAny = true;
  }
  return { net: roundMoney(net), hasAny };
}

const KEY_TRANSFER_DEPOSIT_MIN_DOLLARS = 500;
const KEY_TRANSFER_SUPERSEDED_DAYS = 90;
/** Same-day SECURITY after opening — key deposit mis-posted (Murray 503 @ $200). */
const TURNOVER_DAY_KEY_SECURITY_MIN_DOLLARS = 100;
const TURNOVER_DAY_KEY_SECURITY_MAX_DOLLARS = 500;

function hasLaterKeyDepLine(lines, afterDateMs) {
  return lines.some((line) => {
    const normalized = normalizeDepositLabel(line?.label);
    if (normalized !== "KEY DEP") return false;
    const amount = readLineAmount(line);
    if (amount == null) return false;
    return parseLeaseholdDate(line.date) > afterDateMs;
  });
}

function collectCurrentKeyLines(summaryLines, ledgerLines, anchorDate) {
  const fromSummary = filterCurrentCategoryLines(
    summaryLines,
    "key_deposit",
    summaryLines,
    anchorDate
  );
  if (fromSummary.length) return sortByDate(fromSummary);
  return sortByDate(
    filterCurrentCategoryLines(ledgerLines, "key_deposit", summaryLines, anchorDate)
  );
}

function latestKeyOpeningDateMs(summaryLines, ledgerLines, anchorDate) {
  const lines = collectCurrentKeyLines(summaryLines, ledgerLines, anchorDate);
  let latest = 0;
  for (const line of lines) {
    const normalized = normalizeDepositLabel(line?.label);
    if (normalized !== "KEY DEP" && normalized !== "KEY DEPOSIT") continue;
    const amount = readLineAmount(line);
    if (amount == null) continue;
    latest = Math.max(latest, parseLeaseholdDate(line.date));
  }
  return latest;
}

/**
 * Key held = sum of current-era key lines (signed), skipping large KEY DEPOSIT
 * transfer rows superseded by a later KEY DEP (e.g. Westfield 304: 2400 → 200).
 */
function isSecurityOpeningSummaryLine(line) {
  const amount = readLineAmount(line);
  if (amount == null) return false;
  const normalized = normalizeDepositLabel(line?.label);
  return normalized === "SECURITY DEP" || isSecurityOpeningLabel(line?.label, amount);
}

/**
 * Opening day plain SECURITY in key range with no KEY DEP row (Murray 503).
 */
function deriveKeyFromTurnoverDaySecurity(summaryLines) {
  if (!Array.isArray(summaryLines) || !summaryLines.length) return null;

  const byDate = new Map();
  for (const line of summaryLines) {
    const lineDate = parseLeaseholdDate(line.date);
    if (!lineDate) continue;
    const rows = byDate.get(lineDate) ?? [];
    rows.push(line);
    byDate.set(lineDate, rows);
  }

  let latestKeyMs = 0;
  let latestKeyAmount = null;

  for (const [lineDate, rows] of byDate) {
    const hasOpening = rows.some((line) => isSecurityOpeningSummaryLine(line));
    if (!hasOpening) continue;
    const hasExplicitKey = rows.some(
      (line) => classifyDepositLabel(line?.label) === "key_deposit"
    );
    if (hasExplicitKey) continue;

    for (const line of rows) {
      if (normalizeDepositLabel(line?.label) !== "SECURITY") continue;
      const amount = readLineAmount(line);
      if (amount == null) continue;
      if (amount < TURNOVER_DAY_KEY_SECURITY_MIN_DOLLARS) continue;
      if (amount > TURNOVER_DAY_KEY_SECURITY_MAX_DOLLARS) continue;
      if (lineDate >= latestKeyMs) {
        latestKeyMs = lineDate;
        latestKeyAmount = amount;
      }
    }
  }

  return latestKeyAmount != null ? roundMoney(latestKeyAmount) : null;
}

function deriveKeyDepositDollars(summaryLines, ledgerLines, anchorDate) {
  const lines = collectCurrentKeyLines(summaryLines, ledgerLines, anchorDate);

  let total = 0;
  let hasAny = false;
  for (const line of lines) {
    const normalized = normalizeDepositLabel(line?.label);
    const amount = readSignedLineAmount(line);
    if (amount == null) continue;

    if (
      normalized === "KEY DEPOSIT" &&
      amount >= KEY_TRANSFER_DEPOSIT_MIN_DOLLARS &&
      hasLaterKeyDepLine(lines, parseLeaseholdDate(line.date))
    ) {
      continue;
    }

    total += amount;
    hasAny = true;
  }

  if (!hasAny) {
    return deriveKeyFromTurnoverDaySecurity(summaryLines);
  }

  const rounded = roundMoney(total);
  return rounded != null && rounded > 0 ? rounded : null;
}

/** LH screen shows $0/$0 — unit master rent security is explicitly zero. */
function isDepositVacantOnFile(unitMaster) {
  const masterSec = unitMaster?.rent_security_dollars;
  return masterSec != null && masterSec === 0;
}

/** Net pet in current era — S.Dat wins when present. */
function netCurrentCategoryAmount(summaryLines, ledgerLines, category, anchorDate) {
  const signed = category === "ancillary";
  const fromSummary = sumCurrentCategoryNet(
    summaryLines,
    category,
    summaryLines,
    anchorDate,
    signed
  );
  if (fromSummary.hasAny) {
    return fromSummary.net != null && fromSummary.net > 0 ? fromSummary.net : null;
  }

  const fromLedger = sumCurrentCategoryNet(
    ledgerLines,
    category,
    summaryLines,
    anchorDate,
    signed
  );
  if (!fromLedger.hasAny) return null;
  return fromLedger.net != null && fromLedger.net > 0 ? fromLedger.net : null;
}

/** S.Dat rent-increase increments after the latest opening balance. */
function sumSecurityIncrementsFromSummary(summaryLines, openingBalance) {
  let sum = 0;
  for (const line of sortByDate(summaryLines)) {
    const label = normalizeDepositLabel(line?.label);
    const amount = readLineAmount(line);
    if (amount == null) continue;
    if (!isSecurityIncrementLabel(label, amount)) continue;
    if (openingBalance != null && moneyClose(amount, openingBalance)) continue;
    sum += amount;
  }
  return sum;
}

/** Signed S.Dat ADJ rows that adjust rent security (e.g. Westfield 311: -10). */
function sumSecurityAdjustmentsFromSummary(summaryLines) {
  let sum = 0;
  let hasAny = false;
  for (const line of sortByDate(summaryLines)) {
    if (normalizeDepositLabel(line?.label) !== "ADJ") continue;
    const amount = readSignedLineAmount(line);
    if (amount == null) continue;
    sum += amount;
    hasAny = true;
  }
  return hasAny ? sum : 0;
}

/**
 * Rent security from deposit lines: latest opening balance + S.Dat increments.
 */
export function deriveSecurityFromDepositLines(summaryLines, ledgerLines) {
  const opening = latestSecurityOpeningBalance(ledgerLines, summaryLines);
  const increments = sumSecurityIncrementsFromSummary(summaryLines, opening);
  const adjustments = sumSecurityAdjustmentsFromSummary(summaryLines);
  if (opening != null) return roundMoney(opening + increments + adjustments);
  if (increments + adjustments !== 0) return roundMoney(increments + adjustments);

  const fromSummary = deriveDepositsFromSummaryLines(summaryLines);
  if (fromSummary.security_deposit_dollars != null) {
    return roundMoney(fromSummary.security_deposit_dollars);
  }
  return roundMoney(deriveRentSecurityFromLedger(ledgerLines));
}

/**
 * Leasehold:  LH = Security + Other
 * Propera:     Security + Key + Pet + Other
 * Invariant:   LH === Propera (totals must match)
 *
 * LH "Other" is the combined bucket; Propera splits it into Key + Pet + Other.
 */
export function reconcileProperaDepositSplits({
  leaseholdMasterTotalDollars,
  securityFromLinesDollars,
  keyDepositDollars,
  petDepositDollars,
  otherLiteralDollars,
  ancillaryDepositDollars,
}) {
  const key = keyDepositDollars ?? 0;
  const pet = petDepositDollars ?? 0;
  const properaOther = roundMoney((otherLiteralDollars ?? 0) + (ancillaryDepositDollars ?? 0));
  const properaOtherOrNull = properaOther != null && properaOther > 0 ? properaOther : null;

  const master = leaseholdMasterTotalDollars;
  let security = securityFromLinesDollars;
  if (master != null) {
    if (
      securityFromLinesDollars != null &&
      keyDepositDollars != null &&
      moneyClose(master, securityFromLinesDollars + keyDepositDollars)
    ) {
      // Unit master lumped key into the security column (e.g. 202: 3027 = 2877 + 150).
      security = securityFromLinesDollars;
    } else if (
      securityFromLinesDollars != null &&
      moneyClose(master, securityFromLinesDollars, 0.1)
    ) {
      // Deposit lines carry full cent precision; unit master may truncate (e.g. 302/311).
      security = securityFromLinesDollars;
    } else if (
      keyDepositDollars != null &&
      securityFromLinesDollars != null &&
      !moneyClose(master, securityFromLinesDollars + keyDepositDollars) &&
      !moneyClose(master, securityFromLinesDollars)
    ) {
      // Separate LH Security + Other columns — trust master for Security (e.g. 201).
      security = master;
    } else if (keyDepositDollars == null && petDepositDollars == null) {
      // LH Security column only — unit master wins over S/R.Dat over-count (e.g. 101).
      security = master;
    } else if (securityFromLinesDollars == null) {
      security = master;
    }
  }

  const securityOut = security != null && security > 0 ? roundMoney(security) : null;
  const keyOut = keyDepositDollars;
  const petOut = petDepositDollars;

  const lhOther = roundMoney(key + pet + (properaOtherOrNull ?? 0));
  const lhOtherOrNull = lhOther != null && lhOther > 0 ? lhOther : null;
  const lhSecurity = securityOut;

  const lhTotal = roundMoney((lhSecurity ?? 0) + (lhOtherOrNull ?? 0));
  const properaTotal = roundMoney(
    (securityOut ?? 0) + (keyOut ?? 0) + (petOut ?? 0) + (properaOtherOrNull ?? 0)
  );

  return {
    security_deposit_dollars: securityOut,
    key_deposit_dollars: keyOut,
    pet_deposit_dollars: petOut,
    propera_other_deposit_dollars: properaOtherOrNull,
    leasehold_security_dollars: lhSecurity,
    leasehold_other_dollars: lhOtherOrNull,
    leasehold_total_dollars: lhTotal,
    leasehold_deposit_total_dollars: master,
    leasehold_grand_total_dollars: lhTotal,
    deposit_component_sum_dollars: properaTotal,
  };
}

function latestCategoryAmount(lines, category) {
  const sorted = sortByDate(
    lines.filter((line) => classifyDepositLabel(line?.label) === category)
  );
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const amount = readLineAmount(sorted[i]);
    if (amount != null) return amount;
  }
  return null;
}

function latestCategoryLineDate(lines, category) {
  const sorted = sortByDate(
    lines.filter(
      (line) =>
        classifyDepositLabel(line?.label) === category && readLineAmount(line) != null
    )
  );
  if (!sorted.length) return 0;
  return parseLeaseholdDate(sorted[sorted.length - 1].date);
}

/**
 * Literal "Other Deposit" only — never key or pet.
 * S.Dat wins; R.Dat balance is used only when current (not superseded by newer key/pet).
 */
function filterOtherDepositLinesAfterKeyOpening(
  lines,
  summaryLines,
  turnoverAnchorDate,
  keyDepositDollars,
  latestKeyOpeningMs
) {
  const filtered = filterCurrentCategoryLines(
    lines,
    "other_deposit",
    summaryLines,
    turnoverAnchorDate
  );
  if (keyDepositDollars == null || latestKeyOpeningMs <= 0) return filtered;
  return filtered.filter((line) => parseLeaseholdDate(line.date) > latestKeyOpeningMs);
}

function resolveOtherDepositDollars(
  summaryLines,
  ledgerLines,
  keyDepositDollars,
  petDepositDollars,
  turnoverAnchorDate
) {
  const latestKeyOpeningMs = latestKeyOpeningDateMs(
    summaryLines,
    ledgerLines,
    turnoverAnchorDate
  );
  const otherFromSummary = latestCategoryAmount(
    filterOtherDepositLinesAfterKeyOpening(
      summaryLines,
      summaryLines,
      turnoverAnchorDate,
      keyDepositDollars,
      latestKeyOpeningMs
    ),
    "other_deposit"
  );
  if (otherFromSummary != null) return otherFromSummary;

  const otherFromLedger = latestCategoryAmount(
    filterOtherDepositLinesAfterKeyOpening(
      ledgerLines,
      summaryLines,
      turnoverAnchorDate,
      keyDepositDollars,
      latestKeyOpeningMs
    ),
    "other_deposit"
  );
  if (otherFromLedger == null) return null;
  if (keyDepositDollars == null && petDepositDollars == null) return otherFromLedger;

  const otherDate = latestCategoryLineDate(
    filterOtherDepositLinesAfterKeyOpening(
      ledgerLines,
      summaryLines,
      turnoverAnchorDate,
      keyDepositDollars,
      latestKeyOpeningMs
    ),
    "other_deposit"
  );
  const anchorDate = Math.max(
    turnoverAnchorDate,
    latestCategoryLineDate(
      filterCurrentCategoryLines(ledgerLines, "key_deposit", summaryLines, turnoverAnchorDate),
      "key_deposit"
    ),
    latestCategoryLineDate(
      filterCurrentCategoryLines(summaryLines, "key_deposit", summaryLines, turnoverAnchorDate),
      "key_deposit"
    ),
    latestCategoryLineDate(
      filterCurrentCategoryLines(ledgerLines, "pet_deposit", summaryLines, turnoverAnchorDate),
      "pet_deposit"
    ),
    latestCategoryLineDate(
      filterCurrentCategoryLines(summaryLines, "pet_deposit", summaryLines, turnoverAnchorDate),
      "pet_deposit"
    )
  );
  return otherDate >= anchorDate ? otherFromLedger : null;
}

/** Propera Other KPI: literal other + remote/ancillary — excludes key and pet. */
function properaOtherDepositDollars(otherDepositDollars, ancillaryDepositDollars) {
  const total = (otherDepositDollars ?? 0) + (ancillaryDepositDollars ?? 0);
  return total > 0 ? total : null;
}

/** Net S.Dat remote/ancillary charges and refund credits (e.g. +90 remote, -90 return). */
function netAncillaryDepositDollars(summaryLines, anchorDate) {
  let net = 0;
  let hasAny = false;
  const current = filterCurrentCategoryLines(
    summaryLines,
    "ancillary",
    summaryLines,
    anchorDate
  );
  for (const line of sortByDate(current)) {
    const amount = readSignedLineAmount(line);
    if (amount == null) continue;
    net += amount;
    hasAny = true;
  }
  if (!hasAny) return null;
  const rounded = roundMoney(net);
  return rounded != null && rounded > 0 ? rounded : null;
}

function buildDepositHistory({ summaryLines, ledgerLines }) {
  const history = [];

  for (const line of summaryLines) {
    const category = classifyDepositLabel(line?.label);
    if (!category) continue;
    const amount = usesSignedCategoryAmount(category)
      ? readSignedLineAmount(line)
      : readLineAmount(line);
    if (amount == null) continue;
    history.push({
      date: line.date,
      label: String(line.label ?? "").trim(),
      category,
      amount_dollars: amount,
      source: "s_dat",
    });
  }

  for (const line of ledgerLines) {
    const category = classifyDepositLabel(line?.label);
    if (!category) continue;
    const amount = readLineAmount(line);
    if (amount == null) continue;
    history.push({
      date: line.date,
      label: String(line.label ?? "").trim(),
      category,
      amount_dollars: amount,
      source: "r_dat",
      balance_on_file: line.balance_dollars != null,
    });
  }

  return sortByDate(history);
}

function deriveRentSecurityFromLedger(lines) {
  const sorted = sortByDate(lines);
  let openingBalance = null;
  let topUpSum = 0;
  let hasTopUps = false;

  for (const line of sorted) {
    const label = normalizeDepositLabel(line?.label);
    const amount = readLineAmount(line);
    if (amount == null) continue;

    if (label === RENT_SECURITY_LABEL) {
      openingBalance = amount;
      continue;
    }
    if (isSecurityTopUpLabel(label)) {
      hasTopUps = true;
      topUpSum += amount;
    }
  }

  if (hasTopUps) {
    if (openingBalance == null) return topUpSum > 0 ? topUpSum : null;
    return topUpSum >= openingBalance ? topUpSum : openingBalance + topUpSum;
  }
  return openingBalance;
}

function deriveNonSecurityDeposits(summaryLines, ledgerLines) {
  const anchorDate = latestSecurityTurnoverDate(summaryLines, ledgerLines);

  const key_deposit_dollars = deriveKeyDepositDollars(
    summaryLines,
    ledgerLines,
    anchorDate
  );

  const pet_deposit_dollars = netCurrentCategoryAmount(
    summaryLines,
    ledgerLines,
    "pet_deposit",
    anchorDate
  );

  const other_deposit_dollars = resolveOtherDepositDollars(
    summaryLines,
    ledgerLines,
    key_deposit_dollars,
    pet_deposit_dollars,
    anchorDate
  );

  const ancillary_deposit_dollars = netAncillaryDepositDollars(summaryLines, anchorDate);

  const leasehold_other_deposit_total_dollars =
    (other_deposit_dollars ?? 0) +
    (key_deposit_dollars ?? 0) +
    (pet_deposit_dollars ?? 0) +
    (ancillary_deposit_dollars ?? 0);

  return {
    other_deposit_dollars,
    propera_other_deposit_dollars: properaOtherDepositDollars(
      other_deposit_dollars,
      ancillary_deposit_dollars
    ),
    key_deposit_dollars,
    pet_deposit_dollars,
    ancillary_deposit_dollars,
    leasehold_other_deposit_total_dollars:
      leasehold_other_deposit_total_dollars > 0
        ? leasehold_other_deposit_total_dollars
        : null,
  };
}

/** S.Dat lines are transaction amounts — sum security top-ups only as last resort. */
export function deriveDepositsFromSummaryLines(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    return emptyDerivedDeposits();
  }

  let security = 0;
  let hasSecurity = false;

  for (const line of lines) {
    const label = normalizeDepositLabel(line?.label);
    const amount = readLineAmount(line);
    if (amount == null) continue;

    if (label === RENT_SECURITY_LABEL || isSecurityTopUpLabel(label)) {
      security += amount;
      hasSecurity = true;
    }
  }

  return {
    ...deriveNonSecurityDeposits(lines, []),
    security_deposit_dollars: hasSecurity && security > 0 ? security : null,
    deposit_history: buildDepositHistory({ summaryLines: lines, ledgerLines: [] }),
  };
}

export function deriveDepositsFromLedgerLines(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    return emptyDerivedDeposits();
  }

  return {
    ...deriveNonSecurityDeposits([], lines),
    security_deposit_dollars: deriveRentSecurityFromLedger(lines),
    deposit_history: buildDepositHistory({ summaryLines: [], ledgerLines: lines }),
  };
}

function emptyDerivedDeposits() {
  return {
    security_deposit_dollars: null,
    other_deposit_dollars: null,
    propera_other_deposit_dollars: null,
    key_deposit_dollars: null,
    pet_deposit_dollars: null,
    ancillary_deposit_dollars: null,
    leasehold_other_deposit_total_dollars: null,
    deposit_history: [],
  };
}

export function summarizeDepositsByUnit({
  summaryByUnit,
  ledgerByUnit,
  unitMasterByLabel,
}) {
  const result = new Map();
  const unitLabels = new Set([
    ...(summaryByUnit?.keys() ?? []),
    ...(ledgerByUnit?.keys() ?? []),
    ...(unitMasterByLabel?.keys() ?? []),
  ]);

  for (const unitLabel of unitLabels) {
    const summaryLines = summaryByUnit?.get(unitLabel) ?? [];
    const ledgerLines = ledgerByUnit?.get(unitLabel) ?? [];
    const unitMaster = unitMasterByLabel?.get(unitLabel) ?? null;

    if (isDepositVacantOnFile(unitMaster)) {
      result.set(unitLabel, {
        security_deposit_dollars: null,
        other_deposit_literal_dollars: null,
        other_deposit_dollars: null,
        propera_other_deposit_dollars: null,
        key_deposit_dollars: null,
        pet_deposit_dollars: null,
        ancillary_deposit_dollars: null,
        leasehold_security_dollars: null,
        leasehold_other_dollars: null,
        leasehold_total_dollars: 0,
        leasehold_deposit_total_dollars: 0,
        leasehold_grand_total_dollars: 0,
        deposit_component_sum_dollars: 0,
        leasehold_other_deposit_total_dollars: null,
        deposit_history: [],
        security_turnover_anchor_date: null,
        source: "unit_master_vacant",
      });
      continue;
    }

    const fromSummary = deriveDepositsFromSummaryLines(summaryLines);
    const fromLedger = deriveDepositsFromLedgerLines(ledgerLines);
    const nonSecurity = deriveNonSecurityDeposits(summaryLines, ledgerLines);

    const leaseholdMasterTotal =
      unitMaster?.segment1 != null
        ? parseRentSecurityFromSegment1(unitMaster.segment1)
        : unitMaster?.rent_security_dollars ?? null;

    const securityFromLines = deriveSecurityFromDepositLines(summaryLines, ledgerLines);

    const reconciled = reconcileProperaDepositSplits({
      leaseholdMasterTotalDollars: leaseholdMasterTotal,
      securityFromLinesDollars: securityFromLines,
      keyDepositDollars: nonSecurity.key_deposit_dollars,
      petDepositDollars: nonSecurity.pet_deposit_dollars,
      otherLiteralDollars: nonSecurity.other_deposit_dollars,
      ancillaryDepositDollars: nonSecurity.ancillary_deposit_dollars,
    });

    const security = reconciled.security_deposit_dollars;
    const properaOther = reconciled.propera_other_deposit_dollars;

    if (
      security == null &&
      properaOther == null &&
      reconciled.key_deposit_dollars == null &&
      reconciled.pet_deposit_dollars == null
    ) {
      continue;
    }

    let source = "unit_master";
    if (leaseholdMasterTotal == null) {
      if (fromLedger.security_deposit_dollars != null) source = "r_dat";
      else if (fromSummary.security_deposit_dollars != null) source = "s_dat";
    }
    if (
      reconciled.pet_deposit_dollars != null ||
      reconciled.key_deposit_dollars != null ||
      nonSecurity.other_deposit_dollars != null ||
      securityFromLines != null
    ) {
      source = source === "unit_master" ? "unit_master+deposit_dat" : "deposit_dat";
    }

    result.set(unitLabel, {
      security_deposit_dollars: security,
      /** Literal "Other Deposit" line only (e.g. $150). */
      other_deposit_literal_dollars: nonSecurity.other_deposit_dollars,
      other_deposit_dollars: nonSecurity.other_deposit_dollars,
      /** Propera Other KPI — remainder after security/key/pet or explicit other lines. */
      propera_other_deposit_dollars: properaOther,
      key_deposit_dollars: reconciled.key_deposit_dollars,
      pet_deposit_dollars: reconciled.pet_deposit_dollars,
      ancillary_deposit_dollars: nonSecurity.ancillary_deposit_dollars,
      /** LH Security column (rent security only). */
      leasehold_security_dollars: reconciled.leasehold_security_dollars,
      /** LH Other column (= Propera key + pet + other). */
      leasehold_other_dollars: reconciled.leasehold_other_dollars,
      /** LH Security + LH Other — must equal Propera component sum. */
      leasehold_total_dollars: reconciled.leasehold_total_dollars,
      leasehold_deposit_total_dollars: reconciled.leasehold_deposit_total_dollars,
      leasehold_grand_total_dollars: reconciled.leasehold_grand_total_dollars,
      deposit_component_sum_dollars: reconciled.deposit_component_sum_dollars,
      /** Leasehold combined "Other deposit" bucket — reconciliation only. */
      leasehold_other_deposit_total_dollars: nonSecurity.leasehold_other_deposit_total_dollars,
      deposit_history: buildDepositHistory({ summaryLines, ledgerLines }),
      security_turnover_anchor_date: anchorDateForUnit(summaryLines, ledgerLines),
      source,
    });
  }

  return result;
}

function anchorDateForUnit(summaryLines, ledgerLines) {
  const anchorMs = latestSecurityTurnoverDate(summaryLines, ledgerLines);
  if (!anchorMs) return null;
  const sorted = sortByDate([...summaryLines, ...ledgerLines]);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const line = sorted[i];
    const amount = readLineAmount(line);
    if (!isSecurityTurnoverLine(line?.label, amount)) continue;
    if (parseLeaseholdDate(line.date) === anchorMs) return line.date;
  }
  return null;
}
