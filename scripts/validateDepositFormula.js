import { loadPropertyMapping, listImportEnabledProperties } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";
import { validatePropertyDepositFormula } from "../src/lib/validateDepositFormula.js";

function main() {
  const mapping = loadPropertyMapping();
  const enabled = listImportEnabledProperties(mapping);
  const syncedAt = new Date().toISOString();
  const propertyResults = [];
  let totalUnits = 0;
  let checkedUnits = 0;
  let failures = [];

  for (const property of enabled) {
    const code = property.propera_property_code;
    const result = exportPropertySnapshots({ mapping, properaPropertyCode: code, syncedAt });
    const report = validatePropertyDepositFormula(result.facts);
    totalUnits += report.unitCount;
    checkedUnits += report.checkedCount;
    failures = failures.concat(
      report.failures.map((row) => ({
        property: code,
        unit: row.unit,
        lhTotalCents: row.lhTotalCents,
        properaTotalCents: row.properaTotalCents,
      }))
    );
    propertyResults.push({
      property: code,
      ra: property.leasehold_ra_group,
      unitCount: report.unitCount,
      checked: report.checkedCount,
      ok: report.okCount,
      failed: report.failures.length,
    });
  }

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          totalUnits,
          checkedUnits,
          failureCount: failures.length,
          propertyResults,
          failures,
        },
        null,
        2
      )
    );
    process.exit(failures.length > 0 ? 1 : 0);
  }

  console.log("Deposit formula validation — all import-enabled properties\n");
  for (const row of propertyResults) {
    console.log(
      `${row.property} (${row.ra}) — ${row.unitCount} units | checked: ${row.checked} | ok: ${row.ok} | failed: ${row.failed}`
    );
  }
  console.log(
    `\nTotal: ${totalUnits} units | deposit rows checked: ${checkedUnits} | failures: ${failures.length}`
  );
  if (failures.length) {
    for (const row of failures.slice(0, 20)) {
      console.log(
        `  ${row.property} unit ${row.unit}: LH ${row.lhTotalCents} vs Propera ${row.properaTotalCents} (cents)`
      );
    }
    process.exit(1);
  }
}

main();
