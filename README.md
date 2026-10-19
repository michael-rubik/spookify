# Spookify

A React + Supabase app for a clicker-style game and admin/user management.

## Local development

```bash
npm install
npm run dev
```

## Supabase database workflow

This project treats the SQL files in the Supabase folder as the source of truth for the schema.

Important rules:

- Do not manually delete tables in the Supabase dashboard if the repo should stay in sync.
- Create a migration for any schema change instead of editing the live database blindly.
- Keep [supabase/schema.sql](supabase/schema.sql) and the migration files aligned with the actual remote schema.
- If the dashboard was changed manually, treat that as drift and fix it intentionally with a migration or a structured reset.

## Automated Supabase deployment

[The migration workflow](.github/workflows/supabase.yml) deploys pending migrations
when a push to `main` changes `supabase/migrations/**` or the workflow itself.
It can also be run from GitHub's Actions tab using **Run workflow** on `main`.
Runs from other branches cannot deploy. Pull requests do not receive deployment
credentials or modify the remote database.

### One-time authentication setup

In this repository's **Settings > Secrets and variables > Actions**, configure:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase personal access token |
| Secret | `SUPABASE_DB_PASSWORD` | The target project's database password |
| Variable | `SUPABASE_PROJECT_ID` | The target project's reference ID |

Create the access token in your Supabase account settings. Restrict it to the
target project where scoped tokens are available, with the permissions needed
by `supabase link`. Supabase's [CI guide](https://supabase.com/docs/guides/deployment/managing-environments)
lists Project Settings, API Keys, and API Key Secrets with Read access.
The project reference is the ID in `https://supabase.com/dashboard/project/<id>`.
The database password is not your Supabase account password or an API key.
Never commit either secret or paste it into workflow files or logs.

The runner authenticates through environment variables, so there is no browser
login and no `supabase login` step. It installs pinned CLI version `2.121.0`,
initializes temporary CLI configuration, links the project, previews pending
migrations, and applies them without interactive prompts. No local login session
or `.temp` project link is reused. Deployment runs are serialized, and a running
migration is not cancelled when another push arrives. Avoid running manual
remote migrations at the same time as the workflow.

### Migration safety

Before enabling the workflow, verify that remote migration history matches the
checked-in migrations with `npx supabase migration list` against your linked
project. Resolve any drift manually before the first automated deployment.
Adding the workflow can trigger a deployment of all pending migrations, including
older ones, so review that list first and back up data before destructive changes.

`supabase db push` applies migrations missing from remote history; an up-to-date
database is a no-op. Add a new migration for every database change. Editing an
already-applied migration does not replay it. The workflow does not execute
`supabase/schema.sql` or standalone SQL scripts, automatically repair migration
history, reset the database, or seed it. A change to `schema.sql` alone does not
trigger deployment; keep it aligned with migrations manually.

Locally, `npm run supabase:check` previews pending migrations with `--dry-run`
without applying them. It requires a linked project and database authentication;
it does not execute SQL to validate whether migrations will succeed. A failed
deployment is not automatically rolled back. Inspect the failure and database
state, then fix it with a reviewed migration or deliberate history repair before
retrying through the Actions tab.

## Safe reset workflow

Use this workflow whenever you want to reset the user table or recover from a mismatched database state.

### 1. Back up before resetting

Before changing anything in Supabase, export the data you care about or note which rows must be recreated.

```sql
SELECT * FROM public.users;
```

If you need to keep data, copy it to a temporary SQL file or export it from the dashboard before running destructive changes.

### 2. Do not delete the table manually from the dashboard

Manual table deletes are the most common source of drift. They change the remote state without updating migration history.

Instead, prefer one of these:

- recreate the table with a migration file
- or recreate it with a SQL script in the Supabase SQL editor and then add a migration for the same schema

### 3. If a migration is missing from local history

If the remote database still knows about a migration that no longer exists locally, repair that history before pushing again:

```bash
npx supabase migration repair --status reverted 20261018
```

Replace `20261018` with the migration id that is out of sync.

Then run:

```bash
npx supabase db push
```

### 4. Recreate the users table with a migration

If you intentionally want to reset the users table, create a new migration file, for example:

```bash
supabase/migrations/20261019_reset_users_table.sql
```

Then add the schema you want, for example:

```sql
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  costume text not null,
  email text not null unique,
  is_admin boolean not null default false,
  click_count integer not null default 0,
  signup_email_status text not null default 'not_sent' check (signup_email_status in ('not_sent', 'pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, costume, email, is_admin, click_count, signup_email_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'costume', ''),
    new.email,
    false,
    0,
    'not_sent'
  )
  on conflict (id) do update
    set name = excluded.name,
        costume = excluded.costume,
        email = excluded.email,
        is_admin = coalesce(public.users.is_admin, false),
        click_count = coalesce(public.users.click_count, 0),
        signup_email_status = coalesce(public.users.signup_email_status, 'not_sent');

  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "Enable insert for authenticated users only"
on public.users
for insert
to authenticated, dashboard_user
with check (
  auth.uid() = id
  and auth.email() = email
);

create policy "Enable read access for all users"
on public.users
for select
to public
using (true);

create policy "Enable update for authenticated users based on id or admin role"
on public.users
for update
to authenticated
using (
  auth.uid() = id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
)
with check (
  auth.uid() = id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

create policy "Enable delete for admin users"
on public.users
for delete
to authenticated
using (
  exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);
```

Then push it:

```bash
npx supabase db push
```

### 5. Safe day-to-day workflow

Use this pattern for all database work:

1. Edit schema locally in a migration file.
2. Validate with `npx supabase db push`.
3. Keep [supabase/schema.sql](supabase/schema.sql) updated only after the migration is confirmed.
4. Never use the dashboard to delete tables unless you are intentionally resetting the remote database and are prepared to recreate migration history.
5. If you must fix remote drift, do it through a migration, not by manual UI deletion.

## Useful commands

```bash
npm run dev
npm run build
npx supabase db push
npx supabase migration repair --status reverted <migration-id>
```

## Notes

This repo uses Supabase for auth and user metadata, so the users table and policies are core app state. Keeping the SQL and migration history aligned prevents false “already up to date” messages and avoids hidden schema drift.
