export function parseMoneyToCents(raw) {
  const text = String(raw ?? "").trim().replace(/,/g, "");
  if (!text || text === "-" || text === "-.") return null;
  const n = Number.parseFloat(text);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function parseLeaseholdDate(raw) {
  const text = String(raw ?? "").trim();
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}
