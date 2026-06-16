# Leasehold mirror manifest

**Mirror root (only):** `D:\Projects\leasehold-bridge\lhmirror`  
**Source system:** Leasehold (VB-era flat files)  
**Validated:** 2026-06-07 against office snapshot (~820 files at root)

Do not read `\\lhdata\lhmirror`, OneDrive, or other copies unless production sync is explicitly configured later.

---

## Format summary

| Question | Answer |
|----------|--------|
| Database engine | **None** — fixed-width flat files, not Btrieve/SQL |
| Encrypted? | **No** on tenant/rent files (plain ASCII + padding) |
| Year files | `.Y14` … `.Y26` = calendar year (e.g. `.Y20` = 2020) |
| Schema files | No `.DDF` — layout defined in [schema/record-layouts.json](./schema/record-layouts.json) |

---

## Property map (RA#### → Propera)

Derived from `PROPA.BAK` on `D:\Projects\leasehold-bridge\lhmirror` + operator mapping.

| RA group | Leasehold code | Building | Propera code | Import v1 |
|----------|----------------|----------|--------------|-----------|
| **RA0001** | `318WG` | 318 West Grand | **WESTGRAND** | ✅ |
| **RA0003** | `WESTF` | Engel Gardens / 618–630 Westfield Ave | **WESTFIELD** | ✅ |
| **RA0005** | `MURRA` | 57–77 Murray | **MURRAY** | ✅ |
| **RA0007** | `540` | 540 Morris Ave | **MORRIS** | ✅ |
| **RA0006** | `705` (Leasehold internal) | 702 Penn / 702 Pennsylvania | **PENN** | ✅ |
| **RA0008** | `354` | 354 Union (Grand at River) | — | ❌ not on Propera yet |
| **RA0009** | `673` | 707 Pennsylvania (Penn North) | — | ❌ not on Propera yet |
| **RA0010** | `676` | 678 Pennsylvania (Penn South) | — | ❌ not on Propera yet |

**Operator aliases**

| You said | Maps to |
|----------|---------|
| westgrand / 318 west grand | WESTGRAND / RA0001 |
| westfield / aroma / Engel Gardens / 618-630 | WESTFIELD / RA0003 |
| murray / 57-77 murray | MURRAY / RA0005 |
| morris / 540 morris | MORRIS / RA0007 |
| union | RA0008 (354 Union) — future |
| 707 penn | RA0009 — future |
| 678 penn | RA0010 — future |

Machine-readable: [config/property-mapping.json](./config/property-mapping.json)

---

## Accounting file prefixes (A*)

Building-level GL/expenses — **defer for tenant balance v1**.

| Prefix | Property | RA group |
|--------|----------|----------|
| `A318WG` | 318 West Grand | RA0001 |
| `AWESTF` | Westfield / Engel Gardens | RA0003 |
| `AMURRA` | Murray | RA0005 |
| `A705` | 702 Penn | RA0006 |
| `A540` | Morris | RA0007 |
| `A354` | Union | RA0008 |
| `A673` | 707 Penn | RA0009 |
| `A676` | 678 Penn | RA0010 |

Common suffixes on `A*`: `TR` (transactions), `EX` (expenses), `GL.Y##` (GL by year), `D`/`DS`/`BT` (detail/batch stubs).

---

## Per-property rent roll file set (RA####)

Each imported property has a **file group** sharing the same numeric id:

### Tier A — required for Propera `/financial` tenant view

| Pattern | Role | Record size |
|---------|------|-------------|
| **`RA####.DAT`** | Current unit master: rent, lease dates, **amount due**, tenant name/phone | 133-byte segments (**19/unit** — validated RA0001) |
| **`RA####H.Dat`** | **Posted transactions** + running balance (billing, late fees, payments) | **105 bytes/record** |

### Tier B — useful, optional v1

| Pattern | Role |
|---------|------|
| `RA####R.Dat` | Payment ledger (`CK`, amounts) — 171 bytes/record |
| `RA####C.Dat` | Charges posted (`LATE FEE`, etc.) |
| `RA####Q.Dat` | Monthly billing snapshot |
| `RA####DZ.Dat` | Monthly balance snapshot |
| `RA####P.Y##` / `M.Y##` | Year rollups (some binary numeric fields) |

### Tier C — specialized slices

| Suffix | Typical meaning |
|--------|-----------------|
| `RN` | Rent notice |
| `OC` | Occupancy |
| `TX` | Tax |
| `VA` | Vendor/AP lines on account |
| `BA`, `CX`, `E`, `S`, … | Building-specific Leasehold modules — map as needed |

Example: **RA0001** (Westgrand) has ~82 files in snapshot; start parse with `.DAT` + `H.Dat` only.

---

## Shared master files (portfolio-wide)

