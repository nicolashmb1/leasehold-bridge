#!/usr/bin/env node
/**
 * Compare leasehold-bridge parseUnitMasterDat tenant names vs LH OXPS print (reports.oxps).
 *
 * Usage:
 *   node scripts/reconcileOxpsTenantNames.js [oxpsPagesDir]
 *
 * Default pages dir: ../.tmp-reports-oxps/extracted/Documents/1/Pages
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnitMasterDat } from "../src/parsers/parseUnitMasterDat.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PAGES = path.resolve(PACKAGE_ROOT, "..", ".tmp-reports-oxps", "extracted", "Documents", "1", "Pages");

/** OXPS Property Code header → RA group in lhmirror */
const OXPS_PROPERTY_TO_RA = [
  { re: /618-630/i, ra: "RA0003", propera: "WESTFIELD" },
  { re: /318\s*WGRAND|318\s*WEST\s*GRAND/i, ra: "RA0001", propera: "WESTGRAND" },
  { re: /57-77\s*MURR/i, ra: "RA0005", propera: "MURRAY" },
  { re: /540\s*MORRIS/i, ra: "RA0007", propera: "MORRIS" },
  { re: /702\s*PENN/i, ra: "RA0006", propera: "PENN" },
  { re: /354\s*UNION/i, ra: "RA0008", propera: null },
  { re: /678\s*PENN/i, ra: "RA0010", propera: null },
  { re: /707\s*PENN/i, ra: "RA0009", propera: null },
];

function normalizeName(name) {
  return String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(/\s+/);
  const tb = nb.split(/\s+/);
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t));
  if (overlap.length >= 2) return true;
  if (overlap.length >= 1 && (ta.length === 1 || tb.length === 1)) return true;
  return ta[0] === tb[0];
}

function resolveRaGroup(propertyCodeRaw) {
  const text = String(propertyCodeRaw ?? "").trim();
  for (const row of OXPS_PROPERTY_TO_RA) {
    if (row.re.test(text)) return row;
  }
  return null;
}

function extractUnicodeStrings(xml) {
  return [...xml.matchAll(/UnicodeString="([^"]*)"/g)].map((m) => m[1]);
}

/** Tenant info page: Property Code + Unit: NNN + name line at OriginY="24". */
function extractTenantInfoPage(filePath) {
  const xml = fs.readFileSync(filePath, "utf8");
  const strings = extractUnicodeStrings(xml);
  const joined = strings.join(" ");

  const propMatch = joined.match(/Property Code:?\s+(.+?)\s+Unit:\s*(\d{3})/i);
  if (!propMatch) return null;

  const propertyCode = propMatch[1].trim();
  const unit = propMatch[2].trim();

  const nameLineMatch = xml.match(/OriginY="24"[^>]*UnicodeString="([^"]+)"/);
  if (!nameLineMatch) return null;

  const nameLine = nameLineMatch[1].trim();
  if (!nameLine || nameLine.startsWith("---")) return null;

  // First occupant block before co-tenant (3+ spaces between people on LH print).
  const blocks = nameLine.split(/\s{3,}/).map((b) => b.trim()).filter(Boolean);
  const primaryBlock = blocks[0] ?? nameLine;
  const primaryName = primaryBlock.replace(/\s+/g, " ").trim();

  const mapped = resolveRaGroup(propertyCode);
  if (!mapped) return null;

  return {
    propertyCode,
    unit,
    primaryName,
    fullNameLine: nameLine,
    raGroup: mapped.ra,
    properaCode: mapped.propera,
  };
}

function loadParserNames(raGroup) {
  const datPath = path.join(PACKAGE_ROOT, "lhmirror", `${raGroup}.DAT`);
  if (!fs.existsSync(datPath)) return null;
  const parsed = parseUnitMasterDat(fs.readFileSync(datPath));
  const byUnit = new Map();
  for (const u of parsed.units) {
    const lab = String(u.unit_label ?? "").trim().slice(0, 3);
    if (lab) byUnit.set(lab, u.tenant_name);
  }
  return byUnit;
}

