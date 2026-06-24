#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { exportPropertySnapshots } from "../bridge/exportPropertySnapshots.js";
import { buildImportPayload } from "../lib/buildImportPayload.js";
import { loadPropertyMapping, listImportEnabledProperties } from "../lib/loadConfig.js";
import { fingerprintPropertyMirror } from "../lib/propertyMirrorFingerprint.js";
import { resolveMirrorRoot } from "../lib/mirrorRoot.js";
import {
  isSyncDeltaPilotProperty,
  isDeltaBaselineSeeded,
  mergePropertyDeltaCursor,
} from "../lib/syncDeltaState.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const args = {
    skipMirror: false,
    forceAll: false,
    dryRun: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skip-mirror") args.skipMirror = true;
    else if (arg === "--force-all") args.forceAll = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: npm run sync:changed -- [options]

Office syncher: mirror robocopy → fingerprint changed properties → export → POST import API.

Options:
  --skip-mirror   Skip robocopy (staging already fresh)
  --force-all     Import every enabled property even when fingerprint unchanged
  --dry-run       Log actions without POST or cursor update

Required env:
  PROPERA_APP_URL                    e.g. https://propera-app-....vercel.app
  PROPERA_FINANCIAL_IMPORT_SECRET    M2M secret (must match Vercel env)
  LEASEHOLD_MIRROR_ROOT              staging copy (bridge reads this)

Optional env:
  LEASEHOLD_MIRROR_SOURCE            robocopy source (default \\\\lhdata\\lhmirror)
  LEASEHOLD_SYNC_CURSOR_PATH         cursor file (default <parent-of-mirror>/.leasehold-sync-cursor.json)
  PROPERA_APP_DIR                    path to propera-app for office-sync-mirror.ps1
