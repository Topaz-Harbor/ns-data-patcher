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
- Add the parameters documented in `docs/admin.md`.
- Keep IDs aligned to the script defaults for portability.

4. Create first deployment.
- Deployment script ID:
  - `_th_data_patcher_default`
  - NetSuite auto-prefixes `customdeploy`.
- Status:
  - `Testing`
- Deployed:
  - `Checked` only when query has been dry-run validated.

5. Configure and run first dry run.
- Paste SuiteQL.
- Enable `Dry Run`.
- Execute once.
- Validate logs.

## Rollback

If behavior is not acceptable:

1. Set deployment to `Not Deployed`.
2. Remove schedule and audience access.
3. Disable or delete deployment after review.
