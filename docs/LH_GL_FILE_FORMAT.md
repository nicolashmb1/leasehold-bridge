# Leasehold `A<prefix>GL.Y##` — general ledger file format and account map

**Status:** Reverse-engineered and verified 2026-08-01 against `lhmirror/` (snapshot dated **2026-06-03…06**)
**Why this exists:** the bridge parses tenant rent ledgers and deposit *balances*. It does **not** read the general ledger. The GL year files turned out to hold the double-entry history — including the deposit subledger — that Propera needs for F-08 and the GL print.
**Read with:** [`PROPERA_FINANCE_DEPOSITS.md`](../../propera-v2/docs/PROPERA_FINANCE_DEPOSITS.md) · [`PROPERA_GRAND_FINANCIAL_PARITY.md`](../../PROPERA_GRAND_FINANCIAL_PARITY.md)

> **No importer has been written.** This document is the analysis. Nothing in the bridge or Propera reads these files yet.

---

## 1. Files

One file per property per year: `A<accounting_prefix>GL.Y<yy>`.

| Property | Prefix | Year files present |
|---|---|---|
| WESTGRAND | `A318WG` | Y13–Y26 |
| WESTFIELD | `AWESTF` | Y16–Y26 |
| MURRAY | `AMURRA` | Y17–Y26 |
| PENN | `A705` | Y19–Y26 |
| MORRIS | `A540` | Y20–Y26 |

Non-Propera groups also present: `A354`, `A673`, `A676`, `A648TG`, `AFRMT`.

---

## 2. Record layout — 112 bytes, fixed width, no header

| Offset | Len | Type | Field |
|---:|---:|---|---|
| 0 | 6 | ascii | Entity / bank ref, space padded (`A705  `) |
| 6 | 8 | float64 LE | **Date** — Delphi `TDateTime` (days since 1899-12-30) |
| 14 | 40 | ascii | Description — payee, or `SURNAME #UNIT` for deposits |
| 54 | 5 | ascii | **Account code** + trailing space (`1000 `) |
| 59 | 8 | int64 LE | **Debit** — Delphi `Currency`, divide by 10,000 |
| 67 | 8 | int64 LE | **Credit** — same scaling |
| 75 | 7 | ascii | Transaction ref (see §4) |
| 82 | ~6 | ascii | Period (month number) |
| 88 | 4 | ascii | Year |
| 92 | 20 | ascii | Padding |

```js
const date  = new Date(Math.round((rec.readDoubleLE(6) - 25569) * 86400000));
const desc  = rec.toString("latin1", 14, 54).trim();
const acct  = rec.toString("latin1", 54, 58).trim();
const debit = Number(rec.readBigInt64LE(59)) / 10000;
const credit= Number(rec.readBigInt64LE(67)) / 10000;
const ref   = rec.toString("latin1", 75, 82).trim();
```

**Double entry is explicit.** Each transaction is written as two or more records sharing a date and ref — one per account. Verified: `APE3261` appears as `1000` credit 38,348.14 and `1002` debit 38,348.14.

---

## 3. Chart of accounts (observed across all five properties)

Row counts and totals are from the June 2026 snapshot, all years combined.

### Assets — **codes are property-specific, do not map org-wide**
| Code | Meaning | Rows | Bldgs |
|---|---|---:|---:|
| `1000` | Operating checking — one real bank account per property | 13,328 | 5 |
| `1002`–`1007` | **Varies by building** — see §3.1 | 1,416 | 5 |
| `1020` | Petty cash | 120 | 5 |
| `1035`–`1038`, `1050`, `1060`, `1080`, `1100` | Transfers, escrow, loans | ~50 | — |
| `1040` | Building / construction in progress | 2,591 | 5 |
| `1500` | Capital improvements | 198 | 5 |

#### 3.1 `1xxx` codes do NOT mean the same thing across buildings

| Code | WESTGRAND | WESTFIELD | MURRAY | MORRIS | PENN |
|---|---|---|---|---|---|
| `1002` | Engel / Coinbase | Engel bros | mixed admin | **Interstate Waste — construction, 676 rows, $50M** | **Samuel Engel** |
| `1005` | Coinbase | transfer | Larry Engel | Samuel Engel | **David Cohen** |

