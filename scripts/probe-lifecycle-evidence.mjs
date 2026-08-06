#!/usr/bin/env node
/**
 * Report RN/OC lifecycle evidence files per property (staging or lhmirror).
 * Usage: node scripts/probe-lifecycle-evidence.mjs [--property PENN]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { resolveMirrorRoot } from "../src/lib/mirrorRoot.js";
import { extractExplicitLifecycleEvents } from "../src/signals/extractExplicitLifecycleEvents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filterProperty = (() => {
  const i = process.argv.indexOf("--property");
  return i >= 0 ? String(process.argv[i + 1] || "").trim().toUpperCase() : "";
})();

const mapping = loadPropertyMapping();
const mirrorRoot = resolveMirrorRoot();
const properties = mapping.properties.filter(
  (p) => p.import_enabled && (!filterProperty || p.propera_property_code === filterProperty)
);

console.log(`Mirror root: ${mirrorRoot}`);
console.log("");

for (const property of properties) {
  const ra = property.leasehold_ra_group;
  const pc = property.propera_property_code;
  const rnPath = path.join(mirrorRoot, `${ra}RN.DAT`);
  const ocPath = path.join(mirrorRoot, `${ra}OC.DAT`);
  const nrPath = path.join(mirrorRoot, `${ra}NR.DAT`);
  const erPath = path.join(mirrorRoot, `${ra}ER.DAT`);
  const rnStat = fs.existsSync(rnPath) ? fs.statSync(rnPath) : null;
  const ocStat = fs.existsSync(ocPath) ? fs.statSync(ocPath) : null;
  const nrStat = fs.existsSync(nrPath) ? fs.statSync(nrPath) : null;
  const erStat = fs.existsSync(erPath) ? fs.statSync(erPath) : null;
  const extracted = extractExplicitLifecycleEvents({
    mirrorRoot,
    raGroup: ra,
    properaPropertyCode: pc,
  });

  console.log(`${pc} (${ra})`);
  console.log(
    `  RN: ${rnStat ? `${rnStat.size} bytes, mtime ${rnStat.mtime.toISOString()}` : "missing"} → ${extracted.probe.rn.parse_status}`
  );
  console.log(`  OC: ${ocStat ? `${ocStat.size} bytes` : "missing"}`);
  console.log(`  NR: ${nrStat ? `${nrStat.size} bytes` : "missing"}`);
  console.log(`  ER: ${erStat ? `${erStat.size} bytes` : "missing"}`);
  console.log(`  explicit_lifecycle_events: ${extracted.events.length}`);
  console.log("");
}
