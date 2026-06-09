#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROPERTY = (process.argv[2] ?? "WESTFIELD").toUpperCase();
const PAGES_DIR =
  process.argv[3] ??
  path.resolve(
    PACKAGE_ROOT,
    "..",
    PROPERTY === "WESTFIELD" ? ".oxps-extract-westfield2" : `.oxps-extract-${PROPERTY.toLowerCase()}`,
    "unzipped",
    "Documents",
    "1",
    "Pages"
  );
const OXPS_LABEL = process.argv[4] ?? `${PROPERTY.toLowerCase()}.oxps`;

function extractFromPage(filePath) {
  const xml = fs.readFileSync(filePath, "utf8");
  const unitMatch = xml.match(/Unit:\s*(\d{3})/);
  if (!unitMatch) return null;
  const unit = unitMatch[1];
  const strings = [...xml.matchAll(/UnicodeString="([^"]*)"/g)].map((m) => m[1]);
  const joined = strings.join(" ");
  const rentSec = joined.match(/Rent Security:\s*([\d.]+)/);
  const otherSec = joined.match(/Other Security:\s*([\d.]+)/);
  return {
    unit,
    rent_security: rentSec ? Number(rentSec[1]) : null,
    other_security: otherSec ? Number(otherSec[1]) : null,
  };
}

function moneyClose(a, b, epsilon = 0.02) {
  const aNum = a == null ? 0 : Number(a);
  const bNum = b == null ? 0 : Number(b);
  return Math.abs(aNum - bNum) <= epsilon;
}

if (!fs.existsSync(PAGES_DIR)) {
  console.error(`Pages directory not found: ${PAGES_DIR}`);
  console.error("Usage: node scripts/reconcileOxps.js <PROPERTY> [pagesDir] [oxpsLabel]");
  process.exit(1);
}

const lhByUnit = new Map();
for (const f of fs.readdirSync(PAGES_DIR).filter((n) => n.endsWith(".fpage"))) {
  const row = extractFromPage(path.join(PAGES_DIR, f));
  if (row?.rent_security != null) lhByUnit.set(row.unit, row);
}

const mapping = loadPropertyMapping();
const ex = exportPropertySnapshots({
  mapping,
  properaPropertyCode: PROPERTY,
  syncedAt: new Date().toISOString().slice(0, 10),
});

const prByUnit = new Map();
for (const f of ex.facts) {
  const sec = f.security_deposit_cents != null ? f.security_deposit_cents / 100 : null;
  const key = f.key_deposit_cents != null ? f.key_deposit_cents / 100 : null;
  const other = f.other_deposit_cents != null ? f.other_deposit_cents / 100 : null;
  const pet = f.pet_deposit_cents != null ? f.pet_deposit_cents / 100 : null;
  const deposits = f.payload?.deposits ?? {};
  const lhOtherFromPayload =
    deposits.leasehold_other_cents != null ? deposits.leasehold_other_cents / 100 : null;
  const componentSum = (key ?? 0) + (other ?? 0) + (pet ?? 0) || null;
  prByUnit.set(f.unit_label, {
    security: sec,
    key,
    other_literal: other,
    pet,
    propera_other_total: lhOtherFromPayload ?? (componentSum > 0 ? componentSum : null),
  });
}

const allUnits = [...new Set([...lhByUnit.keys(), ...prByUnit.keys()])].sort(
  (a, b) => Number(a) - Number(b)
);

const matches = [];
const discrepancies = [];

for (const unit of allUnits) {
  const lh = lhByUnit.get(unit);
  const pr = prByUnit.get(unit);
  if (!lh) {
    discrepancies.push({ unit, issue: "missing_in_lh_print", propera: pr });
    continue;
  }
  if (!pr) {
    discrepancies.push({ unit, issue: "missing_in_propera_export", leasehold: lh });
    continue;
  }

  const secOk = moneyClose(lh.rent_security, pr.security);
  const otherOk = moneyClose(lh.other_security, pr.propera_other_total ?? 0);

  if (secOk && otherOk) {
    matches.push(unit);
    continue;
  }

  discrepancies.push({
    unit,
    issue: "amount_mismatch",
    lh_rent_security: lh.rent_security,
    pr_security: pr.security,
    lh_other_security: lh.other_security,
    pr_other_total: pr.propera_other_total,
    pr_key: pr.key,
    pr_other_literal: pr.other_literal,
    pr_pet: pr.pet,
    sec_off: pr.security != null ? +(pr.security - lh.rent_security).toFixed(2) : null,
    other_off:
      pr.propera_other_total != null
        ? +(pr.propera_other_total - lh.other_security).toFixed(2)
        : lh.other_security > 0
          ? -lh.other_security
          : null,
  });
}

console.log(`${PROPERTY} deposit reconciliation`);
console.log(`LH: ${OXPS_LABEL}`);
console.log(`Pages: ${PAGES_DIR}`);
console.log("Propera: bridge export from lhmirror");
console.log("");
console.log(`LH units: ${lhByUnit.size}`);
console.log(`Propera units: ${prByUnit.size}`);
console.log(`Match: ${matches.length}`);
console.log(`Discrepancies: ${discrepancies.length}`);
console.log("");

if (discrepancies.length) {
  console.log("DISCREPANCIES:");
  for (const d of discrepancies) {
    console.log(JSON.stringify(d));
  }
} else {
  console.log("All units match LH Rent Security + Other Security.");
}
