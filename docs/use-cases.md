# Data Patcher Use-Case Scenarios

This document provides practical scenarios for the Data Patcher paradigm.

## Scenario 1: Backfill Missing Transaction Header Value

Goal: fill a custom body field for historical sales orders.

```sql
SELECT
  'salesorder' AS recordtype,
  t.id AS recordid,
  'Legacy Migration' AS fieldid_custbody_order_source
FROM transaction t
WHERE t.type = 'SalesOrd'
  AND t.custbody_order_source IS NULL
ORDER BY t.id
```

Recommended settings:

- `Dry Run = true` (first pass)
- `Max Rows = 2000`
- `Force Load + Save = false`

## Scenario 2: Close Out Stale Vendor Bills Flag

Goal: clear an outdated body flag on old vendor bills.

```sql
SELECT
  'vendorbill' AS recordtype,
  t.id AS recordid,
  'F' AS fieldid_custbody_needs_manual_review
FROM transaction t
WHERE t.type = 'VendBill'
  AND t.custbody_needs_manual_review = 'T'
  AND t.trandate < ADD_MONTHS(CURRENT_DATE, -6)
ORDER BY t.id
```

Recommended settings:

- `Dry Run = true`, then `false`
- `Stop On Error = false` to collect full failure set
- `Force Load + Save = false`

## Scenario 3: One-Time Customer Segmentation Update

Goal: stamp a customer segment body value after a model run.

```sql
SELECT
  'customer' AS recordtype,
  c.id AS recordid,
  'High Value' AS fieldid_custentity_segment_label
FROM customer c
WHERE c.isinactive = 'F'
  AND c.balance > 50000
ORDER BY c.id
```

Recommended settings:

- `Max Rows = 1000` for staged rollout
- separate deployments for each segment wave

## Scenario 4: Scheduled Weekly Hygiene Job

Goal: enforce a default ownership body field weekly.

```sql
SELECT
  'supportcase' AS recordtype,
  sc.id AS recordid,
  123 AS fieldid_custevent_case_owner
FROM supportcase sc
WHERE sc.custevent_case_owner IS NULL
ORDER BY sc.id
```

Recommended settings:

- recurring weekly schedule on deployment
- `Dry Run = false` after first validated run
- `Stop On Error = false`

## Scenario 5: Force Load/Save Fallback

Goal: use full record save behavior for a known edge case.

Use same query shape, but set:

- `Force Load + Save = true`

Use this only when `submitFields` behavior is insufficient.

## Scenario 6: Update a Specific Item Sublist Line

Goal: update one line-level custom field by `lineuniquekey`.

```sql
SELECT
  'salesorder' AS recordtype,
  t.id AS recordid,
  'item' AS sublistid,
  tl.lineuniquekey AS lineuniquekey,
  'T' AS linefield_custcol_needs_reprice
FROM transaction t
JOIN transactionline tl ON tl.transaction = t.id
WHERE t.type = 'SalesOrd'
  AND t.id = 12345
  AND tl.mainline = 'F'
ORDER BY t.id, tl.lineuniquekey
```

Recommended settings:

- `Dry Run = true`, then `false`
- `Force Load + Save = false` (ignored for line updates because load/save is required)
- `Stop On Error = true` for targeted fixes

## Query Construction Notes

- Always include deterministic `ORDER BY`.
- Always return `recordtype` and `recordid` aliases exactly.
- Use `fieldid_` alias prefix for every update field.
- Keep result set to one row per target record whenever possible.
