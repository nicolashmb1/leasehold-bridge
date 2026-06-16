const DEFAULT_UNIT_CHARGE_LINES = [
  { type: "water", mode: "variable", amount_cents: null },
  { type: "electric", mode: "variable", amount_cents: null },
  { type: "gas", mode: "included", amount_cents: null },
  { type: "parking", mode: "none", amount_cents: null },
  { type: "pet_fee", mode: "none", amount_cents: null },
  { type: "storage", mode: "none", amount_cents: null },
];

const IMPORT_CATEGORY_TO_TYPE = {
  water: "water",
  parking: "parking",
  pet: "pet_fee",
  storage: "storage",
  electric: "electric",
  gas: "gas",
};

export function buildPrefilledChargeLines(ancillary) {
  const base = DEFAULT_UNIT_CHARGE_LINES.map((line) => ({ ...line }));

  const recurringPetCents = ancillary.find(
    (row) => row.category === "pet" && row.recurring && row.amount_cents != null && row.amount_cents > 0
  )?.amount_cents;
  const oneTimePetCents = ancillary.find(
    (row) =>
      (row.category === "pet_deposit" || (row.category === "pet" && !row.recurring)) &&
      row.amount_cents != null &&
      row.amount_cents > 0
  )?.amount_cents;

  const withoutMisclassifiedPet = base.map((line) => {
    if (line.type !== "pet_fee" || recurringPetCents != null || oneTimePetCents == null) return line;
    if (line.mode !== "fixed" && line.mode !== "variable") return line;
    if (line.amount_cents !== oneTimePetCents) return line;
    return { ...line, mode: "none", amount_cents: null };
  });

  const importCentsByType = new Map();
  for (const row of ancillary) {
    if (!row.recurring || row.amount_cents == null || row.amount_cents <= 0) continue;
    const type = IMPORT_CATEGORY_TO_TYPE[row.category];
    if (!type) continue;
    importCentsByType.set(type, row.amount_cents);
  }
  const storageCents = importCentsByType.get("storage");
  if (storageCents != null && importCentsByType.get("pet_fee") === storageCents) {
    importCentsByType.delete("pet_fee");
  }

  return withoutMisclassifiedPet.map((line) => {
    const imported = importCentsByType.get(line.type);
    if (imported == null) return line;
    const next = { ...line, amount_cents: imported };
    if (line.type === "water" || line.type === "electric") next.mode = "variable";
    else if (line.type === "parking" || line.type === "pet_fee" || line.type === "storage") {
      next.mode = "fixed";
    }
    return next;
  });
}
