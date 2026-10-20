# Database

Canonical schema lives in `supabase/schema.sql` and migrations in `supabase/migrations/`.

When changing schema, create a migration and keep `schema.sql` in sync.

Refer to `README.md` for detailed migration safety and reset workflows.

## Karaoke queue

Apply `20261024_fix_karaoke_scheduling.sql` before deploying the updated karaoke UI.
Scheduling runs atomically in database triggers, serialized with a transaction-level
advisory lock. An idle queue starts a new song immediately; additions otherwise
follow the last live song. Archived songs never reserve a queue slot. Removing or
skipping a song closes its slot while preserving the current performance's start.
Owners and admins can remove songs; skipping and changing duration remain admin UI
controls. The private scheduling trigger can adjust other owners' timestamps, but
cannot be called directly through the API. Reading the queue does not write to it.

Development login mirrors these scheduling rules in local storage. The UI advances
the displayed status and countdown every second; refresh fetches other users' changes.
Database regression tests use an isolated in-memory Postgres instance (PGlite), not
the linked Supabase project.