# Data Patcher Admin Guide

## What It Does

Data Patcher runs a SuiteQL query and applies body-field updates to records returned by that query.

Phase 1 supports header/body fields only.

## Job Model

A Data Patcher job is a **script deployment** with its own parameter values:

- SuiteQL
- behavior flags
- row/page controls
- schedule

Create one deployment per job so each remediation has clear ownership and logs.

## Required Query Shape

Your SuiteQL must return these columns:

- `recordtype`
- `recordid`
- update columns aliased as `fieldid_<fieldid>`

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

## Parameter Reference

- `SuiteQL` (required): query text used by the job.
- `Force Load + Save Mode`: use `record.load` + `record.save` instead of `submitFields`.
- `Dry Run`: logs intended updates without writing changes.
- `Stop On Error`: fail immediately on first record error.
- `Max Rows`: optional row cap per run (0 means uncapped).
- `Page Size`: query page size for `runSuiteQLPaged` (script enforces 5 to 1000).
- `Alias Prefix`: default `fieldid_`.
- `Query Custom Script ID`: optional query diagnostic owner tag.

## Runbook

1. Duplicate the default deployment.
2. Name deployment for the use case.
3. Paste validated query.
4. Keep `Dry Run = true` for first run.
5. Execute once and review logs.
6. Set `Dry Run = false`.
7. Execute again or add schedule.

## Update Mode Guidance

Use default `submitFields` mode when possible because it is lighter and faster.

Use `Force Load + Save` only when update behavior requires full load/save semantics.

## Troubleshooting

### No records updated
- Confirm query returns rows.
- Confirm aliases follow `fieldid_<fieldid>`.
- Confirm `Dry Run` is not still enabled.

### Errors on specific records
- Run with `Stop On Error = false` to continue and collect full failure list.
- Verify field permissions and editability for target records.
- Verify value compatibility for target field types.

### Sublist update requested
- Phase 1 does not support sublist changes.
- Route to Phase 2 design; do not force this through alias columns.

## Governance Notes

- `record.submitFields` updates body fields only.
- Ensure deterministic `ORDER BY` for paged SuiteQL.
- For large remediations, use capped runs and staggered schedules.
