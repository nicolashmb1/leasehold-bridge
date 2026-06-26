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
  /^(?:\d{3}\s+(?:WESTFIELD|WEST\b)|ELIZABETH\s+NJ\s+\d{5})/i;

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

function extractSeg3NameColumns(seg3Text) {
  const cols = seg3Text
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const names = [];
  for (const col of cols) {
    if (SEG3_ADDRESS_COLUMN_RE.test(col)) break;
    if (/\b(?:WESTFIELD|WEST)\b.*\b(?:AVE|AVENUE|ST)\b/i.test(col)) break;
    if (/\bELIZABETH\s+NJ\b/i.test(col)) break;
    if (/^\d{5}$/.test(col)) break;
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

function parseTenantName(segment2, segment3) {
  const seg2Text = readAscii(segment2, 0, SEGMENT_BYTES);
  const seg3Text = readAscii(segment3, 0, SEGMENT_BYTES);

  let seg2Cols = extractTrailingNameColumns(seg2Text);
  let seg3Cols = extractSeg3NameColumns(seg3Text);
  ({ seg2Cols, seg3Cols } = mergeCrossSegmentNameFragments(seg2Cols, seg3Cols));

  if (!seg2Cols.length && !seg3Cols.length) return null;

  const firstCol = seg2Cols[0] ?? "";
  const givenParts = firstCol.includes(" ")
    ? firstCol.split(/\s+/).filter(Boolean)
    : [firstCol].filter(Boolean);

  if (seg2Cols.length >= 2) {
    const second = seg2Cols[1].trim();
    // Skip 3-char junk fragments (e.g. "LIA" beside stale seg3 names on WESTFIELD 204).
    if (second.length > 3 && !second.includes(" ")) givenParts.push(second);
  }

  const givenFirst = givenParts[0]?.toUpperCase() ?? "";
  if (!seg3Cols.length) {
    const name = givenParts.join(" ").trim();
    return name || null;
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
  return name || null;
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
