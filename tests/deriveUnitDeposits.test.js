import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDepositSummaryDat } from "../src/parsers/parseDepositSummaryDat.js";
import { parseDepositLedgerDat } from "../src/parsers/parseDepositLedgerDat.js";
import { parseUnitMasterDat } from "../src/parsers/parseUnitMasterDat.js";
import {
  deriveDepositsFromSummaryLines,
  deriveDepositsFromLedgerLines,
  summarizeDepositsByUnit,
} from "../src/normalize/deriveUnitDeposits.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** LH = Security + Other  ===  Propera = Security + Key + Pet + Other */
function assertDepositFormula(row, unitLabel) {
  const lh = (row.leasehold_security_dollars ?? 0) + (row.leasehold_other_dollars ?? 0);
  const propera =
    (row.security_deposit_dollars ?? 0) +
    (row.key_deposit_dollars ?? 0) +
    (row.pet_deposit_dollars ?? 0) +
    (row.propera_other_deposit_dollars ?? 0);
  assert.equal(row.deposit_component_sum_dollars, propera, `${unitLabel} propera sum`);
  assert.equal(row.leasehold_total_dollars, lh, `${unitLabel} lh sum`);
  assert.ok(Math.abs(lh - propera) < 0.02, `${unitLabel} LH must equal Propera (${lh} vs ${propera})`);
  assert.equal(
    row.leasehold_other_dollars ?? 0,
    (row.key_deposit_dollars ?? 0) +
      (row.pet_deposit_dollars ?? 0) +
      (row.propera_other_deposit_dollars ?? 0),
    `${unitLabel} LH Other = Key + Pet + Other`
  );
}

function loadUnitMasterByLabel(raGroup) {
  const buffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", `${raGroup}.DAT`));
  const parsed = parseUnitMasterDat(buffer);
  return new Map(parsed.units.map((unit) => [String(unit.unit_label).trim().slice(0, 3), unit]));
}

test("deriveDepositsFromLedgerLines reads balance on file for Other Deposit and key", () => {
  const buffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001R.Dat"));
  const parsed = parseDepositLedgerDat(buffer);
  const derived = deriveDepositsFromLedgerLines(parsed.byUnit.get("205"));
  assert.equal(derived.security_deposit_dollars, 2600);
  assert.equal(derived.other_deposit_dollars, null);
  assert.equal(derived.key_deposit_dollars, 150);
});

test("Westgrand unit 101 rent security comes from unit master not S.Dat sum", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001S.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0001");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: null,
    unitMasterByLabel,
  });

  const unit101 = byUnit.get("101");
  assert.ok(unit101);
  assert.equal(unit101.security_deposit_dollars, 2112.5);
  assert.equal(unit101.other_deposit_dollars, 150);
  assert.equal(unit101.ancillary_deposit_dollars, 90);
  assert.equal(unit101.propera_other_deposit_dollars, 240);
  assert.equal(unit101.leasehold_other_deposit_total_dollars, 240);
  assert.equal(unit101.key_deposit_dollars, null);
  assert.equal(unit101.pet_deposit_dollars, null);
  assert.equal(unit101.leasehold_security_dollars, 2112.5);
  assert.equal(unit101.leasehold_other_dollars, 240);
  assert.equal(unit101.leasehold_total_dollars, 2352.5);
  assertDepositFormula(unit101, "101");
});

test("Westgrand deposit splits match Leasehold other-deposit bucket", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0001");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const cases = [
    ["101", { other: 150, ancillary: 90, total: 240 }],
    ["206", { key: 100, pet: 500, total: 600 }],
    ["303", { key: 150, pet: 250, total: 400 }],
    ["304", { key: 150, pet: 500, total: 650 }],
    ["306", { other: 150, total: 150 }],
    ["402", { other: 150, total: 150 }],
    ["404", { other: 150, total: 150 }],
  ];

  for (const [unit, expected] of cases) {
    const row = byUnit.get(unit);
    assert.ok(row, `missing unit ${unit}`);
    if (expected.other != null) assert.equal(row.other_deposit_dollars, expected.other, unit);
    if (expected.key != null) assert.equal(row.key_deposit_dollars, expected.key, unit);
    if (expected.pet != null) assert.equal(row.pet_deposit_dollars, expected.pet, unit);
    if (expected.ancillary != null) {
      assert.equal(row.ancillary_deposit_dollars, expected.ancillary, unit);
    }
    if (expected.properaOther != null) {
      assert.equal(row.propera_other_deposit_dollars, expected.properaOther, unit);
    } else if (expected.other != null || expected.ancillary != null) {
      const properaOther = (expected.other ?? 0) + (expected.ancillary ?? 0);
      assert.equal(row.propera_other_deposit_dollars, properaOther > 0 ? properaOther : null, unit);
    } else {
      assert.equal(row.propera_other_deposit_dollars, null, unit);
    }
    assert.equal(row.leasehold_other_deposit_total_dollars, expected.total, unit);
    assert.ok(row.deposit_history.length > 0, `${unit} history`);
    assertDepositFormula(row, unit);
  }
});

