# Leasehold bridge

**Client-specific source adapter** — not Propera's canonical finance import pattern.

This package reads **this operator's** Leasehold flat files (`lhmirror/`) and converts them into **Propera's normalized financial snapshot shape** (`tenant_account_snapshots`). Another client on QuickBooks, AppFolio, or Stripe would get a **different adapter** that produces the **same Propera contract**.

Propera stays **channel-agnostic** and **source-agnostic**. What varies per client is only the adapter; what stays fixed is the normalized fact + DAL posting inside Propera.

## Adapter boundary (do not blur)

| Layer | Role | This repo? |
|-------|------|------------|
| **Source adapter** | Read legacy system (Leasehold files, future QuickBooks API, CSV export, …) → emit normalized financial facts | **Yes — `leasehold-bridge`** |
| **Propera finance DAL** | Accept normalized facts → upsert `tenant_account_snapshots`, wire `/financial` | **No — `propera-app` / migration 058** |
| **Channel adapter** | Transport only (portal form, SMS, `$$` chat, Telegram) → signal → brain validates → post | **No — `propera-v2` adapters** |
| **Portal user input** | Staff types amount / uploads receipt → fields extracted → brain gate → ledger or cost row | **No — same DAL, different ingress** |

**Leasehold bridge does not define how Propera imports finance.** It defines how **this client** maps Leasehold → Propera. Delete or replace this repo when the client leaves Leasehold; Propera's tables and read APIs stay.

**Guardrail:** The bridge must not assign responsibility, touch lifecycle, or write back to Leasehold. Read legacy → normalize → hand off to Propera DAL only.

**Unit catalog rule (locked):** Leasehold `unit_label` is a **match key only** — used to find the right `unit_catalog_id` when posting financial snapshots. Propera `units` (label, floor, bedrooms, bathrooms, notes, layout) is **always operator truth**. The bridge must **never** create, rename, or overwrite unit catalog fields from Leasehold room numbers. If Propera has blanks, staff fill them in the portal — not from legacy import.

## Mirror path (mandatory)

**Only read from:**

```text
D:\Projects\leasehold-bridge\lhmirror
```

Set via environment:

```text
LEASEHOLD_MIRROR_ROOT=D:\Projects\leasehold-bridge\lhmirror
```

Do **not** point tools at `\\lhdata\lhmirror`, OneDrive copies, or other paths unless you explicitly change this config for production sync later.

**Working from home:** see [WORKING-FROM-HOME.md](./WORKING-FROM-HOME.md) (external drive + `LEASEHOLD_MIRROR_ROOT`).

## Docs

| File | Purpose |
|------|---------|
| [MANIFEST.md](./MANIFEST.md) | What each file type is, import tiers, RA/A prefixes |
| [MIRROR_SYNC.md](./MIRROR_SYNC.md) | Home snapshot vs office `\\lhdata\lhmirror` — manual + future auto sync |
| [config/property-mapping.json](./config/property-mapping.json) | RA#### ↔ Propera property codes |
| [schema/record-layouts.json](./schema/record-layouts.json) | Fixed record widths (validated on snapshot) |
| [schema/import-tiers.json](./schema/import-tiers.json) | Bootstrap vs periodic import classes |
| [../propera-app/docs/FINANCIAL_LEASEHOLD_SYNC.md](../propera-app/docs/FINANCIAL_LEASEHOLD_SYNC.md) | Deposit invariant, Supabase **097**, manual override ops |

## Deposits (S.Dat / R.Dat)

Rent security and the LH **Other Security** bucket are derived in `src/normalize/deriveUnitDeposits.js` from **`RA####S.Dat`** (security ledger) and **`RA####R.Dat`** (deposit ledger), with unit master segment 1 as fallback for rent security only.

**Invariant:**

```text
LH Rent Security  → security_deposit_cents
LH Other Security → key_deposit_cents + pet_deposit_cents + other_deposit_cents
```

Propera migrations **096** (key + `deposits_derived_at`) and **097** (other + pet) on `unit_leases`. Import path: `leaseEnrichmentImport.ts` in propera-app.

**Validation:**

```powershell
npm run validate:deposits          # portfolio formula check
node scripts/reconcileOxpsWestfield.js   # LH OXPS print vs bridge export (WESTFIELD)
```

After parser changes: `npm test`, re-export, re-import in propera-app (**Financial → Imports**).

**Known mirror gap (2026-06-08):** WESTFIELD **unit 314** — LH screen shows Other $700; `RA0003S.Dat` / `R.Dat` in snapshot have no unit 314 deposit rows. Bridge correctly exports `other_deposit_cents: null`. Fix: refresh mirror from office `\\lhdata`; interim ops may patch Supabase (see `FINANCIAL_LEASEHOLD_SYNC.md`).

## Status

- **Phase 0:** manifest + mapping (this package)
- **Phase 1:** parsers for `RA####.DAT`, `RA####H` + export CLI (**WESTGRAND proof**)
- **Phase 2:** Propera import API + migration 058 (separate repo — accepts normalized facts only)

## Quick start

```powershell
cd D:\Projects\leasehold-bridge
$env:LEASEHOLD_MIRROR_ROOT = "D:\Projects\leasehold-bridge\lhmirror"
npm test
npm run export -- --property WESTGRAND --format csv
```

Output lands in `output/` (gitignored — contains tenant PII). CSV includes `*_dollars` columns for side-by-side comparison with the Leasehold screen; `*_cents` columns are the Propera import contract.

**`last_payment_at`** is derived from `RA####H.Dat` posted payments. After parser changes, **re-export and re-import** so Propera snapshots pick up corrected dates (stale rows kept old dates when 3-digit check payments were missed). Display picks the latest **substantial** payment (≥ half of rent, min $500), not trailing partials.

Each fact `payload.posted_transactions` carries the last **80** posted lines per unit from `RA####H.Dat` (billing, late fees, payments) for read-only display on the unit hub. Re-import after bridge updates to refresh ledger history and net-rent enrichment in Propera.

`payload.ancillary_charges` extracts **non-rent** amounts from **unit master segment 1** when possible (validated Penn 412: **$125 parking + $68.50 water + $45 pet**). Classification: **water** = amounts with cents; **pet** = round ~$40–$65; **parking** = round ~$75–$150. Falls back to Monthly Billing extras bundle or explicit `H.Dat` lines when slots are empty. Re-import after bridge updates.

## Push into Propera (Phase 1.5)

1. Apply migration **`094_tenant_account_snapshots_v1.sql`** on Supabase.
2. In propera-app (logged in as owner/ops): **Financial → Imports → Refresh from Leasehold**.
3. Or export JSON to stdout for any adapter:

```powershell
npm run export -- --property WESTGRAND --format json --stdout
```

POST that payload to `POST /api/financial/import/accounting-snapshots` (source-agnostic contract).