`);
}

function defaultCursorPath(mirrorRoot) {
  // Keep outside LEASEHOLD_MIRROR_ROOT — robocopy /MIR purges extras in staging.
  return path.resolve(mirrorRoot, "..", ".leasehold-sync-cursor.json");
}

function resolveCursorPath(mirrorRoot) {
  const fromEnv = String(process.env.LEASEHOLD_SYNC_CURSOR_PATH || "").trim();
  if (fromEnv) return path.resolve(fromEnv);

  const cursorPath = defaultCursorPath(mirrorRoot);
  const legacyInMirror = path.join(mirrorRoot, ".leasehold-sync-cursor.json");
  if (!fs.existsSync(cursorPath) && fs.existsSync(legacyInMirror)) {
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    fs.copyFileSync(legacyInMirror, cursorPath);
    console.log(`[sync-changed] Migrated cursor from staging to ${cursorPath}`);
  }
  return cursorPath;
}

function loadCursor(cursorPath) {
  if (!fs.existsSync(cursorPath)) {
    return { version: 1, properties: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cursorPath, "utf8"));
    return {
      version: 1,
      properties: raw?.properties && typeof raw.properties === "object" ? raw.properties : {},
    };
  } catch {
    return { version: 1, properties: {} };
  }
}

function saveCursor(cursorPath, cursor) {
  fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
  fs.writeFileSync(cursorPath, `${JSON.stringify(cursor, null, 2)}\n`, "utf8");
}

function runMirrorSync() {
  const appDir =
    String(process.env.PROPERA_APP_DIR || "").trim() ||
    path.resolve(PACKAGE_ROOT, "..", "propera-app");
  const script = path.join(appDir, "scripts", "office-sync-mirror.ps1");
  if (!fs.existsSync(script)) {
    throw new Error(`office-sync-mirror.ps1 not found at ${script}`);
  }

  console.log("[sync-changed] Robocopy mirror → staging");
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      cwd: appDir,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    }
  );
  if (result.status == null || result.status >= 8) {
    throw new Error(`robocopy_failed_${result.status ?? "unknown"}`);
  }
}

async function postImport(payload, appUrl, secret) {
  const url = `${appUrl.replace(/\/+$/, "")}/api/financial/import/accounting-snapshots`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-propera-financial-import-secret": secret,
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = data && typeof data === "object" && data.error ? String(data.error) : res.statusText;
    throw new Error(`import_http_${res.status}:${err}`);
  }
  return data;
}

const args = parseArgs(process.argv);
if (args.help) {
  printHelp();
  process.exit(0);
}

const appUrl = String(process.env.PROPERA_APP_URL || "").trim();
const secret = String(process.env.PROPERA_FINANCIAL_IMPORT_SECRET || "").trim();
if (!appUrl) {
  console.error("Missing PROPERA_APP_URL");
  process.exit(1);
}
if (!secret && !args.dryRun) {
  console.error("Missing PROPERA_FINANCIAL_IMPORT_SECRET (required unless --dry-run)");
  process.exit(1);
}

try {
  if (!args.skipMirror) {
    runMirrorSync();
  }

  const mirrorRoot = resolveMirrorRoot();
  const cursorPath = resolveCursorPath(mirrorRoot);
  const cursor = loadCursor(cursorPath);
  const mapping = loadPropertyMapping();
  const properties = listImportEnabledProperties(mapping);

  const lines = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const property of properties) {
    const code = String(property.propera_property_code).trim().toUpperCase();
    const raGroup = property.leasehold_ra_group;
    const fingerprint = fingerprintPropertyMirror(mirrorRoot, raGroup);
    const prev = cursor.properties[code];
    const unchanged = prev?.fingerprint === fingerprint;

    if (unchanged && !args.forceAll) {
      skipped += 1;
      lines.push({ propertyCode: code, action: "skipped", fingerprint });
      console.log(`[sync-changed] ${code}: unchanged — skip`);
      continue;
    }

    console.log(`[sync-changed] ${code}: changed — export + import`);
    const exportResult = exportPropertySnapshots({
      mapping,
      properaPropertyCode: code,
    });
    const prevPropertyCursor = cursor.properties[code] ?? null;
    const payload = buildImportPayload(exportResult, { propertyCursor: prevPropertyCursor });

    if (args.dryRun) {
      imported += 1;
      lines.push({
        propertyCode: code,
        action: "dry_run",
        unitCount: payload.facts.length,
        fingerprint,
        deltaFiltering: payload.delta_meta?.filtering ?? false,
        leaseSignals: payload.delta_meta?.lease_signal_count ?? 0,
        ledgerSignals: payload.delta_meta?.ledger_signal_count ?? 0,
      });
      continue;
    }

    try {
      const result = await postImport(payload, appUrl, secret);
      imported += 1;
      const seedBaseline =
        isSyncDeltaPilotProperty(code) && !isDeltaBaselineSeeded(prevPropertyCursor);
      const nextPropertyCursor = mergePropertyDeltaCursor(
        {
          ...(prevPropertyCursor && typeof prevPropertyCursor === "object" ? prevPropertyCursor : {}),
          fingerprint,
          lastImportAt: new Date().toISOString(),
          lastUpserted: result?.upserted ?? payload.facts.length,
          lastSyncedAt: result?.syncedAt ?? payload.synced_at,
        },
        payload.delta_meta?.unit_delta_map ?? {},
        { seedBaseline }
      );
      cursor.properties[code] = nextPropertyCursor;
      lines.push({
        propertyCode: code,
        action: "imported",
        upserted: result?.upserted ?? payload.facts.length,
        netRentEnriched: result?.netRentEnriched ?? 0,
        depositsEnriched: result?.depositsEnriched ?? 0,
        unmatchedUnits: result?.unmatchedUnits ?? [],
        deltaBaselineSeeded: Boolean(nextPropertyCursor?.delta?.baselineSeededAt),
        skippedLeaseUnchanged: payload.delta_meta?.skipped_lease_unchanged ?? 0,
        skippedLedgerKnown: payload.delta_meta?.skipped_ledger_known ?? 0,
        leaseSignals: payload.delta_meta?.lease_signal_count ?? 0,
        ledgerSignals: payload.delta_meta?.ledger_signal_count ?? 0,
      });
      console.log(
        `[sync-changed] ${code}: OK — ${result?.upserted ?? payload.facts.length} units`
      );
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      lines.push({ propertyCode: code, action: "failed", error: msg });
      console.error(`[sync-changed] ${code}: FAILED — ${msg}`);
    }
  }

  if (!args.dryRun) {
    cursor.lastRunAt = new Date().toISOString();
    saveCursor(cursorPath, cursor);
  }

  const summary = {
    ok: failed === 0,
    mirrorRoot,
    cursorPath,
    imported,
    skipped,
    failed,
    dryRun: args.dryRun,
    lines,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[sync-changed] fatal: ${msg}`);
  process.exit(1);
}
