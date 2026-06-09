/** LH = Security + Other  ===  Propera = Security + Key + Pet + Other */

function centsToDollars(cents) {
  if (cents == null || cents === "") return 0;
  const n = Number(cents);
  return Number.isFinite(n) ? n / 100 : 0;
}

function readDepositCents(fact, field) {
  if (fact?.[field] != null && Number.isFinite(Number(fact[field]))) {
    return Number(fact[field]);
  }
  const deposits = fact?.payload?.deposits;
  if (deposits?.[field] != null && Number.isFinite(Number(deposits[field]))) {
    return Number(deposits[field]);
  }
  return null;
}

export function validateUnitDepositFormula(fact) {
  const security = readDepositCents(fact, "security_deposit_cents") ?? 0;
  const key = readDepositCents(fact, "key_deposit_cents") ?? 0;
  const pet = readDepositCents(fact, "pet_deposit_cents") ?? 0;
  const other = readDepositCents(fact, "other_deposit_cents") ?? 0;

  const deposits = fact?.payload?.deposits ?? {};
  const lhSecurity = Number(deposits.leasehold_security_cents ?? security);
  const lhOther = Number(deposits.leasehold_other_cents ?? 0);
  const componentSum = Number(deposits.deposit_component_sum_cents ?? 0);

  const hasDeposits = security + key + pet + other > 0;
  if (!hasDeposits) {
    return { ok: true, skipped: true, unit: fact?.unit_label };
  }

  const properaTotal = security + key + pet + other;
  const lhTotal = lhSecurity + lhOther;
  const ok =
    Math.abs(lhTotal - properaTotal) <= 2 &&
    Math.abs(componentSum - properaTotal) <= 2 &&
    Math.abs(lhOther - (key + pet + other)) <= 2;

  return {
    ok,
    skipped: false,
    unit: fact?.unit_label,
    lhTotalCents: lhTotal,
    properaTotalCents: properaTotal,
    securityCents: security,
    keyCents: key,
    petCents: pet,
    otherCents: other,
    lhSecurityCents: lhSecurity,
    lhOtherCents: lhOther,
    componentSumCents: componentSum,
  };
}

export function validatePropertyDepositFormula(facts) {
  const rows = Array.isArray(facts) ? facts : [];
  const reports = rows.map((fact) => validateUnitDepositFormula(fact));
  const checked = reports.filter((row) => !row.skipped);
  const failures = checked.filter((row) => !row.ok);
  return {
    unitCount: rows.length,
    checkedCount: checked.length,
    okCount: checked.length - failures.length,
    failures,
  };
}
