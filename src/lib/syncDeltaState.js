import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintLeaseTermsBody } from "../signals/leaseTermsIdempotency.js";
import { buildLeaseTermsBodyFromFact } from "../signals/leaseTermsBodyFromFact.js";
import { buildLedgerEventIdempotencyKey, lhPostedRowToSignalKind } from "../signals/buildLedgerEventSignals.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PILOT_CONFIG_PATH = path.join(PACKAGE_ROOT, "config", "sync-delta-pilot.json");
/**
 * Formerly capped at 120 keys/unit so the cursor stayed small next to the
 * summarizeTransactionsByUnit 12/80 trim. That pair meant catch-up could both
 * drop emission AND forget that older lines were already imported. Keep every
 * key we have seen; Set + JSON size is fine for Grand-scale units.
 */
const MAX_LEDGER_KEYS_PER_UNIT = Number.POSITIVE_INFINITY;

let pilotConfigCache = null;

function loadPilotConfig() {
  if (pilotConfigCache) return pilotConfigCache;
  try {
    const raw = JSON.parse(fs.readFileSync(PILOT_CONFIG_PATH, "utf8"));
    pilotConfigCache = {
      enabled: raw?.enabled === true,
      properties: new Set(
        (Array.isArray(raw?.properties) ? raw.properties : [])
          .map((p) => String(p).trim().toUpperCase())
          .filter(Boolean)
      ),
    };
  } catch {
    pilotConfigCache = { enabled: false, properties: new Set() };
  }
  return pilotConfigCache;
}

/** WESTFIELD-first: per-unit delta filtering only for listed properties. */
export function isSyncDeltaPilotProperty(propertyCode) {
  const cfg = loadPilotConfig();
  if (!cfg.enabled) return false;
  const code = String(propertyCode ?? "").trim().toUpperCase();
  return cfg.properties.has(code);
}

/**
 * @param {Record<string, unknown> | null | undefined} propertyCursor
 */
export function isDeltaBaselineSeeded(propertyCursor) {
  return Boolean(propertyCursor?.delta?.baselineSeededAt);
}

/**
 * Apply per-unit filters only after first successful seed import for this property.
 * @param {Record<string, unknown> | null | undefined} propertyCursor
 */
export function shouldFilterSignals(propertyCode, propertyCursor) {
  if (!isSyncDeltaPilotProperty(propertyCode)) return false;
  return isDeltaBaselineSeeded(propertyCursor);
}

/**
 * @param {Record<string, unknown> | null | undefined} propertyCursor
 * @returns {Record<string, { leaseTermsFp?: string; ledgerKeys?: string[] }>}
 */
export function readUnitDeltaMap(propertyCursor) {
  const units = propertyCursor?.delta?.units;
  if (!units || typeof units !== "object") return {};
  return units;
}

/**
 * @param {Array<Record<string, unknown>>} signals
 * @param {Record<string, { leaseTermsFp?: string }>} unitDeltaMap
 */
export function filterLeaseTermsSignalsByDelta(signals, unitDeltaMap) {
  const kept = [];
  let skippedUnchanged = 0;

  for (const signal of signals) {
    const unit = String(signal?.unit_label ?? "").trim();
    const fp = String(signal?.body ?? {}).length
      ? fingerprintLeaseTermsBody(signal.body ?? {})
      : "";
    const prev = unitDeltaMap[unit]?.leaseTermsFp;
    if (prev && prev === fp) {
      skippedUnchanged += 1;
      continue;
    }
    kept.push(signal);
  }

  return { signals: kept, skippedUnchanged };
}

/**
 * @param {Array<Record<string, unknown>>} signals
 * @param {Record<string, { ledgerKeys?: string[] }>} unitDeltaMap
 */
export function filterLedgerEventSignalsByDelta(signals, unitDeltaMap) {
  const kept = [];
  let skippedKnown = 0;

  for (const signal of signals) {
    const unit = String(signal?.unit_label ?? "").trim();
    const key = String(signal?.idempotency_key ?? "").trim();
    const known = new Set(unitDeltaMap[unit]?.ledgerKeys ?? []);
    if (key && known.has(key)) {
      skippedKnown += 1;
      continue;
    }
    kept.push(signal);
  }

  return { signals: kept, skippedKnown };
}

