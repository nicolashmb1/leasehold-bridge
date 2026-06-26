import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnitMasterDat } from "../src/parsers/parseUnitMasterDat.js";

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
});