test("Westgrand unit 201 security and key do not double-count into Propera other", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0001");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const unit201 = byUnit.get("201");
  assert.ok(unit201);
  assert.equal(unit201.security_deposit_dollars, 4866);
  assert.equal(unit201.key_deposit_dollars, 200);
  assert.equal(unit201.propera_other_deposit_dollars, null);
  assert.equal(unit201.leasehold_other_deposit_total_dollars, 200);
  assertDepositFormula(unit201, "201");
});

test("Westgrand unit 202 splits LH combined deposit into security and key", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0001");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const unit202 = byUnit.get("202");
  assert.ok(unit202);
  assert.equal(unit202.leasehold_deposit_total_dollars, 3027);
  assert.equal(unit202.security_deposit_dollars, 2877);
  assert.equal(unit202.key_deposit_dollars, 150);
  assert.equal(unit202.propera_other_deposit_dollars, null);
  assert.equal(unit202.leasehold_security_dollars, 2877);
  assert.equal(unit202.leasehold_other_dollars, 150);
  assert.equal(unit202.leasehold_total_dollars, 3027);
  assertDepositFormula(unit202, "202");
});

test("Westgrand unit 302 security matches LH cent precision from deposit increments", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0001");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const unit302 = byUnit.get("302");
  assert.ok(unit302);
  assert.equal(unit302.security_deposit_dollars, 3275.47);
  assert.equal(unit302.key_deposit_dollars, 200);
  assert.equal(unit302.leasehold_security_dollars, 3275.47);
  assert.equal(unit302.leasehold_other_dollars, 200);
  assert.equal(unit302.leasehold_total_dollars, 3475.47);
  assertDepositFormula(unit302, "302");
});

test("Westgrand unit 307 nets remote deposit credit against remote charge", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0001");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const unit307 = byUnit.get("307");
  assert.ok(unit307);
  assert.equal(unit307.security_deposit_dollars, 2715);
  assert.equal(unit307.key_deposit_dollars, 150);
  assert.equal(unit307.ancillary_deposit_dollars, null);
  assert.equal(unit307.propera_other_deposit_dollars, null);
  assert.equal(unit307.leasehold_other_dollars, 150);
  assert.equal(unit307.leasehold_total_dollars, 2865);
  assertDepositFormula(unit307, "307");

  const summaryLines = summary.byUnit.get("307") ?? [];
  assert.ok(
    summaryLines.some(
      (line) =>
        line.label.toLowerCase().includes("credit") && line.amount_dollars === -90
    ),
    "S.Dat must retain -90 remote return credit"
  );
});

test("Westgrand unit 205 matches Leasehold rent security and key deposit", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0001R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0001");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const unit205 = byUnit.get("205");
  assert.ok(unit205);
  assert.equal(unit205.security_deposit_dollars, 2600);
  assert.equal(unit205.key_deposit_dollars, 150);
  assert.equal(unit205.leasehold_other_deposit_total_dollars, 150);
  assert.equal(unit205.leasehold_security_dollars, 2600);
  assert.equal(unit205.leasehold_other_dollars, 150);
  assert.equal(unit205.leasehold_total_dollars, 2750);
  assertDepositFormula(unit205, "205");
});

test("parseDepositSummaryDat reads Penn unit 203 security and key from summary fallback", () => {
  const buffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0006S.Dat"));
  const parsed = parseDepositSummaryDat(buffer);
  const derived = deriveDepositsFromSummaryLines(parsed.byUnit.get("203"));
  assert.equal(derived.security_deposit_dollars, 4906.5);
  assert.equal(derived.key_deposit_dollars, 200);
});

test("Westfield unit 203 keeps KEY DEP after large security bump; LH Other column", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0003S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0003R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0003");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const unit203 = byUnit.get("203");
  assert.ok(unit203);
  assert.equal(unit203.security_deposit_dollars, 3199.5);
  assert.equal(unit203.key_deposit_dollars, 200);
  assert.equal(unit203.propera_other_deposit_dollars, null);
  assert.equal(unit203.leasehold_other_dollars, 200);
  assert.equal(unit203.leasehold_total_dollars, 3399.5);
  assertDepositFormula(unit203, "Westfield-203");
});

