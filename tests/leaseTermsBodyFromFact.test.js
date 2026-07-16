import test from "node:test";
import assert from "node:assert/strict";
import { buildLeaseTermsBodyFromFact } from "../src/signals/leaseTermsBodyFromFact.js";

test("buildLeaseTermsBodyFromFact — omits unknown deposit keys (WESTFIELD 314)", () => {
  const result = buildLeaseTermsBodyFromFact(
    {
      unit_label: "314",
      tenant_name: "Tenant",
      rent_cents: 240600,
      lease_start: "2025-06-01",
      lease_end: "2026-05-31",
      security_deposit_cents: 240600,
    },
    "2026-06-15T12:00:00.000Z"
  );

  assert.ok(result);
  assert.ok(Object.prototype.hasOwnProperty.call(result.body, "security_deposit_cents"));
  assert.ok(!Object.prototype.hasOwnProperty.call(result.body, "other_deposit_cents"));
  assert.ok(!Object.prototype.hasOwnProperty.call(result.body, "pet_deposit_cents"));
  assert.ok(!Object.prototype.hasOwnProperty.call(result.body, "key_deposit_cents"));
});

test("buildLeaseTermsBodyFromFact — tenant_name becomes parties[]", () => {
  const result = buildLeaseTermsBodyFromFact(
    {
      unit_label: "412",
      tenant_name: "Smith, John",
      rent_cents: 240600,
      lease_start: "2025-06-01",
      lease_end: "2026-05-31",
      security_deposit_cents: 240600,
    },
    "2026-06-15T12:00:00.000Z"
  );

  assert.ok(result);
  assert.ok(Array.isArray(result.body.parties));
  assert.equal(result.body.parties.length, 1);
  assert.equal(result.body.parties[0].full_name, "Smith, John");
  assert.equal(result.body.parties[0].role, "responsible");
  assert.equal(result.body.parties[0].is_primary, true);
});

test("buildLeaseTermsBodyFromFact — explicit zero deposit is included", () => {
  const result = buildLeaseTermsBodyFromFact(
    {
      unit_label: "314",
      tenant_name: "Tenant",
      rent_cents: 240600,
      lease_start: "2025-06-01",
      lease_end: "2026-05-31",
      other_deposit_cents: 0,
    },
    "2026-06-15T12:00:00.000Z"
  );

  assert.ok(result);
  assert.equal(result.body.other_deposit_cents, 0);
});
