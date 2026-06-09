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

const ADDRESS_MARKERS_RE = /(STREET|AVENUE|ELIZABETH|WEST GRAND|WESTFIELD|MURRAY|MORRIS|PENN|LLC|\d{5})/i;

function splitFusedNameToken(token) {
  const text = String(token || "").trim();
  if (!text || /\s/.test(text) || text.length < 10) return [text].filter(Boolean);

  const mixedCase = text.match(/^([A-Za-z]+?)([A-Z][a-z].*)$/);
  if (mixedCase) return [mixedCase[1].trim(), mixedCase[2].trim()];

  const allCaps = text.match(/^([A-Z]{3,})([A-Z]{3,})$/);
  if (allCaps) return [allCaps[1].trim(), allCaps[2].trim()];

  return [text];
}

function parseTenantName(segment2, segment3) {
  const combined = readAscii(segment2, 0, SEGMENT_BYTES) + readAscii(segment3, 0, SEGMENT_BYTES);
  const text = combined.replace(/^[\d.\s]+/, "");
  let columns = text
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && /[A-Za-z]/.test(part) && !ADDRESS_MARKERS_RE.test(part));

  if (!columns.length) return null;

  if (columns.length === 1) {
    columns = splitFusedNameToken(columns[0]);
  }

  const parts = [];
  for (const column of columns) {
    if (column.includes(" ")) {
      parts.push(column);
      continue;
    }
    parts.push(column);
    if (parts.length >= 3) break;
  }

  const normalized = parts.flatMap((part) => (part.includes(" ") ? [part] : [part])).filter(Boolean);
  if (!normalized.length) return null;
  if (normalized.length === 1) return normalized[0];

  const first = normalized[0];
  const second = normalized[1];
  if (second.includes(" ")) return `${first} ${second.split(/\s+/)[0]}`.trim();

  if (normalized.length >= 3 && !normalized[2].includes(" ")) {
    return `${first} ${second} ${normalized[2]}`.trim();
  }

  return `${first} ${second}`.trim();
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