test("Westfield unit 202 drops pre-turnover key from R.Dat; Other matches tenant page", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0003S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0003R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0003");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const unit202 = byUnit.get("202");
  assert.ok(unit202);
  assert.equal(unit202.security_deposit_dollars, 3148.5);
  assert.equal(unit202.key_deposit_dollars, null);
  assert.equal(unit202.other_deposit_dollars, 200);
  assert.equal(unit202.propera_other_deposit_dollars, 200);
  assert.equal(unit202.leasehold_other_dollars, 200);
  assert.equal(unit202.leasehold_total_dollars, 3348.5);
  assert.equal(unit202.security_turnover_anchor_date, "04/18/2019");
  assertDepositFormula(unit202, "Westfield-202");
});

const WESTFIELD_OXPS_PAGES = path.resolve(
  PACKAGE_ROOT,
  "..",
  ".oxps-extract-westfield2",
  "unzipped",
  "Documents",
  "1",
  "Pages"
);

function loadWestfieldOxpsDepositsByUnit() {
  const byUnit = new Map();
  if (!fs.existsSync(WESTFIELD_OXPS_PAGES)) return byUnit;
  for (const fileName of fs.readdirSync(WESTFIELD_OXPS_PAGES).filter((n) => n.endsWith(".fpage"))) {
    const xml = fs.readFileSync(path.join(WESTFIELD_OXPS_PAGES, fileName), "utf8");
    const unit = xml.match(/Unit:\s*(\d{3})/)?.[1];
    const joined = [...xml.matchAll(/UnicodeString="([^"]*)"/g)].map((m) => m[1]).join(" ");
    const rentSec = joined.match(/Rent Security:\s*([\d.]+)/);
    const otherSec = joined.match(/Other Security:\s*([\d.]+)/);
    if (!unit || !rentSec) continue;
    byUnit.set(unit, {
      security: Number(rentSec[1]),
      other: otherSec ? Number(otherSec[1]) : 0,
    });
  }
  return byUnit;
}

function loadWestfieldDepositsByUnit() {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0003S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0003R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0003");
  return summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });
}

test("Westfield OXPS deposit totals match LH Security + Other (mirror-backed units)", () => {
  const oxpsByUnit = loadWestfieldOxpsDepositsByUnit();
  assert.ok(oxpsByUnit.size >= 29, "westifield2.oxps extract required for regression test");
  const byUnit = loadWestfieldDepositsByUnit();
  const mirrorGapUnits = new Set(["314"]);

  for (const [unitLabel, expected] of oxpsByUnit.entries()) {
    if (mirrorGapUnits.has(unitLabel)) continue;
    const row = byUnit.get(unitLabel);
    assert.ok(row, `missing export row for unit ${unitLabel}`);
    assert.ok(
      Math.abs((row.leasehold_security_dollars ?? 0) - expected.security) < 0.02,
      `${unitLabel} security (${row.leasehold_security_dollars} vs ${expected.security})`
    );
    assert.ok(
      Math.abs((row.leasehold_other_dollars ?? 0) - expected.other) < 0.02,
      `${unitLabel} other (${row.leasehold_other_dollars} vs ${expected.other})`
    );
    assertDepositFormula(row, `Westfield-OXPS-${unitLabel}`);
  }
});

const MURRAY_OXPS_PAGES = path.resolve(
  PACKAGE_ROOT,
  "..",
  ".oxps-extract-murray",
  "unzipped",
  "Documents",
  "1",
  "Pages"
);

function loadMurrayOxpsDepositsByUnit() {
  const byUnit = new Map();
  if (!fs.existsSync(MURRAY_OXPS_PAGES)) return byUnit;
  for (const fileName of fs.readdirSync(MURRAY_OXPS_PAGES).filter((n) => n.endsWith(".fpage"))) {
    const xml = fs.readFileSync(path.join(MURRAY_OXPS_PAGES, fileName), "utf8");
    const unit = xml.match(/Unit:\s*(\d{3})/)?.[1];
    const joined = [...xml.matchAll(/UnicodeString="([^"]*)"/g)].map((m) => m[1]).join(" ");
    const rentSec = joined.match(/Rent Security:\s*([\d.]+)/);
    const otherSec = joined.match(/Other Security:\s*([\d.]+)/);
    if (!unit || rentSec == null) continue;
    byUnit.set(unit, {
      security: Number(rentSec[1]),
      other: otherSec ? Number(otherSec[1]) : 0,
    });
  }
  return byUnit;
}

function loadMurrayDepositsByUnit() {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0005S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0005R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0005");
  return summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });
}

