/**
 * Which properties send money-out and deposit signals.
 *
 * The office syncs all five buildings, and the money path runs per property —
 * so without a gate the first office run after this ships would import cheques
 * and deposits for four buildings nobody has validated. Their payees are not
 * mapped, so "always post, flag for review" would auto-create hundreds of
 * vendor records; their property-specific 1xxx codes (partner ledgers,
 * construction) are mapped for MORRIS only, so those cheques would fail.
 *
 * That is the opposite of the owner's rule: prove one building end to end,
 * then expand. Same shape as `ledgerMimicPilot.js`, which gates the ledger
 * mimic for the same reason.
 *
 * **Before adding a property here:** seed its payee map and its property-scoped
 * account map, and check the deposit tenancy boundaries report no problems.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../../config/money-path-pilot.json");

let cached = null;

function loadConfig() {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    // Missing or unreadable config means off. A money path that silently
    // switches itself on is worse than one that stays quiet.
    cached = { enabled: false, properties: [] };
  }
  return cached;
}

/** @param {string} propertyCode */
export function isMoneyPathPilotProperty(propertyCode) {
  const cfg = loadConfig();
  if (!cfg?.enabled) return false;
  const code = String(propertyCode ?? "").trim().toUpperCase();
  if (!code) return false;
  const allowed = Array.isArray(cfg.properties) ? cfg.properties : [];
  return allowed.map((p) => String(p).trim().toUpperCase()).includes(code);
}

/**
 * YYYY-MM-DD floor for bank_deposit_batch signals (End-Batch#).
 * Must match Propera cash_live_from for that property. Missing → no batches
 * (fail closed; do not emit full D.Dat history).
 * @param {string} propertyCode
 * @returns {string|null}
 */
export function bankBatchFromDate(propertyCode) {
  const cfg = loadConfig();
  const code = String(propertyCode ?? "").trim().toUpperCase();
  if (!code) return null;
  const map = cfg?.bank_batch_from && typeof cfg.bank_batch_from === "object" ? cfg.bank_batch_from : null;
  if (!map) return null;
  const raw = map[code] ?? map[propertyCode];
  const s = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function resetMoneyPathPilotConfigCache() {
  cached = null;
}
