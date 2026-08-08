# Leasehold bridge — agent handoff (read this first)

**Office PC path:** `C:\Projects\leasehold-bridge`  
**Home / D: path:** `D:\Projects\leasehold-bridge`

---

## ⇒ CURRENT THREAD (2026-08-05): the money path

**Read [`../propera-v2/docs/MONEY_PATH_HANDOFF.md`](../propera-v2/docs/MONEY_PATH_HANDOFF.md) before changing signal builders or the export.**

This repo now sends **money out and deposits** as well as tenant ledger events — `buildDisbursementSignals.js` and `buildDepositSignals.js`, both from the GL year files, which are the permanent book. Verified against MORRIS: 642 cheques, 30 voids, 185 deposits, zero problems.

**Gated to MORRIS only** — `config/money-path-pilot.json`. The office syncs all five buildings and the money path runs per property, so adding one without seeding its payee map and its property-scoped account map will auto-create hundreds of vendor records and fail its `1xxx` cheques. A missing config reads as *off*.

**The office pulls `origin master`** for this repo and propera-app, hard-coded in `propera-app/scripts/run-office-pull-and-sync.mjs`. Work on a branch is invisible to the office until merged.

Two things worth knowing before you dig: **move-out is a refund cheque**, not a status field — it has been searched for twice and not found; see [`docs/LH_GL_FILE_FORMAT.md`](./docs/LH_GL_FILE_FORMAT.md) §6.5 for the four tenancy markers. And **Leasehold erases a tenant's history at move-out** (§6.6), which is why running this bridge continuously is urgent rather than convenient.

**Fixed 2026-08-07:** `summarizeTransactionsByUnit` no longer caps at 12 payments / 80 rows — full per-unit history is exported; delta cursor keeps all ledger keys (was 120).

---

## Start here (mandatory)

1. **`../propera-app/docs/OFFICE_AGENT_HANDOFF.md`** — **current state, pull commands, verify SQL, what's shipped, what's next.** Read this before changing bridge or sync logic.
2. **`../PROPERA_LH_STRICT_ACTOR_PATHS.md`** — **finance thread (2026-07-31):** strict LH actor, path matrix, baseline vs forward. Stream 2 (`A*TR` checks) not wired yet; tenant Stream 1 mostly done. Bridge 12/80 export cap **fixed 2026-08-07**.
3. **`../propera-app/docs/WESTFIELD_TENANT_NAMES_AND_REPORTS.md`** — **2026-06-25:** parser name fix, PDF reports, roster vs leaseholder, office verify steps.
4. **`../propera-app/docs/LEASEHOLD_BRIDGE_ACTION_MODEL.md`** — locked intent: bridge = actor, baseline + deltas, silence ≠ deletion.
5. **`../propera-v2/docs/ACCOUNTING_SIGNAL_SCHEMA.md`** — signal shapes (when D: or GitHub available).

---

## This repo's role

**Client-specific adapter only.** Read Leasehold flat files → emit **snapshot facts** + **action signals[]** → POST to propera-app. **No Postgres, no policy, no write-back to LH.**

```text
lhmirror (LEASEHOLD_MIRROR_ROOT)
  → exportPropertySnapshots
  → buildImportPayload (facts + signals)
  → syncChanged.js → propera-app import API
```

---

## Office syncher

```powershell
cd C:\Projects\leasehold-bridge
git pull
npm run sync:changed
```

| Flag | Effect |
|------|--------|
| `--skip-mirror` | Skip robocopy (staging already fresh) |
| `--force-all` | Import every property even if fingerprint unchanged |
| `--dry-run` | No POST, no cursor update |

Cursor file: `C:\Propera\.leasehold-sync-cursor.json` (parent of mirror root; not inside staging — `/MIR` purges it)

---

## WESTFIELD pilots (2026-06-24)

| Config | Scope |
|--------|--------|
| `config/ledger-mimic-pilot.json` | Ledger event signals — **WESTFIELD all units** (`"*"`) |
| `config/sync-delta-pilot.json` | Per-unit delta filter — **WESTFIELD only** |

**First successful WESTFIELD import** after upgrade → full signals + seeds `delta.baselineSeededAt`.  
**Later syncs** → changed lease terms + new ledger lines only.

## Tenant names (2026-06-25)

Parser fix in `src/parsers/parseUnitMasterDat.js` — seg2 given + seg3 surname; fixes wrong PDF names (e.g. WESTFIELD 204 → `GABRIEL GARCIA`).

```powershell
npm test
node scripts/reconcileOxpsTenantNames.js   # optional: vs LH reports.oxps extract
```

After pull: office **must sync** so `tenant_name_display` refreshes in Supabase. See `../propera-app/docs/WESTFIELD_TENANT_NAMES_AND_REPORTS.md`.

---

## Guardrails

- **Never** write to `\\lhdata` or Leasehold  
- **Never** create/overwrite Propera `units` catalog from LH  
- **Never** send `other_deposit_cents: null` when unknown — **omit the key**  
- **Never** full-patch leases with nulls — changed fields only (delta mode)  
- Unit label = **match key** only; Propera unit catalog = operator truth  

---

## Tests

```powershell
npm test
npm run validate:deposits
```

After parser/signal changes: test → office sync → run `propera-app/scripts/verify_ledger_mimic_westfield.sql`.

---

## Related docs in this repo

| File | Purpose |
|------|---------|
| [README.md](./README.md) | Overview, deposits, export CLI |
| [MANIFEST.md](./MANIFEST.md) | File types, RA groups |
| [MIRROR_SYNC.md](./MIRROR_SYNC.md) | Mirror robocopy |
| [WORKING-FROM-HOME.md](./WORKING-FROM-HOME.md) | D: drive setup |
