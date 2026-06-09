/** Map Leasehold posted-line text to a stable ancillary category. */

const CATEGORY_LABELS = {
  water: "Water",
  parking: "Parking",
  pet: "Pet fee (monthly)",
  pet_deposit: "Pet deposit",
  storage: "Storage",
  electric: "Electric",
  gas: "Gas",
  admin: "Admin fee",
  late_fee: "Late fee",
  fine: "Fine / legal",
  other_monthly: "Other monthly",
  other_charge: "Other charge",
};

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category ?? "Other";
}

export function classifyLeaseholdCharge(record) {
  if (!record || record.kind === "payment") return null;

  const kind = String(record.kind ?? "").toLowerCase();
  const label = String(record.charge_label ?? record.description ?? "").trim();
  const upper = label.toUpperCase();

  if (kind === "billing") return null;
  if (upper === "ADJ" || kind === "adjustment") return null;
  if (/\bRENT\b/.test(upper) && !/\bDEPOSIT\b/.test(upper)) return null;
  if (kind === "late_fee" || /\bLATE\s*FEE\b/.test(upper)) {
    return { category: "late_fee", label: label || "Late fee", recurring: false };
  }
  if (/\bWATER\b/.test(upper)) {
    return { category: "water", label: "Water", recurring: true };
  }
  if (/\bPARKING\b|\bPARK\b/.test(upper)) {
    return { category: "parking", label: upper.includes("SPOT") ? "Parking spot" : "Parking", recurring: true };
  }
  if (/\bPET\b/.test(upper)) {
    if (/\bFINE\b/.test(upper)) {
      return { category: "fine", label: label || "Pet fine", recurring: false };
    }
    // Leasehold may post as PET FEE or PET DEPOSIT — both are one-time, non-refundable pet deposit.
    return { category: "pet_deposit", label: "Pet deposit", recurring: false };
  }
  if (/\bSTORAGE\b/.test(upper)) {
    return { category: "storage", label: "Storage", recurring: true };
  }
  if (/\bADMIN\s*FEE\b/.test(upper)) {
    return { category: "admin", label: "Admin fee", recurring: true };
  }
  if (/\bELECTRIC\b/.test(upper)) {
    return { category: "electric", label: "Electric", recurring: true };
  }
  if (/\bGAS\b/.test(upper)) {
    return { category: "gas", label: "Gas", recurring: true };
  }
  if (/\bLEGAL\b|\bCOURT\b|\bNSF\b|\bPROFSERV\b|\bCOLLECT\b|\bFINE\b|\bFUMIGATE\b/.test(upper)) {
    return { category: "fine", label: label || "Fine / legal", recurring: false };
  }
  if (/\bKEY\b|\bFOB\b|\bFOBS\b/.test(upper)) {
    return { category: "other_charge", label: label || "Key / FOB", recurring: false };
  }
  if (/\bOTHER\s*CHG\b/.test(upper)) {
    return { category: "other_charge", label: "Other charge", recurring: false };
  }
  if (kind === "charge" || kind === "other") {
    return { category: "other_charge", label: label || "Other charge", recurring: false };
  }
  return null;
}
