# Deployment

Build the app and serve the static `dist/` output from your hosting provider. Use `npm run build` to produce `dist/`.

Routes such as `/spooks` or `/spookify/tinder` are real paths (History API), so the host must answer every
unknown path with `index.html` (a single-page-app fallback); otherwise a pasted or reloaded link shows the host's
"page not found". `public/_redirects` covers Netlify and Cloudflare Pages, and `vercel.json` covers Vercel. On any
other host, add the equivalent rewrite (for nginx: `try_files $uri /index.html;`).

Follow the repository's GitHub Actions workflows in `.github/workflows/` for automated migrations.

The `supabase` workflow applies migrations, then deploys the `delete-account` and
`spookify-search` Edge Functions (`supabase/functions/`, config in
`supabase/config.toml`, SDK pinned in `supabase/functions/deno.json`). It also runs
when function or config files change.
Deploy the migration before the function. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are supplied to the function by Supabase; never put the
service key in Vite/frontend environment variables or commit `.env` files.

`spookify-search` additionally needs the `SPOTIFY_CLIENT_ID` and
`SPOTIFY_CLIENT_SECRET` function secrets (`supabase secrets set ...`) from a Spotify
app. They authorize catalogue search only and must never reach the browser.

Ensure Actions secrets are configured before enabling automated deployment.
