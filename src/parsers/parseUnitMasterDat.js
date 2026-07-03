import {
  buildRecurringChargesFromSegment1,
  parseRentSecurityFromSegment1,
} from "./parseUnitMasterRecurring.js";

const SEGMENT_BYTES = 133;
const SEGMENTS_PER_UNIT = 19;

const UNIT_START_RE = /^\d{3}\s+\d\.\d/;

function readAscii(buffer, start, end) {
  return buffer.subarray(start, end).toString("ascii");
}

function parseRentAmount(segment0, segment1Head) {
  const tail = readAscii(segment0, 110, SEGMENT_BYTES);
  const cont = readAscii(segment1Head, 0, 6);
  const merged = `${tail}${cont}`.replace(/[^\d.]/g, "");
  const n = Number.parseFloat(merged);
  return Number.isFinite(n) ? n : null;
}

function parseBalanceFromSegment1(segment1) {
  const text = readAscii(segment1, 0, SEGMENT_BYTES);
  const matches = text.match(/-?\d+\.\d+/g);
  if (!matches?.length) return null;
  const n = Number.parseFloat(matches[matches.length - 1]);
  return Number.isFinite(n) ? n : null;
}

const SEG3_ADDRESS_COLUMN_RE =
  /^(?:\d{2,3}-\d{2,3}\s+MURRAY|\d{3}\s+(?:WESTFIELD|WEST\b|PENNSYLVANIA|PENN\b|MORRIS|GRAND)|ELIZABETH\s+NJ\s+\d{5})/i;

const STREET_TOKEN_AFTER_NUMBER =
  /^(?:PENNSYLVANIA|PENN|WESTFIELD|WEST|MURRAY|MORRIS|GRAND|AVE|AVENUE|ST|STREET|ELIZABETH)/i;

const EMBEDDED_ADDRESS_TAIL_PATTERNS = [
  /\s+\d{3}\s+PENNSYLVANIA(?:\s+(?:AVENUE|AVE\.?))?.*$/i,
  /\s+\d{3}\s+PENN(?:\s+|$).*/i,
  /\s+\d{3}\s+(?:WESTFIELD|WEST)\b.*$/i,
  /\s+\d{2,3}-\d{2,3}\s+MURRAY(?:\s+(?:ST|STREET))?.*$/i,
  /\s+\d{3}\s+MORRIS(?:\s+(?:AVE|AVENUE))?.*$/i,
  /\s+\d{3}\s+(?:WEST\s+)?GRAND(?:\s+(?:ST|STREET))?.*$/i,
];

/** Strip property address tail accidentally fused into a name column. */
export function sanitizeTenantDisplayName(name) {
  let text = String(name ?? "").trim();
  if (!text) return null;
  for (const re of EMBEDDED_ADDRESS_TAIL_PATTERNS) {
    text = text.replace(re, "");
  }
  text = text.trim();
  return text || null;
}

function extractNameTokensStoppingAtAddress(text) {
  const tokens = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (
      (/^\d{3}$/.test(tok) || /^\d{2,3}-\d{2,3}$/.test(tok)) &&
      i + 1 < tokens.length
    ) {
      const next = tokens[i + 1].toUpperCase();
      if (STREET_TOKEN_AFTER_NUMBER.test(next)) break;
    }
    if (looksLikeAddressCol(tok)) break;
    out.push(tok);
  }
  return out;
}

function extractTrailingNameColumns(seg2Text) {
  const cols = seg2Text
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const names = [];
  for (let i = cols.length - 1; i >= 0 && names.length < 2; i -= 1) {
    const col = cols[i];
    if (/^[\d.]+$/.test(col)) continue;
    if (/^[A-Za-z]/.test(col) && !/^[\d.]+/.test(col)) {
      names.unshift(col);
    } else {
      break;
    }
  }
  return names;
}

function looksLikeAddressCol(col) {
  if (!col) return true;
  if (SEG3_ADDRESS_COLUMN_RE.test(col)) return true;
  if (/\b\d{3}\s+PENNSYLVANIA\b/i.test(col)) return true;
  if (/\bPENNSYLVANIA\s+(?:AVENUE|AVE\.?)\b/i.test(col)) return true;
  if (/\b\d{2,3}-\d{2,3}\s+MURRAY\b/i.test(col)) return true;
  if (/\bMURRAY\s+(?:ST|STREET)\b/i.test(col)) return true;
  if (/\b\d{3}\s+MORRIS\b/i.test(col)) return true;
  if (/\bMORRIS\s+(?:AVE|AVENUE)\b/i.test(col)) return true;
  if (/\b\d{3}\s+(?:WEST\s+)?GRAND\b/i.test(col)) return true;
  if (/\b(?:WESTFIELD|WEST)\b.*\b(?:AVE|AVENUE|ST)\b/i.test(col)) return true;
  if (/\bELIZABETH\s+NJ\b/i.test(col)) return true;
  if (/^\d{5}$/.test(col)) return true;
  if (/^\d{3}$/.test(col)) return true;
  if (/^\d{2,3}-\d{2,3}$/.test(col)) return true;
  return false;
}

