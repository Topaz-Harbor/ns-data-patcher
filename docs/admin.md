# Data Patcher Admin Guide

## What It Does

Data Patcher runs a SuiteQL query and applies update/create/delete actions from query results.
It supports:
- body/header updates
- sublist line updates
- optional create/delete actions (when explicitly enabled)

## Job Model

A Data Patcher job is a **script deployment** with its own parameter values:

- SuiteQL
- behavior flags
- row/page controls
- schedule

Create one deployment per job so each remediation has clear ownership and logs.

## Required Query Shape

Your SuiteQL must return these columns:

- `recordtype` (required for all actions)
- `recordid` (required for `update` and `delete`; not required for `create`)
- update columns aliased as `fieldid_<fieldid>` for body fields
- optional sublist columns aliased as `linefield_<fieldid>` for line fields
- when using sublist aliases, include:
  - `sublistid`
  - `lineuniquekey`
- optional `action` column:
  - `update` (default if omitted)
  - `create` (requires non-update actions enabled)
  - `delete` (requires non-update actions enabled)

Example:

```sql
SELECT
  t.recordtype AS recordtype,
  t.id AS recordid,
  'Ready for Fulfillment' AS fieldid_custbody_order_stage,
  CURRENT_DATE AS fieldid_custbody_last_patched_date
FROM transaction t
WHERE t.type = 'SalesOrd'
  AND t.custbody_order_stage IS NULL
ORDER BY t.id
```

## Advanced: operationsequence

Use `operationsequence` only when multiple query rows target the same record and row order matters.

How it behaves:

- Lower numbers are applied first.
- Rows without `operationsequence` are applied after numbered rows.
- Equal values do not guarantee ordering between those rows.

Example (two rows update the same line field on one record):

```sql
SELECT
  'update' AS action,
  'salesorder' AS recordtype,
  12345 AS recordid,
  'item' AS sublistid,
  '22019073' AS lineuniquekey,
  10 AS operationsequence,
  'A' AS linefield_custcol_stage_marker
FROM dual
UNION ALL
SELECT
  'update' AS action,
  'salesorder' AS recordtype,
  12345 AS recordid,
  'item' AS sublistid,
  '22019073' AS lineuniquekey,
  20 AS operationsequence,
  'B' AS linefield_custcol_stage_marker
FROM dual
```

In this example, final value is `B` because sequence `20` is applied after `10`.

## Parameter Reference

| Name | Use | Notes | Frequency |
|---|---|---|---|
| `SuiteQL` | Defines which rows and values to process. | Required for every job. | Often |
| `Dry Run` | Preview changes without writing data. | Keep enabled for first run in each environment. | Often |
| `Max Rows` | Limits rows per execution. | Use for staged rollouts and risk control. `0` means uncapped. | Often |
| `Stop On Error` | Tries to halt processing after first error. | Best-effort in parallel processing; some in-flight writes may still finish. | Sometimes |
| `Force Load + Save Mode` | Forces body updates through `record.load` + `record.save`. | Use when Inline Edit (`record.submitFields`) fails in edge cases. | Sometimes |
| `Enable Create/Delete Actions` | Allows `action=create` and `action=delete`. | Leave off unless job intentionally creates or deletes records. | Sometimes |
| `Alias Prefix` | Controls body-field alias prefix parsing. | Default `fieldid_`; change only if query convention differs. | Rarely |
| `Query Custom Script ID` | Adds a query diagnostic ownership tag. | Optional advanced tuning/ownership tag. | Rarely |

## Advanced: Query Custom Script ID

- `Query Custom Script ID` is an optional performance/diagnostic tag for SuiteQL ownership.
- Most admins can leave the default value.
- Use case: set a unique value when running high-volume jobs so technical teams can quickly identify and tune that specific query in logs and performance review.

## Runbook

Use this runbook as the standard operating procedure for configuring Data Patcher jobs.

1. Duplicate the default deployment.
2. Name deployment for the use case.
3. Paste validated query.
4. Keep `Dry Run = true` for first run.
5. Execute once and review logs.
6. Set `Dry Run = false`.
7. Execute again or add schedule.

Pro Tip: when running Dry Run on large datasets, set `Max Rows` to a small value (for example `10`) to keep preview logs manageable.

## Update Mode Guidance

Use default Inline Edit mode (`record.submitFields`) when possible because it is lighter and faster.

Use `Force Load + Save` only when update behavior requires full load/save semantics or when Inline Edit fails for unexplained edge-case behavior.

Create/delete actions ignore Inline Edit mode and run through record create/delete APIs.
Load/save updates are grouped and applied in `reduce()` once per record to avoid repeated load/save cycles.

## Troubleshooting

### No records updated
- Confirm query returns rows.
- Confirm aliases follow `fieldid_<fieldid>`.
- Confirm `Dry Run` is not still enabled.

### Errors on specific records
- Run with `Stop On Error = false` to continue and collect full failure list.
- Verify field permissions and editability for target records.
- Verify value compatibility for target field types.

### Stop On Error still allowed some writes
- Behavior is best-effort in parallel processing.
- In-flight operations can finish before they observe the shared abort flag.
- Review summary counts, especially `aborted`, to understand where execution stopped.

### Sublist update requested
- Use `linefield_` aliases and include required locator columns.
- Sublist updates always run in load/save mode; Inline Edit cannot update lines.

### Create/delete rows are ignored
- Confirm `Enable Create/Delete Actions` is checked on deployment.
- Confirm `action` column values are exactly `create` or `delete`.

## Governance Notes

- Inline Edit (`record.submitFields`) updates body fields only.
- Sublist line updates require `record.load` + `record.save`.
- Create/delete actions are deployment-gated by `Enable Create/Delete Actions`.
- Ensure deterministic `ORDER BY` for stable and repeatable query runs.
- For large remediations, use capped runs and staggered schedules.
- `Stop On Error` stops the run as quickly as possible after the first error, but some in-flight changes may still finish.