test("Murray OXPS deposit totals match LH Security + Other", () => {
  const oxpsByUnit = loadMurrayOxpsDepositsByUnit();
  assert.ok(oxpsByUnit.size >= 80, "murray.oxps extract required for regression test");
  const byUnit = loadMurrayDepositsByUnit();

  for (const [unitLabel, expected] of oxpsByUnit.entries()) {
    const row = byUnit.get(unitLabel);
    assert.ok(row, `missing export row for unit ${unitLabel}`);
    assert.ok(
      Math.abs((row.leasehold_security_dollars ?? 0) - expected.security) < 0.02,
      `${unitLabel} security (${row.leasehold_security_dollars} vs ${expected.security})`
    );
    assert.ok(
      Math.abs((row.leasehold_other_dollars ?? 0) - expected.other) < 0.02,
      `${unitLabel} other (${row.leasehold_other_dollars} vs ${expected.other})`
    );
    assertDepositFormula(row, `Murray-OXPS-${unitLabel}`);
  }
});

test("Murray vacant units clear stale R.Dat key deposits", () => {
  const byUnit = loadMurrayDepositsByUnit();
  for (const unit of ["203", "207"]) {
    const row = byUnit.get(unit);
    assert.ok(row, unit);
    assert.equal(row.source, "unit_master_vacant");
    assert.equal(row.key_deposit_dollars, null);
    assert.equal(row.leasehold_other_dollars, null);
  }
});

test("Murray deposit edge cases (KEY FOB, turnover SECURITY, vacant)", () => {
  const byUnit = loadMurrayDepositsByUnit();
  const unit415 = byUnit.get("415");
  assert.ok(unit415);
  assert.equal(unit415.security_deposit_dollars, 3829.5);
  assert.equal(unit415.key_deposit_dollars, 365);
  assert.equal(unit415.leasehold_other_dollars, 365);

  const unit503 = byUnit.get("503");
  assert.ok(unit503);
  assert.equal(unit503.security_deposit_dollars, 3537);
  assert.equal(unit503.key_deposit_dollars, 200);
  assert.equal(unit503.leasehold_other_dollars, 200);

  const unit504 = byUnit.get("504");
  assert.ok(unit504);
  assert.equal(unit504.security_deposit_dollars, 2730);
  assert.equal(unit504.key_deposit_dollars, 275);
  assert.equal(unit504.leasehold_other_dollars, 275);
});

const PENN_OXPS_PAGES = path.resolve(
  PACKAGE_ROOT,
  "..",
  ".oxps-extract-penn",
  "unzipped",
  "Documents",
  "1",
  "Pages"
);

function loadPennOxpsDepositsByUnit() {
  const byUnit = new Map();
  if (!fs.existsSync(PENN_OXPS_PAGES)) return byUnit;
  for (const fileName of fs.readdirSync(PENN_OXPS_PAGES).filter((n) => n.endsWith(".fpage"))) {
    const xml = fs.readFileSync(path.join(PENN_OXPS_PAGES, fileName), "utf8");
    const unit = xml.match(/Unit:\s*(\d{3})/)?.[1];
    const joined = [...xml.matchAll(/UnicodeString="([^"]*)"/g)].map((m) => m[1]).join(" ");
    const rentSec = joined.match(/Rent Security:\s*([\d.]+)/);
    const otherSec = joined.match(/Other Security:\s*([\d.]+)/);
    if (!unit || rentSec == null) continue;
    byUnit.set(unit, {
      security: Number(rentSec[1]),
      other: otherSec ? Number(otherSec[1]) : 0,
    });
  }
  return byUnit;
}

function loadPennDepositsByUnit() {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0006S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0006R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0006");
  return summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });
}

test("Penn OXPS deposit totals match LH Security + Other", () => {
  const oxpsByUnit = loadPennOxpsDepositsByUnit();
  assert.ok(oxpsByUnit.size >= 90, "penn.oxps extract required for regression test");
  const byUnit = loadPennDepositsByUnit();

  for (const [unitLabel, expected] of oxpsByUnit.entries()) {
    const row = byUnit.get(unitLabel);
    assert.ok(row, `missing export row for unit ${unitLabel}`);
    assert.ok(
      Math.abs((row.leasehold_security_dollars ?? 0) - expected.security) < 0.02,
      `${unitLabel} security (${row.leasehold_security_dollars} vs ${expected.security})`
    );
    assert.ok(
      Math.abs((row.leasehold_other_dollars ?? 0) - expected.other) < 0.02,
      `${unitLabel} other (${row.leasehold_other_dollars} vs ${expected.other})`
    );
    assertDepositFormula(row, `Penn-OXPS-${unitLabel}`);
  }
});

