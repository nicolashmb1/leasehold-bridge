# Handoff — LH office sync vs V2 JWT finance gate (2026-07-14)

## Symptom

Office Leasehold syncher updates snapshots, but **new ledger payments never post**. Mimic drifts (e.g. WESTGRAND 403, WESTFIELD 304/310 — Jul 13 payments). Cursor already has the key; `tenant_ledger_entries` does not.

## Root cause

1. Bridge → app `POST /api/financial/import/accounting-snapshots` (M2M secret + `x-propera-org-id`) — OK.
2. App → V2 `POST /api/portal/financial/accounting-import-signals` with **portal token only** (no staff session on import route).
3. V2 F-01 wraps that route in `gateWriteAny([...])` + `denyUnlessJwtFinanceProperty` → requires `req.portalOrg.source === "jwt"` → **`permission_denied` / `login_required`**.
4. App `materializeLeasesFromSignalsSafe` **swallows** the error → import still returns 200 → **cursor advances**.

Office sync is **Grand-only** for now. Syncher must not write other orgs.

---

## Fix on home PC — propera-v2 (required)

Work in your real `propera-v2` checkout (this office machine only has a fetchable `propera-v2-tmp` clone). Pull latest `main` first.

### Goal

Allow **machine import** of accounting signals when:

- Portal token is valid (existing `gate()`), and
- `x-propera-org-id` is present and equals an **allowlisted** org (phase 1: **`grand` only**), and
- `property_code` is in that org’s property scope,

**without** requiring a staff JWT. Do **not** reopen portal-token + default-org finance writes.

### Suggested design

1. **Env** (`.env.example` + Cloud Run prod config):

   ```text
   PROPERA_ACCOUNTING_IMPORT_M2M_ORG_IDS=grand
   ```

   Comma-separated; empty = M2M import disabled (fail closed).

2. **Helper** e.g. `src/portal/accountingImportM2mGate.js`:

   - `isAccountingImportM2mAllowed(org)` → true only if:
     - `org.source === "header"` (from `x-propera-org-id` via `resolvePortalOrgContext` — **not** `"default"`),
     - `normOrgId(org.orgId)` is in `PROPERA_ACCOUNTING_IMPORT_M2M_ORG_IDS`,
     - org has property codes.
   - Never treat `"default"` / missing header as M2M (blocks accidental Grand fallback).

3. **`financeOrgGate.js`**: add `requireFinancePropertyForImport(org, propertyCode)` (or extend existing helpers):

   - If JWT → same as today’s `requireJwtFinanceProperty`.
   - Else if M2M allowlisted header org → `assertPropertyInOrgScope` then allow.
   - Else → `login_required` / deny.

4. **`registerPortalRoutes.js`** — replace bare `gateWriteAny` on:

   `POST /api/portal/financial/accounting-import-signals`

   with something like:

   ```js
   gate(async (req, res) => {
     const body = req.body && typeof req.body === "object" ? req.body : {};
     const propertyCode = String(body.property_code ?? body.propertyCode ?? "").trim();

     // Staff path: JWT + permission
     if (String(req.portalOrg?.source || "") === "jwt") {
       if (await denyPortalPermissionAny(req, res, [
         "finance.import.run",
         "finance.lease.write",
         "finance.ledger.write",
       ])) return;
       if (!denyUnlessJwtFinanceProperty(req, res, propertyCode)) return;
       return handleAccountingImportSignals(req, res);
     }

     // Office M2M: portal token + explicit allowlisted org header only
     if (!isAccountingImportM2mAllowed(req.portalOrg)) {
       return res.status(403).json({ ok: false, error: "permission_denied" });
     }
     const scoped = denyUnlessFinancePropertyForImport(req, res, propertyCode);
     if (!scoped) return;
     return handleAccountingImportSignals(req, res);
   })
   ```

5. **Tests** (must fail closed):

   - Portal token + **no** org header → deny.
   - Portal token + header `other_org` not in allowlist → deny.
   - Portal token + header `grand` + property in Grand → allow (handler stub / smoke).
   - Portal token + header `grand` + property **not** in Grand → 404 `not_found`.
   - JWT staff with permission → still allow (unchanged).

6. Deploy V2 to prod (Cloud Run) after merge. Office sync talks to **prod** V2 via the app.

### Explicit non-goals

- Do not weaken other `gateFinance*` / ticket-cost JWT gates.
- Do not allow `source: "default"` for money writes.
- Syncher remains Grand-only via allowlist + app M2M `x-propera-org-id: grand`.

---

## Fix on home PC — propera-app (recommended, small, on top of your latest)

**Do not reset / force-push.** Office `master` was already equal to `origin/master` (`a2b8668`). Your home work stays; pull/merge only.

1. `git pull --ff-only` (or merge if you have local commits).
2. Small follow-up commit:

   - `materializeLeasesFromSignalsSafe`: **log and rethrow or surface** V2 errors on M2M import (or stop using Safe from `accountingSnapshotImport` for M2M). Import HTTP should fail if ledger materialize fails so the **bridge does not advance the cursor**.
   - When posting to V2 accounting-import-signals from import, send **`x-propera-org-id`** with the same org the M2M import authorized (Grand). Today `postV2PortalRestJson` may not attach that header — V2 M2M path needs `source: "header"`, not `"default"`.

3. Push a **new** commit only; never rewrite history that home already published.

Optional later: pop office stash `local store1/prevention WIP` only if you still want opening-balance guards — review carefully before applying.

---

## Bridge (pushed from office)

Uncommitted office WIP is intended for git:

- `STORE*` / alphanumeric unit labels (Murray STORE1)
- Full `unit_label` in snapshots (no `.slice(0,3)`)
- `syncChanged --only CODE`
- `x-propera-org-id` on import POST (`PROPERA_IMPORT_ORG_ID` / `PROPERA_DEFAULT_ORG_ID` / default `grand`)

At home: `cd leasehold-bridge && git pull`.

---

## Verify after deploy

1. Clear any orphan cursor keys for payments that never landed (or temporarily remove those keys, re-sync).
2. `node scripts/check_property_ledger.mjs` (portfolio) — expect match.
3. Force one known LH payment through sync; confirm `ledgerCreated >= 1` and a new `tenant_ledger_entries` row with matching `import_idempotency_key`.

## Temporary repairs already done in prod DB (do not re-insert)

| Property   | Unit | Date       | Amount  | Ref   |
|-----------|------|------------|---------|-------|
| WESTGRAND | 403  | 2026-07-13 | $400.00 | 17203 |
| WESTFIELD | 304  | 2026-07-13 | $2807.00 | 2183 |
| WESTFIELD | 310  | 2026-07-13 | $1000.00 | 17201 |
