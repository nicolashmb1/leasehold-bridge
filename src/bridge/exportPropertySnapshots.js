import { readMirrorFile, resolveMirrorRoot, tryReadMirrorFile } from "../lib/mirrorRoot.js";
import { getPropertyByCode } from "../lib/loadConfig.js";
import { parseUnitMasterDat } from "../parsers/parseUnitMasterDat.js";
import {
  parseTransactionStream,
  summarizeTransactionsByUnit,
} from "../parsers/parseTransactionStream.js";
import { parseDepositSummaryDat } from "../parsers/parseDepositSummaryDat.js";
import { parseDepositLedgerDat } from "../parsers/parseDepositLedgerDat.js";
import { summarizeDepositsByUnit } from "../normalize/deriveUnitDeposits.js";
import { toProperaFinancialFacts } from "../normalize/toProperaFinancialFacts.js";
import { parseGlYearFile } from "../parsers/parseGlYearFile.js";
import { buildDisbursementSignals } from "../signals/buildDisbursementSignals.js";
import { buildDepositSignals } from "../signals/buildDepositSignals.js";

/**
 * Money out and deposits come from the GL year files, not the tenant files the
 * rest of this export reads. The GL is the permanent book — nothing is ever
 * removed from it — which is why it is the source for both.
 *
 * Every year present is read on every sync. That is more work than a delta
 * would be, but both commands are idempotent on a domain key, so a re-read
 * costs time rather than correctness. Narrow it if it starts to hurt.
 */
function buildMoneyPathSignals({ mirrorRoot, property, propertyCode, stream }) {
  const prefix = property?.leasehold_accounting_prefix;
  if (!prefix) return { signals: [], problems: [], meta: { skipped: "no_accounting_prefix" } };

  let records = [];
  let yearsRead = 0;
  for (let yy = 13; yy <= 40; yy += 1) {
    const name = `${prefix}GL.Y${String(yy).padStart(2, "0")}`;
    const buf = tryReadMirrorFile(mirrorRoot, name);
    if (!buf) continue;
    yearsRead += 1;
    records = records.concat(parseGlYearFile(buf).records);
  }
  if (!records.length) return { signals: [], problems: [], meta: { skipped: "no_gl_files" } };

  // The primary tenancy boundary: where each unit's ledger restarts, because
  // Leasehold clears it at turnover. See docs/LH_GL_FILE_FORMAT.md 6.5.
  const tenancyStarts = {};
  for (const rec of stream?.records ?? []) {
    const unit = String(rec.unit_label ?? "").trim();
    if (!/^(\d{3}|STORE\d{1,3})$/i.test(unit)) continue;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(rec.date ?? ""));
    if (!m) continue;
    const iso = `${m[3]}-${m[1]}-${m[2]}`;
    if (!tenancyStarts[unit] || iso < tenancyStarts[unit]) tenancyStarts[unit] = iso;
  }

  const disbursements = buildDisbursementSignals(records, { propertyCode });
  const deposits = buildDepositSignals(records, { propertyCode, tenancyStarts, graceDays: 3 });

  return {
    signals: [...disbursements.signals, ...deposits.signals],
    problems: [...disbursements.problems, ...deposits.problems],
    meta: {
      years_read: yearsRead,
      gl_record_count: records.length,
      disbursement_signal_count: disbursements.signals.length,
      deposit_signal_count: deposits.signals.length,
      // Never silently dropped: a cheque with no destination or a unit whose
      // tenancy boundary is ambiguous is reported for a person to resolve.
      problem_count: disbursements.problems.length + deposits.problems.length,
    },
  };
}

export function exportPropertySnapshots({ mapping, properaPropertyCode, syncedAt }) {
  const property = getPropertyByCode(mapping, properaPropertyCode);
  const mirrorRoot = resolveMirrorRoot();
  const raGroup = property.leasehold_ra_group;

  const unitMasterBuffer = readMirrorFile(mirrorRoot, `${raGroup}.DAT`);
  const historyBuffer = readMirrorFile(mirrorRoot, `${raGroup}H.Dat`);

  const unitMaster = parseUnitMasterDat(unitMasterBuffer);
  const stream = parseTransactionStream(historyBuffer);
  const txSummary = summarizeTransactionsByUnit(stream.records);

  const summaryBuffer = tryReadMirrorFile(mirrorRoot, `${raGroup}S.Dat`);
  const ledgerBuffer = tryReadMirrorFile(mirrorRoot, `${raGroup}R.Dat`);
  const depositSummary = summaryBuffer ? parseDepositSummaryDat(summaryBuffer) : null;
  const depositLedger = ledgerBuffer ? parseDepositLedgerDat(ledgerBuffer) : null;
  // Full LH label (e.g. STORE1) — do not slice to 3 chars or commercial units collide/miss.
  const unitMasterByLabel = new Map(
    unitMaster.units.map((unit) => [String(unit.unit_label).trim(), unit])
  );
  const depositsByUnit = summarizeDepositsByUnit({
    summaryByUnit: depositSummary?.byUnit ?? null,
    ledgerByUnit: depositLedger?.byUnit ?? null,
    unitMasterByLabel,
  });

  const facts = toProperaFinancialFacts({
    property,
    unitMaster,
    transactionSummary: txSummary,
    depositsByUnit,
    syncedAt: syncedAt ?? new Date().toISOString(),
    mirrorRoot,
  });

  const moneyPath = buildMoneyPathSignals({
    mirrorRoot,
    property,
    propertyCode: properaPropertyCode,
    stream,
  });

  return {
    property,
    mirror_root: mirrorRoot,
    unit_master: unitMaster,
    transaction_record_count: stream.record_count,
    facts,
    money_path_signals: moneyPath.signals,
    money_path_problems: moneyPath.problems,
    money_path_meta: moneyPath.meta,
  };
}
