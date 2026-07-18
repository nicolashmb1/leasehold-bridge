/**
 * Person display names — Leasehold / flat files often arrive as ALL CAPS.
 * Convert uniform-case names to title case; leave mixed-case staff edits alone.
 * Keep in sync with propera-v2 `src/brain/financial/personDisplayName.js`.
 */

const SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "da",
  "das",
  "de",
  "del",
  "di",
  "do",
  "dos",
  "e",
  "la",
  "las",
  "los",
  "of",
  "the",
  "van",
  "von",
  "y",
]);

export function isUniformLetterCase(raw) {
  const letters = String(raw || "").replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase() || letters === letters.toLowerCase();
}

function titleCasePart(part) {
  const s = String(part || "");
  if (!s) return s;
  if (s.includes("-")) {
    return s
      .split("-")
      .map((p) => titleCasePart(p))
      .join("-");
  }
  if (s.includes("'")) {
    return s
      .split("'")
      .map((p) => titleCasePart(p))
      .join("'");
  }
  const lower = s.toLowerCase();
  if (/^mc[a-z]{2,}/i.test(lower)) {
    return `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
  }
  if (/^mac[a-z]{3,}/i.test(lower) && !/^mac(h|k)/i.test(lower)) {
    return `Mac${lower.charAt(3).toUpperCase()}${lower.slice(4)}`;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function formatPersonDisplayName(raw) {
  const name = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name) return "";
  if (!isUniformLetterCase(name)) return name;

  return name
    .split(" ")
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return titleCasePart(word);
    })
    .join(" ");
}
