import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupDepositRegisterBatches,
  parseDepositRegisterDescription,
  parseDepositRegisterDat,
} from "../src/parsers/parseDepositRegisterDat.js";
import { buildBankDepositBatchSignals } from "../src/signals/buildBankDepositBatchSignals.js";

function makeRecord(dateStr, description, amountDollars) {
  const buf = Buffer.alloc(35, 0x20);
  buf.write(dateStr.padEnd(10, " "), 0, 10, "latin1");
  buf.write(description.padEnd(17, " ").slice(0, 17), 10, 17, "latin1");
  buf.writeBigInt64LE(BigInt(Math.round(amountDollars * 10000)), 27);
  return buf;
}

describe("parseDepositRegisterDescription", () => {
  it("parses End-Batch terminator", () => {
    const p = parseDepositRegisterDescription("End-Batch# 54");
    assert.equal(p.kind, "end_batch");
    assert.equal(p.batch_number, 54);
  });

  it("parses unit + cheque", () => {
    const p = parseDepositRegisterDescription("411  105");
    assert.equal(p.kind, "payment");
    assert.equal(p.unit_label, "411");
    assert.equal(p.cheque_ref, "105");
  });
});

describe("buildBankDepositBatchSignals", () => {
  it("emits one signal per End-Batch with member total", () => {
    const parts = [
      makeRecord("06/05/2026", "411  105", 3055.86),
      makeRecord("06/05/2026", "209  152", 3168.44),
      makeRecord("06/05/2026", "End-Batch# 54", 0),
    ];
    const buf = Buffer.concat(parts);
    const out = buildBankDepositBatchSignals(buf, { propertyCode: "MORRIS" });
    assert.equal(out.signals.length, 1);
    const s = out.signals[0];
    assert.equal(s.kind, "bank_deposit_batch");
    assert.equal(s.body.batch_number, 54);
    assert.equal(s.body.members.length, 2);
    assert.equal(s.body.total_cents, 305586 + 316844);
    assert.equal(s.idempotency_key, "leasehold:MORRIS:bank_batch:54");
  });

  it("groups via parse + group helpers", () => {
    const parts = [
      makeRecord("06/05/2026", "411  105", 100.0),
      makeRecord("06/05/2026", "End-Batch# 1", 0),
      makeRecord("06/06/2026", "210  99", 50.0),
      makeRecord("06/06/2026", "End-Batch# 2", 0),
    ];
    const parsed = parseDepositRegisterDat(Buffer.concat(parts));
    const batches = groupDepositRegisterBatches(parsed.records);
    assert.equal(batches.length, 2);
    assert.equal(batches[0].batch_number, 1);
    assert.equal(batches[1].total_cents, 5000);
  });
});
