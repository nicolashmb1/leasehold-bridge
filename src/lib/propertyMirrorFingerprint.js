import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** RA group files that drive snapshot export (see FINANCIAL_LEASEHOLD_SYNC.md). */
export function propertyMirrorFileNames(raGroup) {
  const group = String(raGroup || "").trim();
  return [`${group}.DAT`, `${group}H.Dat`, `${group}S.Dat`, `${group}R.Dat`];
}

export function mirrorFileStat(mirrorRoot, fileName) {
  const filePath = path.join(mirrorRoot, fileName);
  if (!fs.existsSync(filePath)) {
    return { fileName, exists: false, mtimeMs: null, size: null };
  }
  const st = fs.statSync(filePath);
  return {
    fileName,
    exists: true,
    mtimeMs: st.mtimeMs,
    size: st.size,
  };
}

/** Stable hash of watched mirror files — used to skip unchanged property exports. */
export function fingerprintPropertyMirror(mirrorRoot, raGroup) {
  const parts = propertyMirrorFileNames(raGroup).map((fileName) => {
    const stat = mirrorFileStat(mirrorRoot, fileName);
    if (!stat.exists) return `${fileName}:missing`;
    return `${fileName}:${stat.mtimeMs}:${stat.size}`;
  });
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

export function fingerprintPropertyMirrorDetails(mirrorRoot, raGroup) {
  return propertyMirrorFileNames(raGroup).map((fileName) =>
    mirrorFileStat(mirrorRoot, fileName)
  );
}