By contrast the `5xxx` expense codes **are** consistent portfolio-wide (`5203` exterminating, `5207` apt repair, `5216` cleaning, `5300` management fee all resolve identically at all five). So: expense categories may be org-wide; **cash/asset codes must be property-scoped.**

#### 3.2 "CHECKING 2 / 3 / 5" are partner ledgers, not bank accounts

Owner-confirmed 2026-08-01. Engel, Press and Cohen are **partners receiving interest**; the label is a Leasehold naming artifact. The money always leaves that property's own `1000` account as a check printed by LH. The `100x` account accumulates a cumulative per-partner total — PENN `1002` climbs 659,371.22 → 857,921.45 over six monthly Engel payments.

**Each property has exactly one real bank account.** MURRAY shows two in the history because the banking changed; only one is live.

### Liabilities and equity
| Code | Meaning | Rows | Bldgs | Note |
|---|---|---:|---:|---|
| `2000` | Legacy payables | 285 | 5 | **Ends 2021-04-08** — retired |
| **`2030`** | **Tenant deposits payable** | **2,341** | **5** | Dr 315,400.54 / Cr 2,030,616.94 / **net 1,715,216.40** |
| `2032`, `2035`, `2036` | Mortgage / loan payable | 23 | — | |
| `2050` | State tax withheld | 9 | 5 | |
| `3000` | Capital account | 8 | 3 | |

### Income
`4000` rental · `4004` parking · `4006` water · `4007` · `4008` amenity · `4009` · `4011` pet · `4012` storage · `4016` late · `4017` legal · `4018` other. Posted monthly as one `RC` batch per building.

### Expenses — **verified codes** (see §5 for the correction)
| Code | Meaning | Evidence |
|---|---|---|
| `5100` | RE taxes | CITY OF ELIZABETH |
| `5101` | Water & sewer | LIBERTY WATER |
| `5102` | Insurance | IPFS CORP |
| `5110` | Utilities | PSE&G, Verizon, Elizabethtown Gas |
| `5200` | Building repair | |
| `5202` | **Elevator** | SCHINDLER ELEVATOR CORP |
| `5203` | **Exterminating** | ZAP PEST CONTROL, MARIN EXTERMINATING |
| `5207` | **Apt repair** | SHERWIN WILLIAMS, ISMAEL FLORES |
| `5208` | Appliance repair | TOP LINE |
| `5213` | Landscaping | RJ LANSCAPING *(sic)* |
| `5215` | Supplies | Amex, Apple Card |
| `5216` | Cleaning service | ANA MUNAR, SOHO STEAM |
| `5300` | Management fee | GRAND MANAGEMENT GROUP |
| `5301` | Accounting | LOU GOLD CPA |
| `5305` | Payroll / treasury | UNITED STATES TREASURY |
| `5307` | Misc administrative | |
| `5309` | R.E. commission | |
| `5310` | Fire alarm | H&J SECURITY |
| `5311` | **Legal fee** | STIER AND LEIBOWITZ |
| `5312`–`5314` | Credit cards | Amex, Chase |
| `5400` | **Interest expense** | MANASQUAN, UNIVEST — **16,310,827.95**, the largest expense account |

---

## 4. Transaction ref codes (offset 75)

The ref both identifies the instrument and, for deposits, the **deposit type** — no description parsing required.

| Ref | Rows | Meaning |
|---|---:|---|
| `SRESECU` | 1,412 | Security deposit |
| `SREKEY` | 465 | Key deposit |
| `APE####` | 127 | AP check — **the deposit refund / payout side** (289,112.19 Dr) |
| `SRjSECU` | 115 | Security, alternate batch |
| `SREOthe` | 31 | Other deposit |
| `SRERent` | 26 | Rent security |
| `SREADJ` | 26 | Adjustment |
| `SREPET` | 24 | Pet deposit |
| `VCE####` | 5 | Voided check |
| long tail | ~40 | `SRE2ND`, `SREREMO` (remote/fob), `SREBOUN` (bounced), `SREREFU`, `SREINT`… |

