# Bridge lifecycle evidence — discovery and parity plan

**Updated:** 2026-07-18  
**Status:** Adapter shipped (`buildExplicitLifecycleSignals.js`); **move-in forward-only feasible (seg 11); move-out blocked.**

**Office work order (do not skip):** `propera-app/docs/OFFICE_AGENT_HANDOFF.md` — **A** manual leases (MURRAY→MORRIS→PENN) → **B** move-in backfill → **C** bridge move-in (vacant unit only) → **D** move-out from LH blocked.

Canonical contract: `propera-app/docs/TURNOVER_OCCUPANCY_LIFECYCLE.md` · signal adapter tests: `tests/buildExplicitLifecycleSignals.test.js`

---

## What is done

| Piece | Location |
|-------|----------|
| Explicit lifecycle signal adapter | `src/signals/buildExplicitLifecycleSignals.js` |
| Import payload merge | `src/lib/buildImportPayload.js` → `signals[]` + `delta_meta.lifecycle_*` |
| V2 import dispatch | `propera-v2` `handleAccountingImportSignals.js` → canonical RPCs |
| Rejection of inferred evidence | lease dates, vacant rows, tenant replacement, KEY ledger lines |

The bridge **must not** infer keys returned/issued from unit-master vacancy, lease boundaries, or H.Dat KEY charges.

---

## What is missing

Bridge export **reads** `RA####RN.DAT` via `extractExplicitLifecycleEvents`, but staging mirrors have **no parseable notice rows** yet — sync still emits **zero** lifecycle signals.

Financial sync today fingerprints only:

- `RA####.DAT` (unit master)
- `RA####H.Dat` (ledger stream)
- `RA####S.Dat` / `RA####R.Dat` (deposits)

`RN.DAT` is **not** in the fingerprint until `parseRentNoticeDat` can emit records (otherwise RN changes would not trigger re-import).

---

## Office staging probe (2026-07-18)

Path: `C:\Propera\leasehold-staging`

| File pattern | Typical size | Content |
|--------------|--------------|---------|
| `RA####RN.DAT` | 1–92 bytes | **Empty / whitespace stub** — no parseable notice rows |
| `RA####OC.DAT` | 3.8–15 KB | **All units 0.00** — not possession events (matches backfill doc) |

**Conclusion:** Current mirror copy does **not** export staff notice or keys actions in RN/OC. **Move-out dates exist in `MTCom.Dat`**, but they are **not unit-linked in the export** and **do not match physical departure** (see deep probe below). Bridge parity for canonical `occupancy_move_out_recorded` remains **blocked**.

---

## Murray turnover case study (405 / 510 / 512 — 2026-07-18)

Office examples: recent move-outs at **Murray 512, 405, 510**. Staging mirror: `C:\Propera\leasehold-staging\RA0005*`.

Probe:

```bash
LEASEHOLD_MIRROR_ROOT=C:\Propera\leasehold-staging node scripts/probe-lh-turnover-units.mjs --property MURRAY --units 405,510,512
```

| Unit | Prior tenant (HX last activity) | New tenant (unit master) | seg 11 move-in | Lease start (seg 0) | Financial turnover (S/R + H.Dat) |
|------|-----------------------------------|--------------------------|----------------|---------------------|----------------------------------|
| **405** | Hugo Bernal — last HX **06/01/2026** | Carla Jackson | **07/01/2026** | 07/01/2026 | **06/23/2026** ADMIN FEE + deposit era |
| **510** | Richard Rodriguez — last HX **06/01/2026**; SecPayable **07/11/2026** | Jazmin Rodriguez | **07/01/2026** | 07/01/2026 | **06/23/2026** ADMIN FEE + deposit era |
| **512** | Ketty Toussaint — last HX **06/04/2026** | Luis Oliver | **06/15/2026** | 07/01/2026 | **06/23/2026** ADMIN FEE + deposit era |

### What LH **does** record (found)

