import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fingerprintPropertyMirror,
  propertyMirrorFileNames,
} from "../src/lib/propertyMirrorFingerprint.js";

test("propertyMirrorFileNames lists RA group watch set", () => {
  assert.deepEqual(propertyMirrorFileNames("RA0001"), [
    "RA0001.DAT",
    "RA0001H.Dat",
    "RA0001S.Dat",
    "RA0001R.Dat",
  ]);
});

test("fingerprintPropertyMirror is stable for same file stats", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-fp-"));
  const filePath = path.join(dir, "RA0001H.Dat");
  fs.writeFileSync(filePath, "sample");

  const a = fingerprintPropertyMirror(dir, "RA0001");
  const b = fingerprintPropertyMirror(dir, "RA0001");
  assert.equal(a, b);

  fs.writeFileSync(filePath, "sample-updated");
  const c = fingerprintPropertyMirror(dir, "RA0001");
  assert.notEqual(a, c);
});

test("fingerprintPropertyMirror handles missing optional files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-fp-missing-"));
  fs.writeFileSync(path.join(dir, "RA0003.DAT"), "x");
  const fp = fingerprintPropertyMirror(dir, "RA0003");
  assert.match(fp, /^[a-f0-9]{64}$/);
});
