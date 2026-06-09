#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPropertyMapping, listImportEnabledProperties } from "../lib/loadConfig.js";
import { exportPropertySnapshots } from "../bridge/exportPropertySnapshots.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const args = { property: "WESTGRAND", format: "csv", out: null, stdout: false, all: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--property" || arg === "-p") {
      args.property = argv[++i];
    } else if (arg === "--all") {
      args.all = true;
    } else if (arg === "--format" || arg === "-f") {
      args.format = argv[++i];
    } else if (arg === "--out" || arg === "-o") {
      args.out = argv[++i];
    } else if (arg === "--stdout") {
      args.stdout = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function centsToDollars(cents) {
  if (cents == null || cents === "") return "";
  const n = Number(cents);
  return Number.isFinite(n) ? (n / 100).toFixed(2) : "";
}

function factsToCsv(facts) {
  const headers = [
    "propera_property_code",
    "unit_label",
    "tenant_name",
    "rent_dollars",
    "balance_dollars",
    "balance_status",
    "lease_start",
    "lease_end",
    "last_payment_at",
    "last_payment_dollars",
    "rent_cents",
    "balance_cents",
    "last_payment_cents",
    "synced_at",
  ];
  const lines = [headers.join(",")];
  for (const row of facts) {
    const enriched = {
      ...row,
      rent_dollars: centsToDollars(row.rent_cents),
      balance_dollars: centsToDollars(row.balance_cents),
      last_payment_dollars: centsToDollars(row.last_payment_cents),
    };
    lines.push(headers.map((h) => csvEscape(enriched[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function printHelp() {
  console.log(`Usage: npm run export -- [--property WESTGRAND] [--all] [--format csv|json] [--out path]

Exports normalized Propera financial snapshot facts from the Leasehold mirror.
Default property: WESTGRAND (RA0001). --all exports every import_enabled property in property-mapping.json.
`);
}

function buildJsonPayload(result) {
  return {
    property: result.property.propera_property_code,
    leasehold_ra_group: result.property.leasehold_ra_group,
    mirror_root: result.mirror_root,
    unit_count: result.unit_master.unit_count,
    transaction_record_count: result.transaction_record_count,
    facts: result.facts,
  };
}

function writeExport({ result, args, propertyCode }) {
  const payload = args.format === "json" ? buildJsonPayload(result) : null;

  if (args.stdout) {
    if (args.format === "json" && payload) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } else if (args.format === "csv") {
      process.stdout.write(factsToCsv(result.facts));
    } else {
      throw new Error(`Unsupported format for --stdout: ${args.format}`);
    }
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOut = path.join(
    PACKAGE_ROOT,
    "output",
    `${propertyCode.toLowerCase()}-snapshot-${stamp}.${args.format}`
  );
  const outPath = args.out && !args.all ? path.resolve(args.out) : defaultOut;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (args.format === "json" && payload) {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  } else if (args.format === "csv") {
    fs.writeFileSync(outPath, factsToCsv(result.facts));
  } else {
    throw new Error(`Unsupported format: ${args.format}`);
  }

  console.log(`Exported ${result.facts.length} units for ${propertyCode}`);
  console.log(`Mirror: ${result.mirror_root}`);
  console.log(`Output: ${outPath}`);
}

const args = parseArgs(process.argv);
if (args.help) {
  printHelp();
  process.exit(0);
}

const mapping = loadPropertyMapping();
const propertyCodes = args.all
  ? listImportEnabledProperties(mapping).map((row) => row.propera_property_code)
  : [args.property];

for (const propertyCode of propertyCodes) {
  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: propertyCode,
  });
  writeExport({ result, args, propertyCode });
}
