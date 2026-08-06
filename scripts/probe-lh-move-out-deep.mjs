#!/usr/bin/env node
/**
 * Deep probe for Leasehold move-out evidence (MTCom, LG, H.Dat code-2, etc.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { resolveMirrorRoot } from "../src/lib/mirrorRoot.js";
import { parseTransactionStream } from "../src/parsers/parseTransactionStream.js";
import { parseUnitMasterDat } from "../src/parsers/parseUnitMasterDat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MTCOM_RECORD_BYTES = 3500;
const SEGMENT_BYTES = 133;

function readArgv(flag, fallback = "") {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : fallback;
}

function loadMtComPairs(mirrorRoot, raGroup) {
  const filePath = path.join(mirrorRoot, `${raGroup}MTCom.Dat`);
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "latin1");
  const pairs = [];
  for (let i = 0; i + MTCOM_RECORD_BYTES <= text.length; i += MTCOM_RECORD_BYTES) {
    const rec = text.slice(i, i + MTCOM_RECORD_BYTES);
    const move = rec.match(/Move In\s+(\d{2}\/\d{2}\/\d{4})\s+Move Out\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (move) {
      pairs.push({
        recIdx: i / MTCOM_RECORD_BYTES,
        moveIn: move[1],
        moveOut: move[2],
        printable: rec.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim(),
      });
    }
  }
  return pairs;
}

function mtComPrintableChunks(buffer, recIdx) {
  const rec = buffer.subarray(recIdx * MTCOM_RECORD_BYTES, (recIdx + 1) * MTCOM_RECORD_BYTES);
  const chunks = [];
  let start = null;
  for (let i = 0; i < rec.length; i += 1) {
    const printable = rec[i] >= 0x20 && rec[i] < 0x7f;
    if (printable && start === null) start = i;
    if (!printable && start !== null) {
      chunks.push({ start, end: i, text: rec.subarray(start, i).toString("latin1") });
      start = null;
    }
  }
  if (start !== null) {
    chunks.push({ start, end: rec.length, text: rec.subarray(start).toString("latin1") });
  }
  return chunks;
}

function parseLgNotices(lgText) {
  const re = /(\d{2}\/\d{2}\/\d{4})\s+(\d+-Day Notice)\s+\$([\d.]+)/g;
  const notices = [];
  let m;
  while ((m = re.exec(lgText))) {
    notices.push({
      date: m[1],
      kind: m[2],
      amount: m[3],
      context: lgText
        .slice(Math.max(0, m.index - 40), m.index + 100)
        .replace(/[\x00-\x1f]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return notices;
}

function hDatCode2Reversals(mirrorRoot, raGroup, date) {
  const filePath = path.join(mirrorRoot, `${raGroup}H.Dat`);
  if (!fs.existsSync(filePath)) return [];
  const stream = parseTransactionStream(fs.readFileSync(filePath));
  return stream.records.filter(
    (r) => r.date === date && /\s2\s+\d+\s+-/.test(String(r.raw || ""))
  );
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

console.log(`# Deep move-out probe — ${propertyCode} (${ra})`);
console.log(`Mirror: ${mirrorRoot}\n`);

const mtCom = loadMtComPairs(mirrorRoot, ra);
console.log(`## MTCom.Dat — ${mtCom.length} stay records (3500 bytes each, dates only)`);
const recentOut = mtCom.filter((p) => p.moveOut.includes("/2026"));
for (const p of recentOut) {
  console.log(`  rec ${p.recIdx}: ${p.moveIn} → ${p.moveOut}`);
}
console.log(
  "  Note: records contain ONLY 'Move In … Move Out …' text — no unit label or tenant name in export.\n"
);

const mtBuf = fs.readFileSync(path.join(mirrorRoot, `${ra}MTCom.Dat`));
for (const idx of recentOut.map((p) => p.recIdx).slice(-2)) {
  console.log(`### MTCom rec ${idx} printable chunks`);
  for (const c of mtComPrintableChunks(mtBuf, idx)) {
    console.log(`  ${c.start}-${c.end}: ${JSON.stringify(c.text)}`);
  }
  console.log("");
}

const lgPath = path.join(mirrorRoot, `${ra}LG.Dat`);
if (fs.existsSync(lgPath)) {
  const notices = parseLgNotices(fs.readFileSync(lgPath, "latin1"));
  console.log(`## LG.Dat — ${notices.length} legal notices (NOT move-out dates)`);
  for (const n of notices.filter((x) => x.date.includes("/2026")).slice(-10)) {
    console.log(`  ${n.date} ${n.kind} $${n.amount} | ${n.context.slice(0, 100)}`);
  }
  console.log("");
}

const rev0623 = hDatCode2Reversals(mirrorRoot, ra, "06/23/2026");
console.log(`## H.Dat 06/23/2026 code-2 rent reversals (turnover batch marker)`);
for (const r of rev0623) {
  console.log(`  unit ${r.unit_label?.trim()}: ${String(r.raw || "").slice(20).replace(/\s+/g, " ").trim()}`);
}
console.log("  Same pattern on WESTFIELD 213 (Kevin) and batch ADMIN FEE day.\n");

const masterBuffer = fs.readFileSync(path.join(mirrorRoot, `${ra}.DAT`));
const parsed = parseUnitMasterDat(masterBuffer);

console.log("## Candidate prior-tenant → MTCom move-out (match by move-in, not unit-linked)");
const candidates = [
  { unit: "405", prior: "Hugo Bernal", moveIn: "11/01/2023", expectedOut: "~06/30/2026 (before Carla 07/01)" },
  { unit: "510", prior: "Richard Rodriguez", moveIn: "05/01/2024", expectedOut: "~06/30/2026 (before Jazmin 07/01)" },
  { unit: "512", prior: "Ketty Toussaint", moveIn: "11/01/2024", expectedOut: "~06/14/2026 (before Luis 06/15)" },
];

for (const c of candidates) {
  const mt = mtCom.find((p) => p.moveIn === c.moveIn);
  const u = parsed.units.find((x) => x.unit_label.trim() === c.unit);
  const seg11 = masterBuffer
    .subarray((u.segment_index + 11) * SEGMENT_BYTES, (u.segment_index + 12) * SEGMENT_BYTES)
    .toString("ascii")
    .match(/(\d{2}\/\d{2}\/\d{4})/)?.[1];
  console.log(`  ${c.unit} ${c.prior}`);
  console.log(`    HX/move-in anchor: ${c.moveIn}`);
  console.log(`    MTCom move-out:    ${mt?.moveOut ?? "NOT FOUND"}`);
  console.log(`    New tenant seg11:  ${seg11 ?? "—"}`);
  console.log(`    Expected physical: ${c.expectedOut}`);
  if (mt?.moveOut === "06/23/2026") {
    console.log("    ⚠ MTCom date = LH batch processing day (ADMIN FEE), not physical move-out");
  }
}

console.log("\n## WESTFIELD 213 reference (Kevin → Luiz)");
const wf = mapping.properties.find((p) => p.propera_property_code === "WESTFIELD");
if (wf) {
  const wfMt = loadMtComPairs(mirrorRoot, wf.leasehold_ra_group);
  const kevin = wfMt.find((p) => p.moveIn === "03/25/2025");
  console.log(`  MTCom: ${kevin?.moveIn} → ${kevin?.moveOut ?? "?"}`);
  console.log("  Backfill physical move-out: 2026-06-28 (5 days AFTER MTCom date)");
}

console.log("\n## Verdict");
console.log("  MTCom.Dat stores a Move Out date, but:");
console.log("  - not linked to unit in mirror export (only correlatable by prior move-in date)");
console.log("  - date aligns with 06/23 batch processing, not physical departure (Kevin proves drift)");
console.log("  - NOT safe for canonical occupancy_move_out_recorded without office confirming LH semantics");
console.log("  LG.Dat = legal notices; H.Dat code-2 = rent reversal; seg11 = move-in only");
