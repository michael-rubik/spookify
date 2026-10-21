# Database

Canonical schema lives in `supabase/schema.sql` and migrations in `supabase/migrations/`.

When changing schema, create a migration and keep `schema.sql` in sync.

Refer to `README.md` for detailed migration safety and reset workflows.

## Permanent account deletion

Migrations apply in filename order; `20261025_permanent_account_deletion.sql` follows
the karaoke scheduling fix, whose scheduler it replaces so FK-cascade deletes close
queue gaps. Its definitions are also in `schema.sql`.

Lifecycle: an admin calls the `delete-account` Edge Function, which calls the
service-role-only `begin_account_deletion` RPC to set `users.deletion_pending_at`.
Database guards then reject all writes and uploads from that account, including with
already-issued access tokens (deleting an Auth user does not invalidate JWTs). The
function bans sign-in, removes owned Storage files in batches through the Storage API
(never by deleting `storage.objects` rows), deletes the Auth user, and confirms that
both the profile and Auth user are gone. FK cascades remove spooks, tags, and karaoke
songs. Cleanup is bounded per invocation; failures leave the account pending and the
admin UI offers retry. Missing files and an already-deleted Auth user are tolerated.

Limits: only files with `owner_id` (or legacy `owner`) of the user are discovered;
ownerless historical objects are not inferred from URLs, and Auth deletion fails
explicitly if other owned objects remain. Write admission uses one advisory lock
`(20261025, 1)`, which serializes guarded writes. Concurrent retries may race and one
fails explicitly. Development login accounts are synthetic and cannot be deleted.

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