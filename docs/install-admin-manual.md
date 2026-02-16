# Install Guide: Admin Manual Path (No SDF)

Use this path if you are a NetSuite admin installing directly in the account UI.

## Prerequisites

- NetSuite role with access to:
  - File Cabinet
  - Script records
  - Script deployments
- Script file from this repo:
  - `Data Patcher/src/FileCabinet/SuiteScripts/topazHarbor/dataPatcher/th_data_patcher_mr.js`

## Steps

1. Upload script file to File Cabinet.
- Suggested folder:
  - `SuiteScripts/topazHarbor/dataPatcher/`
- Keep filename:
  - `th_data_patcher_mr.js`

2. Create Map/Reduce script record.
- NetSuite path:
  - `Customization > Scripting > Scripts > New`
- Script type:
  - `Map/Reduce Script`
- Name:
  - `TH Data Patcher`
- Script ID:
  - `_th_data_patcher`
  - NetSuite auto-prefixes `customscript`.

3. Add script parameters.
- Create these parameters exactly:

| Title | ID (what admin enters) | Type | Default Value |
|---|---|---|---|
| SuiteQL | `_th_dp_suiteql` (final: `custscript_th_dp_suiteql`) | Long Text | _(blank)_ |
| Force Load + Save Mode | `_th_dp_force_loadsave` (final: `custscript_th_dp_force_loadsave`) | Check Box | unchecked |
| Dry Run | `_th_dp_dry_run` (final: `custscript_th_dp_dry_run`) | Check Box | checked |
| Stop On Error | `_th_dp_stop_on_error` (final: `custscript_th_dp_stop_on_error`) | Check Box | unchecked |
| Max Rows | `_th_dp_max_rows` (final: `custscript_th_dp_max_rows`) | Free-Form Text | `0` |
| Alias Prefix | `_th_dp_alias_prefix` (final: `custscript_th_dp_alias_prefix`) | Free-Form Text | `fieldid_` |
| Query Custom Script ID | `_th_dp_custom_script_id` (final: `custscript_th_dp_custom_script_id`) | Free-Form Text | `th_data_patcher` |
| Enable Create/Delete Actions | `_th_dp_enable_actions` (final: `custscript_th_dp_enable_actions`) | Check Box | unchecked |

4. Create first deployment.
- Deployment script ID:
  - `_th_data_patcher_default`
  - NetSuite auto-prefixes `customdeploy`.
- Status:
  - `Testing`
- Deployed:
  - `Checked` so you can execute dry-run validation.
  - Keep status `Testing` during dry-run and early verification.

5. Configure and run first dry run.
- Paste SuiteQL.
- Enable `Dry Run`.
- Execute once.
- Validate logs.

## Rollback

If behavior is not acceptable:

1. Set deployment to `Not Deployed`.
2. Remove or pause the deployment schedule.
3. Disable or delete deployment after review.
