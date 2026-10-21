# Deployment

Build the app and serve the static `dist/` output from your hosting provider. Use `npm run build` to produce `dist/`.

Follow the repository's GitHub Actions workflows in `.github/workflows/` for automated migrations.

The `supabase` workflow applies migrations, then deploys the `delete-account` Edge
Function (`supabase/functions/`, config in `supabase/config.toml`, SDK pinned in
`supabase/functions/deno.json`). It also runs when function or config files change.
Deploy the migration before the function. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are supplied to the function by Supabase; never put the
service key in Vite/frontend environment variables or commit `.env` files.

Ensure Actions secrets are configured before enabling automated deployment.
