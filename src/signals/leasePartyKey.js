/** Lease party normalization — matches propera-v2 leasePartyKey.js (Stage 2). */

import { formatPersonDisplayName } from "./personDisplayName.js";

export function normalizePartyKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} fullName
 * @param {string} [role]
 */
export function buildPartiesFromName(fullName, role = "responsible") {
  const name = formatPersonDisplayName(fullName);
  if (!name) return [];
  return [{ full_name: name, role, is_primary: true }];
}
