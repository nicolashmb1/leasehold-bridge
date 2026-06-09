# Leasehold mirror sync — home dev vs office production

## Current setup (home / dev)

You copied a **point-in-time snapshot** of `lhmirror` to your drive so you can build at home:

```text
D:\Projects\leasehold-bridge\lhmirror
```

Propera import reads only this path via:

```text
LEASEHOLD_MIRROR_ROOT=D:\Projects\leasehold-bridge\lhmirror
```

**Financial → Imports → Refresh from Leasehold** runs `leasehold-bridge` export against that folder, then upserts `tenant_account_snapshots` in Supabase.

Home mirror data **ages** until you refresh the copy from the office.

---

## Production target (office LAN)

Leasehold’s live data folder on the office network (typical):

```text
\\lhdata\lhmirror
```

Same file layout — **no parser changes** when you switch paths. Only `LEASEHOLD_MIRROR_ROOT` changes.

---

## Phase A — Manual sync (ship first)

1. **Copy or robocopy** office `\\lhdata\lhmirror` → dev machine or a server that runs Propera import.
2. Set `LEASEHOLD_MIRROR_ROOT` to that path on the machine running `propera-app` import.
3. Staff clicks **Refresh from Leasehold** (or **Import all 5**) after each copy.

Robocopy example (run from a machine that can reach `\\lhdata`):

```powershell
robocopy \\lhdata\lhmirror D:\leasehold-mirror-live /MIR /FFT /Z /XO /R:2 /W:5 ^
  /XF *.tmp *.bak /XD "2003" "Group A"
```

`/XO` skips older files — incremental sync. Remove `/XO` for full mirror refresh.

---

## Phase B — Scheduled sync + one-click import (next)

| Piece | Role |
|-------|------|
| **Windows Task Scheduler** or small service | Robocopy `\\lhdata\lhmirror` → local staging every 15–60 min |
| **mtime cursor** (optional) | Store last `RA####H.Dat` / `RA####.DAT` write time per property; skip export if unchanged |
| **Propera import button** | Already exists — runs bridge export + Supabase upsert + net-rent enrichment |
| **`synced_at`** | Stored on every snapshot row; UI shows one “as of” line per property/portfolio |

No write-back to Leasehold. Read-only mirror → bridge → Propera.

---

## Phase C — Fully automated (later)

1. Service on office LAN or VPN-connected host with stable access to `\\lhdata\lhmirror`.
2. Cron: mirror sync → `exportPropertySnapshots` all enabled properties → `POST /api/financial/import/accounting-snapshots`.
3. Alert if `synced_at` older than 24h (stale badge already supported in UI pattern).

---

## Environment checklist

| Variable | Dev (home) | Prod (office) |
|----------|------------|---------------|
| `LEASEHOLD_MIRROR_ROOT` | `D:\Projects\leasehold-bridge\lhmirror` | `\\lhdata\lhmirror` or staged copy |
| `LEASEHOLD_BRIDGE_ROOT` | `D:\Projects\leasehold-bridge` | same repo path on import host |
| `PROPERA_ACCOUNTING_SOURCE` | `leasehold` | `leasehold` |

---

## What to validate after switching to live mirror

1. `cd leasehold-bridge && npm run validate:ledger` — still 100% on 285 units.
2. Import one property → spot-check 2–3 units vs Leasehold screen (balance, last payment).
3. Portfolio **collection rate** and **tenant rent (net)** populate after re-import (migration **095** applied).

---

## Guardrails

- Bridge **never writes** to Leasehold or `lhmirror`.
- Propera **never parses** `H.Dat` — only generic snapshot JSON from the bridge.
- Unit catalog layout stays operator truth; mirror only supplies financial snapshots.
