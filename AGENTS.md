# Leasehold bridge — agent handoff (read this first)

**Office PC path:** `C:\Projects\leasehold-bridge`  
**Home / D: path:** `D:\Projects\leasehold-bridge`

---

## Start here (mandatory)

1. **`../propera-app/docs/OFFICE_AGENT_HANDOFF.md`** — **current state, pull commands, verify SQL, what's shipped, what's next.** Read this before changing bridge or sync logic.
2. **`../PROPERA_LH_STRICT_ACTOR_PATHS.md`** — **finance thread (2026-07-31):** strict LH actor, path matrix, baseline vs forward. Stream 2 (`A*TR` checks) not wired yet; tenant Stream 1 mostly done. **Next: T7 allocation replay** (propera-v2/app — no bridge change).
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