function extractSeg3NameColumns(seg3Text) {
  const cols = seg3Text
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const names = [];
  for (const col of cols) {
    if (looksLikeAddressCol(col)) break;
    if (/[A-Za-z]/.test(col)) names.push(col);
  }
  return names;
}

/** Merge name fragments split across segment 2/3 column boundary (e.g. ASHL + EY → ASHLEY). */
function mergeCrossSegmentNameFragments(seg2Cols, seg3Cols) {
  if (!seg2Cols.length || !seg3Cols.length) return { seg2Cols, seg3Cols };

  const lastSeg2 = seg2Cols[seg2Cols.length - 1];
  const firstSeg3 = seg3Cols[0];
  const lastTok = lastSeg2.split(/\s+/).pop() ?? "";
  const firstTok = firstSeg3.split(/\s+/)[0] ?? "";

  const shouldMerge =
    lastTok.length > 0 &&
    firstTok.length > 0 &&
    /^[A-Z]+$/.test(lastTok + firstTok) &&
    ((lastTok.length <= 2 && firstTok.length <= 4) ||
      (lastTok.length === 3 && firstTok.length <= 2) ||
      (lastTok.length === 4 && firstTok.length <= 2));

  if (shouldMerge) {
    const merged = lastTok + firstTok;
    const lastColParts = lastSeg2.split(/\s+/);
    lastColParts[lastColParts.length - 1] = merged;
    const nextSeg2 = [...seg2Cols];
    nextSeg2[nextSeg2.length - 1] = lastColParts.join(" ");
    const restSeg3 = firstSeg3.slice(firstTok.length).trim();
    const nextSeg3 = restSeg3 ? [restSeg3, ...seg3Cols.slice(1)] : seg3Cols.slice(1);
    return { seg2Cols: nextSeg2, seg3Cols: nextSeg3 };
  }

  return { seg2Cols, seg3Cols };
}

function isNameContinuationFragment(col) {
  const text = String(col ?? "").trim();
  if (!text) return true;
  if (text.length <= 3) return true;
  return /^[A-Z](\s+[A-Z])?$/.test(text);
}

function parsePrimaryCoTenantName(seg2Cols, seg3Cols) {
  const tenant1Given = seg2Cols[0]?.trim();
  if (!tenant1Given) return null;

  // Variant B: tenant 2 first name is the last token in the sole seg2 column (e.g. 305:
  // "JESSICA PAOLA TED" + seg3 "LOUIS" / "GRANADOS FLORES" / "MERCED").
  if (seg2Cols.length === 1 && seg3Cols.length >= 3) {
    const parts = tenant1Given.split(/\s+/).filter(Boolean);
    const tenant1Surname = seg3Cols[1]?.trim();
    if (
      parts.length >= 2 &&
      tenant1Surname &&
      !looksLikeAddressCol(seg3Cols[2]) &&
      !isNameContinuationFragment(seg3Cols[0])
    ) {
      const tenant1GivenOnly = parts.slice(0, -1).join(" ");
      return `${tenant1GivenOnly} ${tenant1Surname}`.trim();
    }
  }

  if (seg2Cols.length < 2 || seg3Cols.length < 2) return null;

  const surname1 = seg3Cols[1]?.trim().split(/\s+/)[0];
  if (seg3Cols.length >= 3 && surname1 && !looksLikeAddressCol(seg3Cols[2])) {
    // Two leaseholders: seg2[1]+seg3[0] is tenant 2 given; seg3[1] is tenant 1 surname.
    return `${tenant1Given} ${surname1}`.trim();
  }

  if (seg3Cols[0] === seg3Cols[1]) {
    return `${tenant1Given} ${seg3Cols[0]}`.trim();
  }

  if (
    seg3Cols.length === 2 &&
    !isNameContinuationFragment(seg3Cols[0]) &&
    !looksLikeAddressCol(seg3Cols[1])
  ) {
    return `${tenant1Given} ${seg3Cols[0]}`.trim();
  }

  return null;
}

