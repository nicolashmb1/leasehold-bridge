import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadPropertyMapping() {
  const filePath = path.join(PACKAGE_ROOT, "config", "property-mapping.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return raw;
}

export function getPropertyByCode(mapping, properaPropertyCode) {
  const code = String(properaPropertyCode || "").trim().toUpperCase();
  const row = (mapping.properties || []).find(
    (p) => String(p.propera_property_code || "").toUpperCase() === code
  );
  if (!row) {
    throw new Error(`Unknown Propera property code: ${code}`);
  }
  return row;
}

export function listImportEnabledProperties(mapping) {
  return (mapping.properties || []).filter((p) => p.import_enabled && p.propera_property_code);
}
