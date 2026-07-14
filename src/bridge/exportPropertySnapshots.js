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

  return {
    property,
    mirror_root: mirrorRoot,
    unit_master: unitMaster,
    transaction_record_count: stream.record_count,
    facts,
  };
}