| Source | Field | Meaning | Bridge-safe? |
|--------|-------|---------|--------------|
| **`RA####.DAT` seg 11** | `MM/DD/YYYY` | **Move-in / keys issued** for current tenant | ✅ Yes — documented in `OCCUPANCY_MOVE_IN_BACKFILL.md` |
| **`RA####.DAT` seg 0** | `lease_start` / `lease_end` | Current **contractual** term | ❌ Not possession |
| **`RA####.DAT` seg 12** | `X MM/DD/YYYY-rent` | **Prior rent-era marker** (old rent amount) | ❌ Not move-out (405 → `11/01/2025-2595` while Hugo stayed through Jun 2026) |
| **`RA####X.Dat`** | past tenant blocks w/ lease start/end | **Lease history** | ❌ Contractual only (Ketty X.Dat lease ends 10/31/2026 but she left Jun 2026) |
| **`RA####H.Dat` / `HX.Dat`** | ledger rows w/ tenant name | Billing history; rolls to HX on turnover | ❌ Last row ≠ move-out date |
| **`RA####S.Dat` / `R.Dat`** | SECURITY DEPOSIT + KEY DEPOSIT cluster | **New tenant** deposit era anchor (`deriveUnitDeposits.js`) | ❌ Move-in financial setup, not prior move-out |
| **`RA####H.Dat` 06/23/2026** | `ADMIN FEE` + `-rent` reversal | Turnover **processing** day for all three units | ❌ Same calendar day for all three — processing date, not physical move-out |
| **`RA####CX.Dat`** | free-text notes | Occasional "MOVE OUT BY …" strings | ❌ Unstructured, not unit-indexed |

### What LH **does not** expose (for these units)

- **`RN.DAT`** — whitespace stub (no notice rows)
- **`OC.DAT`** — all units `0.00` (not possession)
- **Dedicated move-out date** — searched seg 0–18, H/HX/Q/R/S/X, WW/TX/MC/ER/NR; dates like `06/14/2026` (512) and `06/30/2026` (405/510) **not present** anywhere in mirror
- **"MOVE OUT" / "VACATE" / "KEYS RETURNED"** structured rows in H.Dat — not found for Murray

**Implication:** LH clearly **processes** turnovers (new seg 11, new names, deposit era, ADMIN FEE), but the mirror copy available to the bridge does **not** include an auditable **physical move-out date** field. Under `TURNOVER_OCCUPANCY_LIFECYCLE.md`, bridge must **not** infer move-out from last ledger row, lease end, or tenant-name replacement.

**Move-in bridge path (future):** seg 11 + current tenant name change could emit `occupancy_move_in_recorded` once idempotency and roster binding are designed — still requires product decision.

**Move-out bridge path:** `MTCom.Dat` has dates but fails canonical gates (no unit key; date = processing not physical). Blocked until office confirms LH UI semantics or a unit-indexed export exists.

---

## Deep probe — where LH stores move-out (2026-07-18)

```bash
LEASEHOLD_MIRROR_ROOT=C:\Propera\leasehold-staging node scripts/probe-lh-move-out-deep.mjs --property MURRAY
```

### Found: `RA####MTCom.Dat` (3500 bytes/record)

Each record is mostly padding with one ASCII line:

```text
Move In MM/DD/YYYY Move Out MM/DD/YYYY
```

Murray has **111** such stay records. **No unit label or tenant name** appears anywhere in the record (only the date pair).

| Prior tenant (Murray) | Correlate via HX move-in | MTCom move-out | New tenant seg 11 |
|-----------------------|--------------------------|----------------|-------------------|
| Hugo Bernal (405) | 11/01/2023 | **06/23/2026** | 07/01/2026 |
| Richard Rodriguez (510) | 05/01/2024 | **06/23/2026** | 07/01/2026 |
| Ketty Toussaint (512) | 11/01/2024 | **06/10/2026** | 06/15/2026 |

**Cross-check — WESTFIELD 213 (Kevin → Luiz):**

| Source | Date |
|--------|------|
| MTCom move-out | **06/23/2026** |
| Physical move-out (backfill / HX) | **06/28/2026** |
| Luiz seg 11 move-in | 06/29/2026 |

MTCom move-out is **5 days earlier** than physical departure. It aligns with the **06/23 batch processing day** (ADMIN FEE + H.Dat `code 2` rent reversal), not keys returned.

### Also found (not canonical move-out)

