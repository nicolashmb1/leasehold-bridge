# Working from home

## Mirror path

This project **only** reads Leasehold data from:

```text
D:\Projects\leasehold-bridge\lhmirror
```

The mirror snapshot lives **inside** `leasehold-bridge/` (gitignored — do not commit). Config and env must agree:

```powershell
$env:LEASEHOLD_MIRROR_ROOT = "D:\Projects\leasehold-bridge\lhmirror"
```

Do not use `\\lhdata\lhmirror` or OneDrive copies unless you intentionally switch for production sync.

## Repo location

Open `D:\Projects` in Cursor. Package:

```text
leasehold-bridge/
├── MANIFEST.md
├── config/
│   ├── mirror.json
│   └── property-mapping.json
├── schema/
└── lhmirror/          ← 820 flat files (gitignored)
```

## Setup checklist (home PC)

- [x] `leasehold-bridge` copied from external drive into `D:\Projects`
- [x] `lhmirror` copied into `leasehold-bridge/lhmirror`
- [x] Config paths point at `D:\Projects\leasehold-bridge\lhmirror`
- [ ] Confirm `Test-Path D:\Projects\leasehold-bridge\lhmirror\PROPA.BAK`
- [ ] In Propera portal → Settings → Properties: confirm **702 Penn** code is `PENN` (Leasehold internal `705` / RA0006)
- [ ] Do **not** commit `lhmirror/` or CSV exports with tenant PII

## Next task

Parser proof for **RA0001** (Westgrand) → CSV: unit, balance, last transaction.

## Office sync (later)

Same parsers; point `LEASEHOLD_MIRROR_ROOT=\\lhdata\lhmirror` from a machine on the office LAN.
