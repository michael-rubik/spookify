# GitHub Actions workflow debugging handoff

## Goal

Debug GitHub Actions workflows in this repository using the GitHub CLI (`gh`) and the repo’s actual Supabase deployment setup.

## Scope

This repo uses a migration workflow in [.github/workflows/supabase.yml](../.github/workflows/supabase.yml).

The workflow depends on these repository settings:

- secret: `SUPABASE_ACCESS_TOKEN`
- secret: `SUPABASE_DB_PASSWORD`
- variable: `SUPABASE_PROJECT_ID`

The project is linked to Supabase project ref:

- `uesibydxklrbxykvjcah`

This value is currently reflected in [supabase/.temp/project-ref](../supabase/.temp/project-ref).

## Important note about sessions

An agent can run `gh` commands in a terminal session on this machine if GitHub CLI is installed and authenticated in that session.

It cannot magically trigger a second independent GitHub user session beyond the local environment already authenticated. Actual workflow execution still happens by:

- pushing to the `main` branch, or
- manually running the workflow in GitHub UI.

The CLI is used to inspect, diagnose, and validate workflow state; it is not a substitute for the GitHub Actions runtime itself.

## Prerequisites

1. Ensure `gh` is installed.
2. Ensure the shell is authenticated.
3. Ensure the working directory is the repo root.

Run:

```bash
gh auth status
gh repo view --json nameWithOwner,defaultBranchRef
```

If `gh` is not recognized, install GitHub CLI and reopen the terminal before continuing.

## Repo-specific verification commands

From the repository root:

```bash
gh secret list
gh variable list
gh workflow list
gh run list --limit 20
```

To inspect the workflow file in GitHub:

```bash
gh workflow view "Deploy Supabase migrations"
```

To inspect a specific run:

```bash
gh run view <run_id> --log-failed
```

To watch a run live:

```bash
gh run watch <run_id>
```

To manually trigger the workflow on `main`:

```bash
gh workflow run supabase.yml --ref main
```

## Workflow debugging checklist

### 1. Confirm repo configuration

Run:

```bash
gh secret list
gh variable list
```

Check for:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_ID`

If any are missing, the workflow fails before migration commands run.

### 2. Check workflow runs

```bash
gh run list --limit 20
gh run view <run_id> --log-failed
```

Look for:

- auth failures
- missing secrets/vars
- `supabase link` errors
- migration conflict errors
- database password or project ref issues

### 3. Validate the Supabase CLI locally

From the repo root, check the linked project and migration state:

```bash
Get-Content .\supabase\.temp\project-ref
npx supabase db push --dry-run --linked --password "$env:SUPABASE_DB_PASSWORD"
```

A healthy result looks like:

```text
{"upToDate":true,"dryRun":true,"migrations":[],...}
```

If this fails locally, it is likely to fail in GitHub Actions in the same way.

### 4. Confirm the project ref matches the repo

Check that `SUPABASE_PROJECT_ID` matches the linked project ref currently recorded in [supabase/.temp/project-ref](../supabase/.temp/project-ref).

### 5. Check the workflow file

The current workflow should be equivalent to:

```yaml
name: Deploy Supabase migrations

on:
  push:
    branches:
      - main
    paths:
      - supabase/migrations/**
      - .github/workflows/supabase.yml
  workflow_dispatch:

jobs:
  deploy:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ vars.SUPABASE_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.121.0
      - run: supabase init --yes
      - run: supabase link --project-ref "$SUPABASE_PROJECT_ID" --password "$SUPABASE_DB_PASSWORD"
      - run: supabase db push --linked --password "$SUPABASE_DB_PASSWORD" --dry-run
      - run: supabase db push --linked --password "$SUPABASE_DB_PASSWORD" --yes
```

## Common failure signatures and meaning

### Missing secret or variable

Symptoms:

- `Missing GitHub Actions configuration: ...`
- workflow exits before `supabase link`

Meaning:

- one of the GitHub repo configuration values is absent or has a different name than expected.

### `supabase link` fails

Possible causes:

- wrong `SUPABASE_PROJECT_ID`
- invalid `SUPABASE_DB_PASSWORD`
- CLI not authenticated or no access to the project

### `supabase db push` fails

Possible causes:

- migration drift
- SQL syntax issue in a migration
- remote DB already contains conflicting schema
- password/project mismatch

## Useful follow-up commands

```bash
gh api repos/{owner}/{repo}/actions/secrets
gh api repos/{owner}/{repo}/actions/variables
```

Replace `{owner}` and `{repo}` with the actual project values if you need raw API output.

## Final debugging rule

If local `supabase db push --dry-run --linked` passes, the most likely remaining issue is in the GitHub Actions environment, not the repo’s SQL or migration files.

If the local dry-run fails, fix the local issue first and then re-run the same command in CI.
