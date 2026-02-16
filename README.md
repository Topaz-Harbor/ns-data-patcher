# Data Patcher (Topaz Harbor NetSuite Admin Utility)

Data Patcher is a Topaz Harbor NetSuite admin utility for scheduling batch updates driven by SuiteQL results.

## Utility Family

This utility is part of the **Topaz Harbor Admin Utilities** lineup.

## What It Does

- Runs scheduled Map/Reduce jobs from a SuiteQL query.
- Updates body fields on existing records.
- Updates sublist line fields on existing records.
- Optionally creates new records from query rows.
- Optionally deletes records from query rows.
- Uses Inline Edit (`record.submitFields`) for body updates when possible.
- Automatically uses load/save for sublist updates.
- Groups load/save updates by record in `reduce()` to minimize repeated loads/saves.

## Core Paradigm

Each deployment run executes one SuiteQL statement.
The script reads each result row and runs an action.

Required columns by action:

- `recordtype` for all actions
- `recordid` for `update` and `delete`
- `recordid` not required for `create`

Action and alias conventions:

- `action` (`update` default, optional `create`, `delete`)
- body fields: `fieldid_<fieldid>`
- sublist fields: `linefield_<fieldid>`

For sublist updates (`linefield_` aliases), include:

- `sublistid`
- one line locator: `lineindex` (0-based), `linenumber` (1-based), or `lineuniquekey`

## Advanced: Ordered Operations

- `operationsequence` (number): lower values are applied first when multiple rows update the same record.

## Admin-Friendly Scheduling Model

Use **multiple deployments of the same script** to create separate jobs, for example:

- nightly transaction cleanup
- weekly backfill
- one-time remediation run

Each deployment can have its own SuiteQL and script parameters.

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

## License

This project is licensed under the MIT License.
