# Install Guide: Developer Path (SDF)

Use this path if you manage NetSuite code with SuiteCloud CLI.

## Prerequisites

- Node.js and SuiteCloud CLI installed.
- Authentication ID configured for target account.
- Access to deploy scripts and objects.

## Project Location

Run commands from:

- `Data Patcher/`

This is the SDF project root (contains `suitecloud.config.js` and `src/`).

## Steps

1. Clone the repository.

```bash
git clone https://github.com/Topaz-Harbor/ns-data-patcher.git
```

2. Move into the repository and SDF project root.

```bash
cd ns-data-patcher/"Data Patcher"
```

3. Run `suitecloud account:setup` and select your environment to deploy to.

4. Validate project structure.

```bash
suitecloud project:validate
```

5. Deploy project.

```bash
suitecloud project:deploy --accountspecificvalues WARNING
```

6. Confirm deployed objects.

- Script record:
  - `customscript_th_data_patcher`
- Deployment:
  - `customdeploy_th_data_patcher_default`

7. Create additional deployments for each job.

- One deployment per use case/query.
- Keep run schedules separate.

## Suggested Post-Deploy Checks

- Open script deployment and confirm parameters appear.
- Run a dry-run query with 1-5 rows.
- Confirm audit summary log and per-row preview logs.

## Troubleshooting

- If validation/deploy fails, log validation output:

```bash
suitecloud project:validate --log ./validation.log
```

- Re-run `suitecloud account:setup` if the account target is wrong.
- Optionally run server validation:

```bash
suitecloud project:validate --server --log ./validation.log
```