function walkFpages(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f.endsWith(".fpage")) out.push(p);
  }
  return out;
}

const pagesDir = process.argv[2] ?? DEFAULT_PAGES;
if (!fs.existsSync(pagesDir)) {
  console.error(`Pages directory not found: ${pagesDir}`);
  console.error("Extract reports.oxps to .tmp-reports-oxps/extracted first.");
  process.exit(1);
}

const oxpsByKey = new Map();
for (const page of walkFpages(pagesDir)) {
  const row = extractTenantInfoPage(page);
  if (!row?.raGroup) continue;
  const key = `${row.raGroup}:${row.unit}`;
  if (!oxpsByKey.has(key)) oxpsByKey.set(key, row);
}

const parserCache = new Map();
const resultsByProperty = new Map();

for (const row of oxpsByKey.values()) {
  if (!parserCache.has(row.raGroup)) {
    parserCache.set(row.raGroup, loadParserNames(row.raGroup));
  }
  const parserByUnit = parserCache.get(row.raGroup);
  if (!parserByUnit) continue;

  const parsedName = parserByUnit.get(row.unit) ?? null;
  const match = parsedName ? namesMatch(row.primaryName, parsedName) : false;

  const bucket = resultsByProperty.get(row.raGroup) ?? {
    raGroup: row.raGroup,
    properaCode: row.properaCode,
    propertyCode: row.propertyCode,
    matches: [],
    mismatches: [],
    missingInDat: [],
  };

  if (!parsedName) {
    bucket.missingInDat.push({ unit: row.unit, oxps: row.primaryName });
  } else if (match) {
    bucket.matches.push({ unit: row.unit, oxps: row.primaryName, parsed: parsedName });
  } else {
    bucket.mismatches.push({
      unit: row.unit,
      oxps: row.primaryName,
      parsed: parsedName,
      fullLine: row.fullNameLine,
    });
  }
  resultsByProperty.set(row.raGroup, bucket);
}

console.log("LH OXPS tenant name reconciliation (primary leaseholder vs parseUnitMasterDat)");
console.log(`Pages: ${pagesDir}`);
console.log("");

let totalMatch = 0;
let totalMismatch = 0;
let totalMissing = 0;

for (const bucket of [...resultsByProperty.values()].sort((a, b) =>
  String(a.raGroup).localeCompare(String(b.raGroup))
)) {
  const label = bucket.properaCode ?? bucket.raGroup;
  console.log(
    `=== ${label} (${bucket.raGroup}) — match ${bucket.matches.length} | mismatch ${bucket.mismatches.length} | no .DAT unit ${bucket.missingInDat.length} ===`
  );

  totalMatch += bucket.matches.length;
  totalMismatch += bucket.mismatches.length;
  totalMissing += bucket.missingInDat.length;

  if (bucket.mismatches.length) {
    console.log("MISMATCHES (OXPS primary vs parser):");
    for (const m of bucket.mismatches.sort((a, b) => Number(a.unit) - Number(b.unit))) {
      console.log(
        `  unit ${m.unit}: OXPS="${m.oxps}" | parser="${m.parsed}" | full="${m.fullLine}"`
      );
    }
  }

  if (bucket.missingInDat.length) {
    console.log("Missing in .DAT (OXPS only):");
    for (const m of bucket.missingInDat.sort((a, b) => Number(a.unit) - Number(b.unit))) {
      console.log(`  unit ${m.unit}: OXPS="${m.oxps}"`);
    }
  }

  console.log("");
}

console.log("TOTALS");
console.log(`  Match:     ${totalMatch}`);
console.log(`  Mismatch:  ${totalMismatch}`);
console.log(`  Missing:   ${totalMissing}`);
console.log(`  Properties checked: ${resultsByProperty.size}`);

process.exit(totalMismatch > 0 ? 1 : 0);