| File | What it is | Bridge-safe? |
|------|------------|--------------|
| **`H.Dat` 06/23 `0 2 {rent} -{rent}`** | Rent-charge reversal when closing prior tenant on batch day | ❌ Processing marker |
| **`LG.Dat`** | Legal **3-Day / 5-Day Notice** amounts and dates | ❌ Eviction notice ≠ move-out |
| **`CX.Dat`** | Free-text "MOVE OUT BY …" notes | ❌ Unstructured |
| **`X.Dat`** | Tenant lease history (contractual start/end) | ❌ Lease end ≠ physical |
| **`R.Dat` `VACANT` suffix** | Monthly billing row format while occupied | ❌ Not vacancy |

### Reliable today

| Event | Mirror source | Reliable? |
|-------|---------------|-----------|
| **Move-in (keys issued)** | Unit master **seg 11** | ✅ Yes |
| **Move-out (physical)** | None that pass canonical gates | ❌ No |

### Why MTCom is not enough

1. **No unit key** in mirror export — must guess stay via prior move-in date (fragile across renewals/name fixes).
2. **Date semantics** — "Move Out" = LH **lease close / batch processing**, not proven physical departure (Kevin 06/23 vs 06/28).
3. **Batch clustering** — Hugo + Richard both show **06/23/2026** (office processed same day), while Ketty shows **06/10/2026** (different batch).

### Office ask (updated)

1. In Leasehold UI, when staff records a move-out, does it write **`MTCom.Dat`**? Does the UI show the same date as MTCom "Move Out"?
2. Is there an export option that includes **unit number** on MTCom stay rows?
3. Does "Move Out" mean **keys returned** or **lease terminated in LH** (financial close)?

Run probe anytime:

```bash
node scripts/probe-lifecycle-evidence.mjs
node scripts/probe-lifecycle-evidence.mjs --property PENN
```

---

## Accepted bridge event shape (input to adapter)

```js
{
  event_kind: "move_out_planned" | "move_out_recorded" | "move_in_recorded" | "move_out_plan_withdrawn",
  evidence_kind: "signed_notice" | "keys_returned" | "keys_issued" | "leasehold_move_out_action" | "leasehold_move_in_action" | "notice_withdrawn",
  source_event_id: string,       // required — stable LH row id
  property_code: string,
  unit_label: string,
  effective_date: "YYYY-MM-DD",  // required
  target_ready_date?: string,
  tenant_roster_id?: string,     // required for move_in_recorded at V2
  source_file?: string,
  recorded_at?: string,
  causation_id?: string
}
```

---

## Wire order (when evidence exists)

**After** owner manual lease review + move-in backfill per property ([OFFICE_AGENT_HANDOFF.md](../propera-app/docs/OFFICE_AGENT_HANDOFF.md)):

1. **Unit master seg 11 move-in** — `occupancy_move_in_recorded` **forward only** when Propera unit is **vacant** and LH shows a new tenant (V2 rejects `active_occupancy_exists`)
2. **RN rent notice** — `move_out_planned` + `signed_notice` (if rows contain notice + target departure)
3. **Staff action audit file** — keys returned/issued (if LH exports vacate/move-in actions separately)
4. **Never wire:** `lease_start`/`lease_end`, OC all-zero grid, tenant-name drift, KEY/FOB H.Dat lines, **MTCom move-out** until office confirms semantics + unit linkage

---

## Office questions (blocking)

1. In Leasehold desktop, when staff records **notice to vacate** or **keys returned/issued**, which menu/action writes that fact?
2. Does that action update **`RA####RN.DAT`**, another suffix, or stay UI-only?
3. Can office produce **one property** with a known recent notice (e.g. PENN 303 Jul 24 target) and re-copy mirror → staging so we can diff RN before/after?

Until those are answered, **portal staff** remains the authoritative actor for planned/recorded move-out (as with MORRIS 313 / PENN 303 / 305).

---

## Implementation checklist

- [x] `buildExplicitLifecycleSignals` + tests
- [x] `buildImportPayload` lifecycle merge
- [x] `extractExplicitLifecycleEvents` stub (RN read, empty-safe)
- [x] `exportPropertySnapshots` returns `explicit_lifecycle_events`
- [x] `probe-lh-move-out-deep.mjs` — MTCom / LG / H.Dat code-2 analysis
- [ ] Parse `MTCom.Dat` **only if** office confirms date semantics + unit linkage path
- [ ] Add `RA####RN.DAT` to mirror fingerprint when parser is active
- [ ] Fixture test: real RN bytes → canonical signal
- [ ] End-to-end: `sync:changed` → V2 lifecycle receipt on staging property