| File | Role | Import tier |
|------|------|-------------|
| **`PROPA.BAK`** | Property directory (names, addresses, RA#### ids, building codes) | Bootstrap once |
| `VENDOR.BAK` | Vendor master | Defer |
| `BANK.BAK` | Bank accounts | Defer |
| `LOCKBOX.DAT` | Lockbox config | Defer |
| `LOKUPA.DAT` | Lookup table | Defer |
| `NYSIAI.DAT` / `NYCRS.DAT` | NY reference | Defer |
| `*.BAK` (paired) | Backup of same-name `.DAT` | Use if primary corrupt |

---

## Import cadence

See [schema/import-tiers.json](./schema/import-tiers.json).

| Class | When | Files |
|-------|------|-------|
| **Bootstrap** | Once / new property | `PROPA`, mapping, optional history backfill |
| **Slow** | Daily or on change | `RA####.DAT` |
| **Fast** | 5–15 min (production) | `RA####H.Dat` |
| **Periodic** | Monthly | `.Y##` rollups |
| **Defer** | Phase 2+ | `A*TR`, `A*GL`, vendors |

**v1 import filter:** `import_enabled: true` → **WESTGRAND, WESTFIELD, MURRAY, MORRIS, PENN**.

**702 Penn / Leasehold RA0006:** Same building. Leasehold file prefix `A705` and PROPA code `705` ≠ Propera catalog — Propera uses code **`PENN`** (display “Penn”). Future **Penn North** / **Penn South** will be separate Propera codes when those properties go live.

---

## Propera target shape (Phase 1.5)

Each synced unit row (conceptual):

```json
{
  "source_system": "leasehold",
  "propera_property_code": "WESTGRAND",
  "leasehold_ra_group": "RA0001",
  "unit_label": "101",
  "rent_cents": 141300,
  "balance_cents": 211250,
  "last_payment_at": "2026-06-06",
  "last_payment_cents": 224892,
  "lease_end": "2027-05-31",
  "synced_at": "2026-06-07T12:00:00Z",
  "mirror_root": "D:\\Projects\\leasehold-bridge\\lhmirror"
}
```

`synced_at` is on every exported fact for audit. Propera UI shows it **once** at property/portfolio header — not on each unit line (see `PROPERA_FINANCE_ROADMAP.md` §1.5 “as of” display).

Posted transactions from `RA####H` → `tenant_payment_history` or embedded in snapshot payload.

**Deposits (enrichment):** `RA####S.Dat` (security ledger) + `RA####R.Dat` (deposit ledger) → `deriveUnitDeposits.js` → `security_deposit_cents`, `key_deposit_cents`, `other_deposit_cents`, `pet_deposit_cents` on Propera `unit_leases` (migrations **096–097**). LH **Other Security** = Propera Key + Pet + Other. Validate: `npm run validate:deposits`; WESTFIELD OXPS compare: `node scripts/reconcileOxpsWestfield.js`.

**Guardrail:** Leasehold snapshot = official balance. Propera-native `tenant_ledger_entries` stay a separate lane until cutover (see `propera-v2/docs/PROPERA_FINANCE_ROADMAP.md`).

**Unit matching (locked):** Import matches financial rows to Propera by `propera_property_code` + `unit_label` → `unit_catalog_id`. Leasehold room numbers may not match real layout (e.g. "room 4" vs 2bd/2ba). **Never** push Leasehold unit/room metadata into `public.units`. Propera unit catalog stays authoritative; blanks are edited in the portal only.

---

## Ignore list

| Path / pattern | Reason |
|----------------|--------|
| `lhmirror\2003\` | Old VirtualBox VM |
| `lhmirror\Group A\` | Printer installers |
| `*.exe`, `*.pdf`, `*.lnk` | Not ledger data |
| Tiny `*BT.DAT`, `*DS.DAT` (4–12 bytes) | Batch/dataset stubs |

---

## Production sync (later)

Same parsers; change only:

```text
LEASEHOLD_MIRROR_ROOT=\\lhdata\lhmirror
```

Add file mtime/hash cursor per `RA####H.Dat` / `RA####.DAT` — no parser rewrite.

---

## Next build steps

1. **Ledger mimic pilot** — validate WESTFIELD unit **101** (`config/ledger-mimic-pilot.json`); expand to full WESTFIELD building when compare passes  
2. Emit ledger signals for additional properties after WESTFIELD sign-off  
3. Delta sync when on office LAN (existing `sync-changed` CLI)  

*(Bootstrap export for all v1 properties is shipped — see README.)*

---

## Changelog

| Date | Note |
|------|------|
| 2026-06-15 | Step 2 ledger mimic — `buildLedgerEventSignals.js`; pilot **WESTFIELD unit 101**; signals merged in `buildImportPayload.js` |
| 2026-06-07 | Initial manifest; mirror locked to `D:\lhmirror`; four live Propera properties + three future (Union, 707 Penn, 678 Penn) |
| 2026-06-07 | Home PC setup: mirror copied to `leasehold-bridge/lhmirror`; config paths updated |
| 2026-06-08 | Deposit derivation (S.Dat/R.Dat); WESTFIELD 29/30 OXPS match; unit 314 Other $700 = mirror gap |