Maps onto Propera's model as: `SRE*`/`SRj*` suffix → `deposit_kind`; `APE`/`SREREFU` → `refund`; `SREADJ` → `adjustment_*`; `VCE` → void.

---

## 5. CORRECTION — two shipped category codes are wrong

`PROPERA_GRAND_FINANCIAL_PARITY.md` §3.2 was written from a **photograph** of the GL print whose left column was partly cut off. Two codes were misread, and migration **164** seeded them into `org_finance_categories` in production:

| Seeded | Should be | Evidence |
|---|---|---|
| `5202 EXTERMINATING` | **`5203 EXTERMINATING`** | ZAP PEST posts to 5203; 5202 is Schindler Elevator |
| `5205 APT REPAIR` | **`5207 APT REPAIR`** | Sherwin Williams posts to 5207 |

Also seeded with **empty** `export_account_code` although LH has a code:

| Seeded | Should be |
|---|---|
| `LEGAL FEE` | **`5311`** |
| `INTEREST EXP (partner)` / `(lender)` | **`5400`** |

**Not in the seed at all**, despite large real volume: `5100` RE taxes (5.66M), `5102` insurance (1.11M), `5110` utilities (648k), `5200` building repair (547k), `5202` elevator (199k), `5301` accounting, `5305` payroll, `5312`–`5314` cards, and `5400` interest (16.3M).

**Consequence:** Propera's expense-by-account export currently labels PENN exterminating as 5202 and apt repair as 5205. Grand's accountant would have to re-map both. Fix before the accountant package is put in front of anyone.

**Rule going forward: verify account codes against the GL files, never against a printout.**

---

## 6. Deposit subledger — what is actually recoverable

### 6.1 Each building's deposit ledger has its own start date

Account 2030 does not begin when the building opened; it begins when that building was loaded into this account structure. The first row per unit is an **opening balance carried in**, not a move-in receipt.

| Building | Deposit ledger opens | Signature |
|---|---|---|
| WESTGRAND | **2014-06-05** | all 22 units, 44 rows, one day — bulk load |
| WESTFIELD | early 2017 | spread Jan–Apr 2017 |
| MURRAY | mid-2019 | spread Jul–Oct 2019 |
| PENN | **2024-01-24** | 47 of 91 units, 77 rows, one day — bulk load |
| MORRIS | **2024-08-14** | 19 units, 32 rows |

**Therefore no source, including LH, has per-unit deposit transactions before these dates.** An import mirrors LH's subledger *including its own opening balances*. That is defensible: Propera would hold what LH holds, line for line. It is not the same as inventing a cutover.

### 6.2 Reconciliation result — PENN, 91 units

Tested against Propera's `unit_leases` deposit columns:

- **64 units** reconcile on full 2030 history (tenant never changed).
- **20 more** reconcile when cut at the most recent large security posting (unit turned over).
- **7 do not** — analysed in §6.4.

### 6.3 Account 2030 accumulates — you cannot just sum it

Move-out refunds frequently post as `APE` checks against the tenant, not as 2030 debits per unit. A unit that has turned over shows the sum of every tenancy. Unit 318 carries $20,075 across four tenancies; the sitting tenant's deposit is $5,500.

**LH books a new move-in security deposit under `VACANT #nnn`, and only the key deposit under the tenant's name.** That `VACANT` posting is the reliable move-in marker.

Propera's own dates cannot substitute: `unit_leases.lease_start` is the current *renewal* date (91 PENN units cluster on 2026-05-01), and all 92 `unit_occupancies.started_at` values fall inside 2024-05…2026-08 because they were seeded at import. **Propera does not currently know when anyone moved in; the GL does.** Worth fixing independently of deposits.

### 6.4 The seven PENN exceptions (owner-reviewed 2026-08-01)

