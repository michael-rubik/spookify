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
