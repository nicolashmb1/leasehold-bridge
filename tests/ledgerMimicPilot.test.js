import test from "node:test";
import assert from "node:assert/strict";
import {
  isLedgerMimicPilotUnit,
  resetLedgerMimicPilotConfigCache,
} from "../src/signals/ledgerMimicPilot.js";

test("isLedgerMimicPilotUnit matches building wildcard", () => {
  resetLedgerMimicPilotConfigCache();
  assert.equal(isLedgerMimicPilotUnit("WESTFIELD", "101"), true);
  assert.equal(isLedgerMimicPilotUnit("WESTFIELD", "314"), true);
  assert.equal(isLedgerMimicPilotUnit("westfield", "102"), true);
  assert.equal(isLedgerMimicPilotUnit("MURRAY", "101"), false);
  assert.equal(isLedgerMimicPilotUnit("WESTFIELD", ""), false);
});
