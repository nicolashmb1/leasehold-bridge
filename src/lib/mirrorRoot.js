import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveMirrorRoot() {
  const fromEnv = String(process.env.LEASEHOLD_MIRROR_ROOT || "").trim();
  if (fromEnv) return path.resolve(fromEnv);

  const fromConfig = path.join(PACKAGE_ROOT, "lhmirror");
  if (fs.existsSync(fromConfig)) return fromConfig;

  throw new Error(
    "Leasehold mirror not found. Set LEASEHOLD_MIRROR_ROOT or copy lhmirror/ into leasehold-bridge/"
  );
}

export function readMirrorFile(mirrorRoot, fileName) {
  const filePath = path.join(mirrorRoot, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Mirror file missing: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

/** Optional mirror files (e.g. deposit summary) — returns null when absent. */
export function tryReadMirrorFile(mirrorRoot, fileName) {
  const filePath = path.join(mirrorRoot, fileName);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}
