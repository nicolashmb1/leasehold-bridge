import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnitMasterDat, sanitizeTenantDisplayName } from "../src/parsers/parseUnitMasterDat.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplePath = path.join(PACKAGE_ROOT, "lhmirror", "RA0001.DAT");

test("parseUnitMasterDat finds 22 units in RA0001", () => {
  const buffer = fs.readFileSync(samplePath);
  const parsed = parseUnitMasterDat(buffer);
  assert.equal(parsed.unit_count, 22);
  assert.equal(parsed.units[0].unit_label, "101");
  assert.equal(parsed.units[0].rent_dollars, 1413);
  assert.equal(parsed.units[0].lease_end, "05/31/2027");
});

test("parseUnitMasterDat extracts first and last name for unit 101", () => {
  const buffer = fs.readFileSync(samplePath);
  const parsed = parseUnitMasterDat(buffer);
  const unit101 = parsed.units.find((u) => u.unit_label === "101");
  assert.ok(unit101);
  assert.equal(unit101.tenant_name, "JACOB PADUANO");
});

test("parseUnitMasterDat extracts full name for unit 205", () => {
  const buffer = fs.readFileSync(samplePath);
  const parsed = parseUnitMasterDat(buffer);
  const unit205 = parsed.units.find((u) => u.unit_label === "205");
  assert.ok(unit205);
  assert.equal(unit205.tenant_name, "MARIA REYES SERRANO");
});

test("parseUnitMasterDat extracts full name for unit 407", () => {
  const buffer = fs.readFileSync(samplePath);
  const parsed = parseUnitMasterDat(buffer);
  const unit407 = parsed.units.find((u) => u.unit_label === "407");
  assert.ok(unit407);
  assert.equal(unit407.tenant_name, "ANTHONY FERREIRA");
});

test("parseUnitMasterDat WESTFIELD RA0003 — leaseholder names from seg2 given + seg3 surname", () => {
  const westfieldPath = path.join(PACKAGE_ROOT, "lhmirror", "RA0003.DAT");
  const buffer = fs.readFileSync(westfieldPath);
  const parsed = parseUnitMasterDat(buffer);
  const byLabel = (lab) => parsed.units.find((u) => String(u.unit_label).trim().slice(0, 3) === lab);

  assert.equal(byLabel("204")?.tenant_name, "GABRIEL GARCIA");
  assert.equal(byLabel("209")?.tenant_name, "ELIZABETH ARBOLEDA");
  assert.equal(byLabel("207")?.tenant_name, "SUZETTE NEWBORN");
  assert.equal(byLabel("201")?.tenant_name, "JUAN NOVA");
  assert.equal(byLabel("301")?.tenant_name, "JOSE MARIA CEVALLOS");
  assert.equal(byLabel("210")?.tenant_name, "JASON M MONTALVO");
  assert.equal(byLabel("205")?.tenant_name, "NATHANIEL PALMER");
  assert.equal(byLabel("304")?.tenant_name, "JOSE GOMEZ");
  assert.equal(byLabel("307")?.tenant_name, "ELSA PAZMINO");
  assert.equal(byLabel("305")?.tenant_name, "JESSICA PAOLA GRANADOS FLORES");
});

test("sanitizeTenantDisplayName strips 702 PENNSYLVANIA address fused into name", () => {
  assert.equal(sanitizeTenantDisplayName("JILL 702 PENNSYLVANIA AVENUE"), "JILL");
  assert.equal(sanitizeTenantDisplayName("BRUNO 702 PENNSYLVANIA AVENUE"), "BRUNO");
  assert.equal(sanitizeTenantDisplayName("JULIANO 702 PENNSYLVANIA AVENUE"), "JULIANO");
  assert.equal(sanitizeTenantDisplayName("GABRIEL GARCIA"), "GABRIEL GARCIA");
});

test("sanitizeTenantDisplayName strips Murray and Morris address tails", () => {
  assert.equal(sanitizeTenantDisplayName("MARIA 57-77 MURRAY STREET"), "MARIA");
  assert.equal(sanitizeTenantDisplayName("JOSE 57-77 MURRAY ST"), "JOSE");
  assert.equal(sanitizeTenantDisplayName("ANA 540 MORRIS AVE"), "ANA");
  assert.equal(sanitizeTenantDisplayName("LUIS 540 MORRIS AVENUE"), "LUIS");
});

test("parseUnitMasterDat MURRAY RA0005 — includes commercial STORE1 plus apartments", () => {
  const murrayPath = path.join(PACKAGE_ROOT, "lhmirror", "RA0005.DAT");
  assert.ok(fs.existsSync(murrayPath), `missing fixture ${murrayPath}`);
  const buffer = fs.readFileSync(murrayPath);
  const parsed = parseUnitMasterDat(buffer);
  const store1 = parsed.units.find((u) => String(u.unit_label).trim().toUpperCase() === "STORE1");
  assert.ok(store1, "expected STORE1 commercial unit");
  assert.equal(String(store1.unit_label).trim(), "STORE1");
  assert.ok(
    parsed.unit_count >= 84,
    `expected ≥84 Murray units including STORE1, got ${parsed.unit_count}`
  );
  const apartments = parsed.units.filter((u) => /^\d{3}$/.test(String(u.unit_label).trim()));
  assert.ok(apartments.length >= 83, `expected ≥83 numeric apartments, got ${apartments.length}`);
  assert.ok(
    store1.tenant_name && /JACKSON|CHERRY/i.test(store1.tenant_name),
    `unexpected STORE1 tenant_name: ${store1.tenant_name}`
  );
  assert.ok(
    store1.rent_dollars == null || Number(store1.rent_dollars) > 0,
    "STORE1 should have rent when present on master"
  );
});
