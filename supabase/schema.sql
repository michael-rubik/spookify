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

-- Normalize any accidental quoted uppercase table to the canonical lowercase table.
do $$
declare
  has_lowercase_users boolean := false;
  has_uppercase_users boolean := false;
  uppercase_has_matching_id boolean := false;
  uppercase_has_is_admin boolean := false;
  uppercase_has_click_count boolean := false;
  uppercase_has_signup_email_status boolean := false;
  uppercase_has_created_at boolean := false;
begin
  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'users'
  ) into has_lowercase_users;

  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'USERS'
  ) into has_uppercase_users;

  if has_uppercase_users then
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'id'
        and data_type = 'uuid'
    ) into uppercase_has_matching_id;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'is_admin'
        and data_type = 'boolean'
    ) into uppercase_has_is_admin;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'click_count'
        and data_type = 'integer'
    ) into uppercase_has_click_count;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'signup_email_status'
    ) into uppercase_has_signup_email_status;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'created_at'
    ) into uppercase_has_created_at;
  end if;

  if has_uppercase_users and not has_lowercase_users then
    execute 'alter table public."USERS" rename to users';
  elsif has_uppercase_users and has_lowercase_users then
    if uppercase_has_matching_id and uppercase_has_is_admin and uppercase_has_click_count and uppercase_has_signup_email_status and uppercase_has_created_at then
      execute $sql$
        insert into public.users (id, name, costume, email, is_admin, click_count, signup_email_status, created_at)
        select id, name, costume, email, is_admin, click_count, signup_email_status, created_at
        from public."USERS"
        on conflict (id) do update
          set name = excluded.name,
              costume = excluded.costume,
              email = excluded.email,
              is_admin = excluded.is_admin,
              click_count = excluded.click_count,
              signup_email_status = excluded.signup_email_status,
              created_at = excluded.created_at;
      $sql$;

      execute 'drop table public."USERS"';
    else
      raise notice 'Skipped merge for public."USERS" because it is not schema-compatible with public.users';
    end if;
  end if;
end $$;
