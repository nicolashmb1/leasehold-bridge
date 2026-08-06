import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseRentNoticeDat } from "../src/parsers/parseRentNoticeDat.js";
import { extractExplicitLifecycleEvents } from "../src/signals/extractExplicitLifecycleEvents.js";
import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";
import { resolveMirrorRoot } from "../src/lib/mirrorRoot.js";

test("parseRentNoticeDat treats tiny RN files as empty stub", () => {
  const out = parseRentNoticeDat(Buffer.from("   \n  "));
  assert.equal(out.parse_status, "empty_stub");
  assert.deepEqual(out.records, []);
});

test("extractExplicitLifecycleEvents returns probe metadata", () => {
  const out = extractExplicitLifecycleEvents({
    mirrorRoot: "C:\\missing",
    raGroup: "RA9999",
    properaPropertyCode: "TEST",
  });
  assert.ok(out.probe?.rn);
  assert.deepEqual(out.events, []);
});

test("exportPropertySnapshots includes explicit_lifecycle_events array", () => {
  let mirrorRoot;
  try {
    mirrorRoot = resolveMirrorRoot();
  } catch {
    return;
  }
  const mapping = loadPropertyMapping();
  const property = mapping.properties.find((p) => p.propera_property_code === "WESTGRAND");
  if (!property) return;
  const required = `${property.leasehold_ra_group}H.Dat`;
  if (!fs.existsSync(path.join(mirrorRoot, required))) return;

  const result = exportPropertySnapshots({
    mapping,
    properaPropertyCode: "WESTGRAND",
    syncedAt: "2026-07-18T12:00:00.000Z",
  });
  assert.ok(Array.isArray(result.explicit_lifecycle_events));
  assert.ok(result.lifecycle_evidence_probe?.rn?.parse_status);
});
