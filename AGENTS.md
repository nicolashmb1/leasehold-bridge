# Leasehold bridge — agent handoff (read this first)

**Office PC path:** `C:\Projects\leasehold-bridge`  
**Home / D: path:** `D:\Projects\leasehold-bridge`

---

## Start here (mandatory)

1. **`../propera-app/docs/OFFICE_AGENT_HANDOFF.md`** — **current state, pull commands, verify SQL, what's shipped, what's next.** Read this before changing bridge or sync logic.
2. **`../propera-app/docs/LEASEHOLD_BRIDGE_ACTION_MODEL.md`** — locked intent: bridge = actor, baseline + deltas, silence ≠ deletion.
3. **`../propera-v2/docs/ACCOUNTING_SIGNAL_SCHEMA.md`** — signal shapes (when D: or GitHub available).

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

Cursor file: `<LEASEHOLD_MIRROR_ROOT>/.leasehold-sync-cursor.json`

---

## WESTFIELD pilots (2026-06-24)

| Config | Scope |
|--------|--------|
| `config/ledger-mimic-pilot.json` | Ledger event signals — **WESTFIELD all units** (`"*"`) |
| `config/sync-delta-pilot.json` | Per-unit delta filter — **WESTFIELD only** |

**First successful WESTFIELD import** after upgrade → full signals + seeds `delta.baselineSeededAt`.  
**Later syncs** → changed lease terms + new ledger lines only.

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