const MORRIS_OXPS_PAGES = path.resolve(
  PACKAGE_ROOT,
  "..",
  ".oxps-extract-morris",
  "unzipped",
  "Documents",
  "1",
  "Pages"
);

function loadMorrisOxpsDepositsByUnit() {
  const byUnit = new Map();
  if (!fs.existsSync(MORRIS_OXPS_PAGES)) return byUnit;
  for (const fileName of fs.readdirSync(MORRIS_OXPS_PAGES).filter((n) => n.endsWith(".fpage"))) {
    const xml = fs.readFileSync(path.join(MORRIS_OXPS_PAGES, fileName), "utf8");
    const unit = xml.match(/Unit:\s*(\d{3})/)?.[1];
    const joined = [...xml.matchAll(/UnicodeString="([^"]*)"/g)].map((m) => m[1]).join(" ");
    const rentSec = joined.match(/Rent Security:\s*([\d.]+)/);
    const otherSec = joined.match(/Other Security:\s*([\d.]+)/);
    if (!unit || rentSec == null) continue;
    byUnit.set(unit, {
      security: Number(rentSec[1]),
      other: otherSec ? Number(otherSec[1]) : 0,
    });
  }
  return byUnit;
}

function loadMorrisDepositsByUnit() {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0007S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0007R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0007");
  return summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });
}

test("Morris OXPS deposit totals match LH Security + Other", () => {
  const oxpsByUnit = loadMorrisOxpsDepositsByUnit();
  assert.ok(oxpsByUnit.size >= 55, "morris.oxps extract required for regression test");
  const byUnit = loadMorrisDepositsByUnit();

  for (const [unitLabel, expected] of oxpsByUnit.entries()) {
    const row = byUnit.get(unitLabel);
    assert.ok(row, `missing export row for unit ${unitLabel}`);
    assert.ok(
      Math.abs((row.leasehold_security_dollars ?? 0) - expected.security) < 0.02,
      `${unitLabel} security (${row.leasehold_security_dollars} vs ${expected.security})`
    );
    assert.ok(
      Math.abs((row.leasehold_other_dollars ?? 0) - expected.other) < 0.02,
      `${unitLabel} other (${row.leasehold_other_dollars} vs ${expected.other})`
    );
    assertDepositFormula(row, `Morris-OXPS-${unitLabel}`);
  }
});

test("Penn deposit edge cases (false turnover SECURITY, cumulative keys)", () => {
  const byUnit = loadPennDepositsByUnit();
  const unit210 = byUnit.get("210");
  assert.ok(unit210);
  assert.equal(unit210.security_deposit_dollars, 3858);
  assert.equal(unit210.key_deposit_dollars, 200);
  assert.equal(unit210.ancillary_deposit_dollars, 100);
  assert.equal(unit210.leasehold_other_dollars, 300);

  const unit220 = byUnit.get("220");
  assert.ok(unit220);
  assert.equal(unit220.security_deposit_dollars, 5191.5);
  assert.equal(unit220.key_deposit_dollars, 200);
  assert.equal(unit220.leasehold_other_dollars, 200);
  assert.equal(unit220.security_turnover_anchor_date, "01/24/2024");

  const unit215 = byUnit.get("215");
  assert.ok(unit215);
  assert.equal(unit215.key_deposit_dollars, 200);
  assert.equal(unit215.leasehold_other_dollars, 200);
});

test("Westfield unit 314 has no S/R.Dat deposit rows in mirror (LH Other $700 not exportable yet)", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0003S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0003R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  assert.equal(summary.byUnit.get("314"), undefined);
  assert.equal(ledger.byUnit.get("314"), undefined);
});

test("summarizeDepositsByUnit prefers unit master rent security over S.Dat", () => {
  const summaryBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0006S.Dat"));
  const ledgerBuffer = fs.readFileSync(path.join(PACKAGE_ROOT, "lhmirror", "RA0006R.Dat"));
  const summary = parseDepositSummaryDat(summaryBuffer);
  const ledger = parseDepositLedgerDat(ledgerBuffer);
  const unitMasterByLabel = loadUnitMasterByLabel("RA0006");
  const byUnit = summarizeDepositsByUnit({
    summaryByUnit: summary.byUnit,
    ledgerByUnit: ledger.byUnit,
    unitMasterByLabel,
  });

  const unit203 = byUnit.get("203");
  assert.ok(unit203);
  assert.equal(unit203.security_deposit_dollars, 4906.5);
  assert.equal(unit203.key_deposit_dollars, 200);
  assert.equal(unit203.source, "unit_master+deposit_dat");
});
