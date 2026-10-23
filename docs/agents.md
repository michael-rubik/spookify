# Agents & Repo Notes

This is the canonical `AGENTS.md` content moved into `docs/` as part of the single source-of-truth consolidation.

## AGENTS.md content

React 19 + Vite + TypeScript + Supabase app for a Halloween party: clicker game, spook photo feed, karaoke queue, users, admin.

### Verify

Before calling work done: `npm run build`, `npm test`, `npm run lint` (scripts live in `package.json`). Never start a dev server in a background terminal — the user runs it.

The Playwright e2e suite (`e2e/`) can't run on this machine (it needs podman), so CI is the only check. When a change touches a view or its text/test ids, update the specs, and after pushing check the run with `gh run list --workflow e2e.yml --limit 1` and `gh run view <id> --log-failed`. Queries that feed per-user UI (badges, XP, wins) must filter by the signed-in user, because most read policies expose every user's rows.

### Conventions

- **Supabase**: the SQL files in `supabase/` are the source of truth — follow the database workflow in [README.md](../README.md). Migrations are named `YYYYMMDD_snake_case.sql`.
- **Styling**: mobile-first, one breakpoint at 768px. Card theme follows `prefers-color-scheme` via CSS vars.

### Spook tagging

1 creator × 1 spook × n tagged users via the `spook_tagged_users` join table. A spook with zero tags renders a "👻 spooky ghost" chip — a frontend-only easter egg.

### Lint gotcha

`react-hooks/set-state-in-effect` rejects mount effects that call component-scope async loaders. Define the loader inside the `useEffect` body and expose it to event handlers via a `useRef`.

Note: Keep `docs/` as the single markdown source of truth for contributor-facing instructions. If you have docs elsewhere (e.g., your home `.github`), import them here and remove duplicates.