| Unit | Propera | GL net | Cause |
|---|---:|---:|---|
| 216 | 4,475.00 | 4,356.50 | 2 tenancies; earlier one predates 2024-01-24. Gap is post-snapshot activity |
| 218 | 5,640.00 | 9,574.50 | Tenant change. Prior tenant's 3,984.50 never refunded out |
| 303 | 5,142.50 | 9,742.00 | Tenant change, new tenant just moved in |
| 305 | 6,100.00 | 4,713.50 | New tenant, lease starts 2026-08-01 — after the snapshot |
| 306 | 4,425.00 | 4,656.50 | Post-snapshot |
| 413 | 4,575.00 | 4,791.50 | 2 tenancies. Propera key deposit 300.00 vs LH 200.00 — **owner to verify in the office** |
| 509 | 4,667.00 | 8,682.00 | **LH misposting** — see below |

**Unit 509 — a two-year-old un-reversed error in LH.** FAJARDO H's deposit of 4,015.00 was posted to #509 on 2024-02-24, then re-posted to their real unit **#517** on 2024-03-11. The #509 side was never reversed. The owner confirms 509 has only ever had one occupancy. COSTA CORDEIRO's 4,667.00 matches Propera exactly.

**Conclusion: Propera's balances (from R.Dat "balance on file") are more reliable than the 2030 account totals**, because the account accumulates un-reversed errors. Design accordingly — **balances are authority for what is held; the GL is authority for how it moved; the importer reconciles the two and reports the difference.** The 4,015 on 509 is exactly what an exceptions schedule should surface.

---

## 6A. The other files that matter (decoded 2026-08-01 against MORRIS / `A540`)

The GL year files are only one of five structures. All were verified against MORRIS.

### 6A.1 `A<prefix>EX.DAT` — chart of accounts **and** balances

**124-byte records.** Offsets 0–19: account name, right-padded, with the code in the last 4 characters (`Checking       1000`). Offsets 20+: twelve 8-byte `Currency` slots.

| Offset | Meaning |
|---:|---|
| 0–19 | name (15 chars) + account code (4) |
| 20–27 | unused / zero |
| **28–35** | **opening balance** |
| 36–123 | month-end balance, one slot per month |

**Verified exactly.** MORRIS `1000 Checking` opens at **795,977.09**; each slot delta equals the GL's monthly net flow to the cent (Jan +52,556.23, Feb −41,369.35, Mar +33,257.72, Apr +16,901.23).

MORRIS defines **93 accounts**. Balance-sheet accounts hold true balances; income and expense accounts hold year-to-date cumulative. `.Y##` variants archive prior years.

**This file is the authority for account codes** — not the printed GL, whose left column truncates (see §5).

### 6A.2 `A<prefix>D.Dat` — deposit register (the money-in side)

**35-byte records:** date `MM/DD/YYYY` (10) + description (17) + amount (`Currency`, 8).

```
06/05/2026  411  105        3055.86     <- unit, tenant's cheque no., amount
06/05/2026  209  152        3168.44
06/05/2026  End-Batch# 54      0.00     <- batch terminator
```

Description is `<unit>  <tenant cheque no.>` for rent, or free text for other receipts. **`End-Batch# N` rows terminate a batch** — one physical deposit slip. MORRIS batch 54 = 8 cheques totalling **18,332.76**, which is the single line the bank statement shows.

MORRIS: 2,398 records, 2,106 money lines, 292 batches, Jan 2023 → Jun 2026, **$24,020,173.91**. Of that, **97 non-tenant records total $19,946,357** — construction draws, wire-ins, cash injections booked to `1040`/`1002`, not `1000`.

**Propera has no equivalent of the batch.** It records the payments but not the grouping, which is what the owner matches against his statement.

### 6A.3 `A<prefix>BT.DAT` — batch counter

4 bytes, ASCII + CRLF. MORRIS reads `54`, matching the last `End-Batch# 54`.

### 6A.4 `A<prefix>DS.DAT` — last posting date

12 bytes, `MM/DD/YYYY` + CRLF.

### 6A.5 `BANK.DAT` — bank account master (portfolio-wide, **not** per property)

**462-byte records, 9 accounts.** Holds bank name, address, phone, the entity (`THE GRAND AT PENN LLC`), the **fractional routing number** (`55-7216/2212`), a **MICR block** carrying routing and account number, and the GL account the bank account maps to (`1000`).

