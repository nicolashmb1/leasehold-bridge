/** Pilot scope for Step 2 ledger mimic — expand units_by_property when validated. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../../config/ledger-mimic-pilot.json");

let cached = null;

function loadPilotConfig() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    cached = JSON.parse(raw);
  } catch {
    cached = { enabled: false, units_by_property: {} };
  }
  return cached;
}

/**
 * @param {string} propertyCode
 * @param {string} unitLabel
 */
export function isLedgerMimicPilotUnit(propertyCode, unitLabel) {
  const cfg = loadPilotConfig();
  if (!cfg?.enabled) return false;
  const property = String(propertyCode ?? "").trim().toUpperCase();
  const unit = String(unitLabel ?? "").trim();
  if (!property || !unit) return false;
  const allowed = cfg.units_by_property?.[property];
  if (!Array.isArray(allowed) || !allowed.length) return false;
  const normalized = allowed.map((u) => String(u).trim());
  if (normalized.includes("*")) return true;
  return normalized.includes(unit);
}

export function resetLedgerMimicPilotConfigCache() {
  cached = null;
}
