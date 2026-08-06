#!/usr/bin/env node
/**
 * Investigate LH mirror evidence for recent unit turnovers.
 * Usage:
 *   node scripts/probe-lh-turnover-units.mjs --property MURRAY --units 405,510,512
 *   LEASEHOLD_MIRROR_ROOT=C:\Propera\leasehold-staging node scripts/probe-lh-turnover-units.mjs ...
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { resolveMirrorRoot } from "../src/lib/mirrorRoot.js";
import { parseUnitMasterDat } from "../src/parsers/parseUnitMasterDat.js";
import { latestSecurityTurnoverDate } from "../src/normalize/deriveUnitDeposits.js";
import { parseDepositLedgerDat } from "../src/parsers/parseDepositLedgerDat.js";
import { parseDepositSummaryDat } from "../src/parsers/parseDepositSummaryDat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEGMENT_BYTES = 133;

function readArgv(flag, fallback = "") {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : fallback;
}

function readAscii(buffer, start, end) {
  return buffer.subarray(start, end).toString("ascii");
}

function segText(buffer, segmentIndex, segOffset) {
  const off = (segmentIndex + segOffset) * SEGMENT_BYTES;
  return readAscii(buffer, off, off + SEGMENT_BYTES);
}

function datesIn(text) {
  return [...String(text).matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => m[1]);
}

function parseLhDate(text) {
  const m = String(text || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}

function lastHxNameHit(hxText, unit, nameRe) {
  const re = new RegExp(`${unit}\\s+(\\d{2}/\\d{2}/\\d{4})`, "g");
  let last = null;
  let m;
  while ((m = re.exec(hxText))) {
    const start = Math.max(0, m.index - 100);
    const ctx = hxText.slice(start, m.index + 140).replace(/[\x00-\x1f]/g, " ").replace(/\s+/g, " ");
    if (nameRe.test(ctx)) last = { date: m[1], ctx: ctx.trim() };
  }
  return last;
}

function hDatRows2026(hText, unit) {
  const re = new RegExp(`${unit}\\s+(\\d{2}/\\d{2}/2026)[^\\n]{0,120}`, "g");
  const rows = [];
  let m;
  while ((m = re.exec(hText))) {
    rows.push(m[0].replace(/\s+/g, " ").trim());
  }
  return rows;
}

function xDatHits(xText, unit) {
  const hits = [];
  let idx = 0;
  while ((idx = xText.indexOf(unit.padEnd(3, " "), idx)) >= 0) {
    hits.push(
      xText
        .slice(Math.max(0, idx - 40), idx + 200)
        .replace(/[\x00-\x1f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
    idx += 1;
  }
  return hits.slice(-5);
}

const propertyCode = readArgv("--property", "MURRAY").toUpperCase();
const units = readArgv("--units", "405,510,512")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const mapping = loadPropertyMapping();
const property = mapping.properties.find((p) => p.propera_property_code === propertyCode);
if (!property) {
  console.error(`Unknown property: ${propertyCode}`);
  process.exit(1);
}

const mirrorRoot = resolveMirrorRoot();
const ra = property.leasehold_ra_group;
const masterPath = path.join(mirrorRoot, `${ra}.DAT`);
const hxPath = path.join(mirrorRoot, `${ra}HX.Dat`);
const hPath = path.join(mirrorRoot, `${ra}H.Dat`);
const xPath = path.join(mirrorRoot, `${ra}X.Dat`);
const rPath = path.join(mirrorRoot, `${ra}R.Dat`);
const sPath = path.join(mirrorRoot, `${ra}S.Dat`);

const masterBuffer = fs.readFileSync(masterPath);
const parsed = parseUnitMasterDat(masterBuffer);
const hxText = fs.existsSync(hxPath) ? fs.readFileSync(hxPath, "latin1") : "";
const hText = fs.existsSync(hPath) ? fs.readFileSync(hPath, "latin1") : "";
const xText = fs.existsSync(xPath) ? fs.readFileSync(xPath, "latin1") : "";
const rParsed = fs.existsSync(rPath) ? parseDepositLedgerDat(fs.readFileSync(rPath)) : { byUnit: new Map() };
const sParsed = fs.existsSync(sPath) ? parseDepositSummaryDat(fs.readFileSync(sPath)) : { byUnit: new Map() };

console.log(`Mirror: ${mirrorRoot}`);
console.log(`Property: ${propertyCode} (${ra})`);
console.log(`Units: ${units.join(", ")}\n`);

for (const unitLabel of units) {
  const unit = parsed.units.find((u) => u.unit_label.trim() === unitLabel);
  if (!unit) {
    console.log(`--- ${unitLabel}: not found in unit master ---\n`);
    continue;
  }

  const si = unit.segment_index;
  const seg11 = datesIn(segText(masterBuffer, si, 11))[0] || "—";
  const seg12 = segText(masterBuffer, si, 12).trim();
  const leaseStart = unit.lease_start || "—";
  const leaseEnd = unit.lease_end || "—";

  const ledger = rParsed.byUnit.get(unitLabel) || [];
  const summary = sParsed.byUnit.get(unitLabel) || [];
  const turnoverMs = latestSecurityTurnoverDate(summary, ledger);
  const turnoverDate = turnoverMs ? new Date(turnoverMs).toISOString().slice(0, 10) : "—";

  console.log(`=== Unit ${unitLabel} ===`);
  console.log(`  Current tenant (unit master): ${unit.tenant_name || "(vacant)"}`);
  console.log(`  Lease term (seg 0): ${leaseStart} → ${leaseEnd}`);
  console.log(`  Move-in field (seg 11): ${seg11}`);
  console.log(`  Prior-era marker (seg 12): ${seg12.slice(0, 70)}`);
  console.log(`  Deposit turnover anchor (S/R.Dat): ${turnoverDate}`);

  const hRows = hDatRows2026(hText, unitLabel);
  if (hRows.length) {
    console.log("  H.Dat 2026 (current stream):");
    for (const row of hRows) console.log(`    ${row.slice(0, 140)}`);
  }

  const xHits = xDatHits(xText, unitLabel);
  if (xHits.length) {
    console.log("  X.Dat tenant history (lease terms, not physical dates):");
    for (const row of xHits) console.log(`    ${row.slice(0, 160)}`);
  }

  // Heuristic: last HX row for tenant name appearing in seg12 rent-era (weak — for office review only)
  const priorNameGuess = seg12.match(/-\d/) ? "(see HX + X.Dat; seg12 is prior rent era not move-out)" : "";
  if (priorNameGuess) console.log(`  Note: ${priorNameGuess}`);

  console.log("");
}

console.log("Interpretation:");
console.log("  seg 11 = documented LH move-in / keys-issued field (see propera-app/docs/OCCUPANCY_MOVE_IN_BACKFILL.md)");
console.log("  seg 12 X/date/rent = prior lease-era marker, NOT physical move-out");
console.log("  S/R.Dat turnover anchor + H.Dat ADMIN FEE = new-tenant financial setup, NOT prior move-out");
console.log("  RN.DAT / OC.DAT = no authoritative possession rows in current staging copies");
console.log("  No dedicated move-out date field found in mirror for these units — portal staff remains authoritative for move-out until LH UI source is identified");