function parseTenantName(segment2, segment3) {
  const seg2Text = readAscii(segment2, 0, SEGMENT_BYTES);
  const seg3Text = readAscii(segment3, 0, SEGMENT_BYTES);

  let seg2Cols = extractTrailingNameColumns(seg2Text);
  let seg3Cols = extractSeg3NameColumns(seg3Text);
  ({ seg2Cols, seg3Cols } = mergeCrossSegmentNameFragments(seg2Cols, seg3Cols));

  if (!seg2Cols.length && !seg3Cols.length) return null;

  const coTenantName = parsePrimaryCoTenantName(seg2Cols, seg3Cols);
  if (coTenantName) return sanitizeTenantDisplayName(coTenantName);

  const firstCol = seg2Cols[0] ?? "";
  const givenParts = firstCol.includes(" ")
    ? extractNameTokensStoppingAtAddress(firstCol)
    : [firstCol].filter(Boolean);

  if (seg2Cols.length >= 2) {
    const second = seg2Cols[1].trim();
    // Skip 3-char junk fragments (e.g. "LIA" beside stale seg3 names on WESTFIELD 204).
    if (second.length > 3 && !second.includes(" ")) givenParts.push(second);
  }

  const givenFirst = givenParts[0]?.toUpperCase() ?? "";
  if (!seg3Cols.length) {
    const name = givenParts.join(" ").trim();
    return sanitizeTenantDisplayName(name);
  }

  let surnameToken = seg3Cols[0].split(/\s+/)[0];
  if (seg3Cols.length >= 3 && givenFirst) {
    const col0First = seg3Cols[0].split(/\s+/)[0]?.toUpperCase() ?? "";
    // Three+ name columns: col 0 is often a stale prior tenant first name (WESTFIELD 204).
    if (col0First && givenFirst !== col0First) {
      surnameToken = seg3Cols[1].split(/\s+/)[0];
    }
  }

  const parts = [...givenParts, surnameToken].filter(Boolean);
  const name = parts.join(" ").trim();
  return sanitizeTenantDisplayName(name);
}

function parseUnitBlock(buffer, segmentIndex) {
  const offset = segmentIndex * SEGMENT_BYTES;
  const block = buffer.subarray(offset, offset + SEGMENTS_PER_UNIT * SEGMENT_BYTES);
  if (block.length < SEGMENTS_PER_UNIT * SEGMENT_BYTES) return null;

  const segment0 = block.subarray(0, SEGMENT_BYTES);
  const segment1 = block.subarray(SEGMENT_BYTES, SEGMENT_BYTES * 2);
  const segment2 = block.subarray(SEGMENT_BYTES * 2, SEGMENT_BYTES * 3);
  const segment3 = block.subarray(SEGMENT_BYTES * 3, SEGMENT_BYTES * 4);

  const head = readAscii(segment0, 0, 20);
  if (!UNIT_START_RE.test(head)) return null;

  const unitLabel = readAscii(segment0, 0, 10).trim();
  const segment0Text = readAscii(segment0, 0, SEGMENT_BYTES);
  const leaseMatch = segment0Text.match(/(\d{2}\/\d{2}\/\d{4})RD\s*(\d{2}\/\d{2}\/\d{4})/);

  return {
    unit_label: unitLabel,
    lease_start: leaseMatch?.[1] ?? null,
    lease_end: leaseMatch?.[2] ?? null,
    rent_dollars: parseRentAmount(segment0, segment1),
    balance_due_dollars: parseBalanceFromSegment1(segment1),
    rent_security_dollars: parseRentSecurityFromSegment1(segment1),
    tenant_name: parseTenantName(segment2, segment3),
    phones: readAscii(segment0, 14, 44).replace(/\s+/g, " ").trim() || null,
    segment_index: segmentIndex,
    segment1,
    recurring_charges: buildRecurringChargesFromSegment1(segment1),
  };
}

export function parseUnitMasterDat(buffer) {
  const totalSegments = Math.floor(buffer.length / SEGMENT_BYTES);
  const units = [];

  for (let seg = 0; seg < totalSegments; seg += 1) {
    const head = readAscii(buffer, seg * SEGMENT_BYTES, seg * SEGMENT_BYTES + 20);
    if (!UNIT_START_RE.test(head)) continue;
    const parsed = parseUnitBlock(buffer, seg);
    if (parsed) units.push(parsed);
  }

  return {
    segment_bytes: SEGMENT_BYTES,
    segments_per_unit: SEGMENTS_PER_UNIT,
    unit_count: units.length,
    units,
  };
}