function ledgerKeyFromPostedRow(propertyCode, unitLabel, row) {
  const effectiveDate = String(row.date ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return null;

  const amountRaw = row.amount_cents;
  const amountCents =
    amountRaw == null || amountRaw === ""
      ? null
      : Number.isFinite(Number(amountRaw))
        ? Math.round(Number(amountRaw))
        : null;
  if (amountCents == null || amountCents === 0) return null;

  const signalKind = lhPostedRowToSignalKind(row);
  const description = String(row.description ?? row.kind ?? signalKind).trim().slice(0, 200);
  const balanceAfterCents =
    row.balance_after_cents != null && Number.isFinite(Number(row.balance_after_cents))
      ? Math.round(Number(row.balance_after_cents))
      : null;

  return buildLedgerEventIdempotencyKey({
    sourceSystem: "leasehold",
    propertyCode,
    unitLabel,
    effectiveDate,
    signalKind,
    amountCents,
    reference: row.reference,
    description,
    balanceAfterCents,
  });
}

/**
 * Build per-unit cursor from full export (not filtered signals).
 * @param {{ facts: Array<Record<string, unknown>>; propertyCode: string; syncedAt: string }} opts
 */
export function buildUnitDeltaMapFromFacts({ facts, propertyCode, syncedAt }) {
  const property = String(propertyCode ?? "").trim().toUpperCase();
  const effectiveAt = String(syncedAt ?? new Date().toISOString());
  /** @type {Record<string, { leaseTermsFp?: string; ledgerKeys: string[] }>} */
  const units = {};

  for (const fact of facts) {
    if (!fact || typeof fact !== "object") continue;
    const unitLabel = String(fact.unit_label ?? "").trim();
    if (!unitLabel) continue;

    if (!units[unitLabel]) {
      units[unitLabel] = { ledgerKeys: [] };
    }

    const built = buildLeaseTermsBodyFromFact(fact, effectiveAt);
    if (built?.body) {
      units[unitLabel].leaseTermsFp = fingerprintLeaseTermsBody(built.body);
    }

    const payload = fact.payload && typeof fact.payload === "object" ? fact.payload : {};
    const posted = Array.isArray(payload.posted_transactions) ? payload.posted_transactions : [];
    const keys = [];
    for (const row of posted) {
      const key = ledgerKeyFromPostedRow(property, unitLabel, row);
      if (key) keys.push(key);
    }
    units[unitLabel].ledgerKeys = trimLedgerKeys(keys);
  }

  return units;
}

function trimLedgerKeys(keys) {
  if (!Number.isFinite(MAX_LEDGER_KEYS_PER_UNIT)) return [...keys];
  return keys.slice(-MAX_LEDGER_KEYS_PER_UNIT);
}

/**
 * @param {Record<string, unknown> | null | undefined} propertyCursor
 * @param {Record<string, { leaseTermsFp?: string; ledgerKeys?: string[] }>} unitMap
 * @param {{ seedBaseline?: boolean }} opts
 */
export function mergePropertyDeltaCursor(propertyCursor, unitMap, opts = {}) {
  const prev = propertyCursor && typeof propertyCursor === "object" ? propertyCursor : {};
  const prevUnits = readUnitDeltaMap(prev);
  /** @type {Record<string, { leaseTermsFp?: string; ledgerKeys: string[] }>} */
  const mergedUnits = { ...prevUnits };

  for (const [unitLabel, next] of Object.entries(unitMap)) {
    const prevUnit = mergedUnits[unitLabel] ?? { ledgerKeys: [] };
    const ledgerSet = new Set(prevUnit.ledgerKeys ?? []);
    for (const key of next.ledgerKeys ?? []) {
      ledgerSet.add(key);
    }
    const ledgerKeys = trimLedgerKeys([...ledgerSet]);

    mergedUnits[unitLabel] = {
      leaseTermsFp: next.leaseTermsFp ?? prevUnit.leaseTermsFp,
      ledgerKeys,
    };
  }

  const delta = {
    ...(prev.delta && typeof prev.delta === "object" ? prev.delta : {}),
    units: mergedUnits,
  };

  if (opts.seedBaseline && !delta.baselineSeededAt) {
    delta.baselineSeededAt = new Date().toISOString();
  }

  return { ...prev, delta };
}