| Property | Bank | State |
|---|---|---|
| WESTGRAND / WESTFIELD | Manasquan Savings, Wall Township | NJ |
| MORRIS `A540` | Citizens & Northern, Wellsboro | **PA** |
| PENN `A705`, RIVER, PENN NORTH, PENN SOUTH | Univest Bank & Trust, Souderton | **PA** |

**Most property accounts are at Pennsylvania banks with no NJ branches** — which is why cash cannot be deposited directly and must route through the holding account.

> ⚠️ **Field offsets are not fully mapped.** Records bleed at the boundaries in the current parse — the entity name picks up the previous record's city. Numerics that look like cheque counters (5250, 5736, 2948) do not line up with PENN's 2026 cheque range of 3261–3411, so **do not treat any of them as the next-cheque field until the offsets are resolved.**
>
> **Contains live bank account numbers. Never print, log, or commit them.** Any importer must treat this as the most sensitive file in the mirror.

### 6A.6 Not yet decoded

`A<prefix>TR.DAT` (MORRIS 942,832 B) and the `RA####*` family beyond the deposit/lease parsers the bridge already has.

---

## 6B. Cash received ≠ income recognised

Tested on MORRIS, and it changes how an importer must behave.

`D.Dat` is **real-time**; the GL's `RCE` line is **month-end**. June 2026: **$91,944.89** deposited, **$0.00** posted to `RCE`.

They do not reconcile at month-end either. Across twelve complete months tenant deposits exceeded `RCE` by ≈**$74,787** — $17,179 of it security deposits (acct `2030`), the remaining ≈$57,600 (~2.6%) month-boundary timing and other non-rent cash.

**Therefore:**

1. A bank register **cannot** be derived from GL income postings.
2. Cash deposits and income recognition are **separate facts**; both must be recorded.
3. **Never import both `D.Dat` and the `RCE` lines as cash** — they partially overlap and would double-count.

**Owner-confirmed 2026-08-01:** the bank slips and the general ledger are *different reports*. The GL is printed for the accountant with rent aggregated monthly; **the slips keep every posting separate, including rent**, and that is what he ties to the bank weekly. So the balance is live, and cash must post per transaction.

---

## 7. How Leasehold uses account `1000` (owner-reported 2026-08-01)

Context that determines what an importer has to reproduce:

1. The starting balance was entered **once**, when the building was registered in Leasehold.
2. From then on **every payment, deposit and transaction is written to the account** — the "bank slips."
3. **The owner ties Leasehold's balance to the real bank balance, to the cent, every week**, specifically to catch fabricated entries. The derived balance is a fraud detector, not a report.
4. **Leasehold writes and prints the checks itself**, using the account's routing and account number and drawing on a tracked check stock.

Consequences for Propera, tracked in [`PROPERA_GRAND_FINANCIAL_PARITY.md`](../../PROPERA_GRAND_FINANCIAL_PARITY.md) §4.2 and §4.5:

- The `1000` balance must be **derived** (opening + movements), never stored — a stored figure can be edited, which is the exact fabrication being guarded against.
- Propera today records money **out** only; rent lands on the resident ledger, not the building account. The money-in side is the substantial half of the work.
- Propera stores `routing_number` in full but only `account_last4`. A check's MICR line needs the complete account number, so **Propera cannot currently print a check.** Storing it requires encryption at rest with audited access.
- `next_check_number` is a counter, not stock. Stock needs a range plus used / voided / spoiled state, so a jammed or destroyed check can never be reused.

---

## 8. Before any import runs

1. **Fresh mirror required.** This snapshot is 2026-06-03…06; the office sync (robocopy → staging → Task Scheduler) was specified but never finished. Several PENN exceptions above are purely staleness.
2. Only PENN was reconciled. WESTGRAND (12 years of movement, 22 units), WESTFIELD, MURRAY and MORRIS are unvalidated.
3. Resolve unit 413 in the office.
4. Decide how `APE` refund rows attach — they carry a payee name, not a unit.
5. 23 PENN 2030 rows carry no unit token; they need name matching or manual assignment.
