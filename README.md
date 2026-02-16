# Data Patcher (Topaz Harbor NetSuite Admin Utility)

Data Patcher is a Topaz Harbor NetSuite admin utility for scheduling batch updates driven by SuiteQL results.

## Utility Family

This utility is part of the **Topaz Harbor Admin Utilities** lineup.

## Current Scope

- Scheduled batch updates for body/header fields and sublist lines.
- Optional action-driven create/delete from query results (gated by script parameter).
- Query-driven updates with a column alias convention.
- Default update path: `record.submitFields(...)`.
- Automatic `record.load(...)` + `record.save(...)` for sublist changes.
- Optional override path for body-only updates: `record.load(...)` + `record.save(...)`.

## Core Paradigm

Each deployment run executes one SuiteQL statement. The query must return:

- `recordtype`
- `recordid`
- one or more update columns aliased as `fieldid_<actual_field_id>`

Example alias:

- `fieldid_custbody_target_date`

The script reads each result row and updates the target record using the alias mapping.

## Admin-Friendly Scheduling Model

Use **multiple deployments of the same script** to create separate jobs, for example:

- nightly transaction cleanup
- weekly backfill
- one-time remediation run

Each deployment can have its own SuiteQL and script parameters.

## Query Alias Conventions

- Body fields: `fieldid_<fieldid>`
- Sublist fields: `linefield_<fieldid>`
- Action: `action` (`update` default, optional `create`, `delete`)
- Sublist target columns (required when using `linefield_` aliases):
  - `sublistid`
  - one line locator: `lineindex` (0-based), `linenumber` (1-based), or `lineuniquekey`

## Installation Paths

- Admin manual install (no SDF): `docs/install-admin-manual.md`
- Developer SDF install: `docs/install-developer-sdf.md`
- Post-install operations and troubleshooting: `docs/admin.md`

## Testing and Verification

- Current verification record: `docs/testing-verification.md`
- Validation command:
  - `suitecloud project:validate`

## Repository Layout

- SDF project root: `Data Patcher/`
- Script file:
  - `Data Patcher/src/FileCabinet/SuiteScripts/topazHarbor/dataPatcher/th_data_patcher_mr.js`
- Script object:
  - `Data Patcher/src/Objects/customscript_th_data_patcher.xml`

## Planned Updates

- See `docs/planned-updates.md`.

## License

This project is licensed under the MIT License.
