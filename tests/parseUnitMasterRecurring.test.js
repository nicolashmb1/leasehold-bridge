import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRecurringSlotDollars,
  parseRecurringSlotAmounts,
} from "../src/parsers/parseUnitMasterRecurring.js";

test("classifyRecurringSlotDollars matches operator rules", () => {
  assert.equal(classifyRecurringSlotDollars(68.5), "water");
  assert.equal(classifyRecurringSlotDollars(86.23), "water");
  assert.equal(classifyRecurringSlotDollars(45), "pet");
  assert.equal(classifyRecurringSlotDollars(50), "pet");
  assert.equal(classifyRecurringSlotDollars(125), "parking");
  assert.equal(classifyRecurringSlotDollars(150), "parking");
  assert.equal(classifyRecurringSlotDollars(75), "parking");
});
