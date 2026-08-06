/**
 * Parse Leasehold RA####RN.DAT (rent notice) when present.
 * Returns no records for empty/stub files until office confirms row layout.
 */

const MIN_PARSEABLE_BYTES = 128;

function ascii(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.toString("ascii") : String(buffer ?? "");
}

/**
 * @param {Buffer|string|null|undefined} buffer
 * @returns {{ records: Array<Record<string, unknown>>, parse_status: "missing" | "empty_stub" | "layout_unknown" | "parsed", byte_length: number }}
 */
export function parseRentNoticeDat(buffer) {
  if (buffer == null || (Buffer.isBuffer(buffer) && buffer.length === 0)) {
    return { records: [], parse_status: "missing", byte_length: 0 };
  }
  const text = ascii(buffer);
  const byteLength = Buffer.isBuffer(buffer) ? buffer.length : text.length;
  const nonWhitespace = text.replace(/\s/g, "");
  if (!nonWhitespace.length) {
    return { records: [], parse_status: "empty_stub", byte_length: byteLength };
  }
  if (byteLength < MIN_PARSEABLE_BYTES) {
    return { records: [], parse_status: "empty_stub", byte_length: byteLength };
  }

  // Row layout TBD — office must supply a RN sample with real notice rows.
  return { records: [], parse_status: "layout_unknown", byte_length: byteLength };
}
