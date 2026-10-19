# Spookify

React 19 + Vite + TypeScript + Supabase app for a Halloween party: clicker game, spook photo feed, karaoke queue, users, admin.

## Verify

Before calling work done: `npm run build`, `npm test`, `npm run lint` (scripts live in `package.json`). Never start a dev server in a background terminal — the user runs it.

## Conventions

- **Supabase**: the SQL files in `supabase/` are the source of truth — follow the database workflow in [README.md](README.md). Migrations are named `YYYYMMDD_snake_case.sql`; repo dates deliberately run ahead of the real date. Sync `supabase/schema.sql` manually with each migration.
- **Styling**: mobile-first, one breakpoint at 768px (`@media (min-width: 768px)` = desktop). Classes + global CSS in `src/index.css` plus per-component css files — no inline styles. Card theme follows `prefers-color-scheme` via CSS vars (`--surface`, `--surface-text`).

## Spook tagging

1 creator × 1 spook × n tagged users via the `spook_tagged_users` join table. A spook with zero tags renders a "👻 spooky ghost" chip — a frontend-only easter egg; the ghost has no DB row. `normalizeSpookRow()` (`src/utils/spooks.ts`) flattens join rows into `tagged_user_ids`.

## Lint gotcha

`react-hooks/set-state-in-effect` rejects mount effects that call component-scope async loaders. Define the loader inside the `useEffect` body and expose it to event handlers via a `useRef` (see `karaoke.tsx`, `spooks.tsx`). Syncing props into state: render-time adjustment with a prev-state value (see `clicker.tsx`).
