import { loadPropertyMapping } from "../src/lib/loadConfig.js";
import { exportPropertySnapshots } from "../src/bridge/exportPropertySnapshots.js";
import { validateUnitLedgerMath } from "../src/lib/validateLedgerMath.js";

function main() {
  const mapping = loadPropertyMapping();
  const enabled = mapping.properties.filter((p) => p.import_enabled && p.propera_property_code);
  const syncedAt = new Date().toISOString();
  const propertyResults = [];
  let totalUnits = 0;
  let chainFailUnits = 0;
  let stampMismatchUnits = 0;
  let perfectUnits = 0;

  for (const property of enabled) {
    const code = property.propera_property_code;
    const result = exportPropertySnapshots({ mapping, properaPropertyCode: code, syncedAt });
    const unitResults = [];

    for (const fact of result.facts) {
      totalUnits += 1;
      const posted = fact.payload?.posted_transactions ?? [];
      const report = validateUnitLedgerMath(posted, fact.balance_cents);
      if (!report.ok) chainFailUnits += 1;
      if (report.stampMismatches > 0) stampMismatchUnits += 1;
      if (report.ok && report.stampMismatches === 0) perfectUnits += 1;
      unitResults.push({ unit: fact.unit_label, ...report });
    }

    const failed = unitResults.filter((u) => !u.ok);
    const drift = unitResults.filter((u) => u.stampMismatches > 0);
    const worst = [...drift].sort((a, b) => b.stampMismatches - a.stampMismatches).slice(0, 5);

    propertyResults.push({
      property: code,
      ra: property.leasehold_ra_group,
      unitCount: unitResults.length,
      perfect: unitResults.filter((u) => u.stampMismatches === 0).length,
      chainFails: failed.length,
      stampDrift: drift.length,
      worstDrift: worst.map((u) => `${u.unit}(${u.stampMismatches}/${u.rowCount})`),
      failedUnits: failed.map((u) => u.unit),
    });
  }

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          totalUnits,
          perfectUnits,
          chainFailUnits,
          stampMismatchUnits,
          propertyResults,
        },
        null,
        2
      )
    );
    process.exit(chainFailUnits > 0 ? 1 : 0);
  }

  console.log("Ledger validation — all enabled properties\n");
  for (const p of propertyResults) {
    console.log(
      `${p.property} (${p.ra}) — ${p.unitCount} units | perfect: ${p.perfect} | stamp drift: ${p.stampDrift} | chain fails: ${p.chainFails}`
    );
    if (p.worstDrift.length) console.log(`  worst drift: ${p.worstDrift.join(", ")}`);
  }

  console.log(
    `\nTotal: ${totalUnits} units | perfect (0 drift): ${perfectUnits} | stamp drift: ${stampMismatchUnits} | chain fails: ${chainFailUnits}`
  );
  console.log(`Perfect rate: ${((perfectUnits / totalUnits) * 100).toFixed(1)}%`);

  if (chainFailUnits > 0) process.exit(1);
}

main();
