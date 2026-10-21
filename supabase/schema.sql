create table if not exists public.signup_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (btrim(code) <> ''),
  seats integer not null check (seats > 0),
  seats_used integer not null default 0 check (seats_used >= 0),
  created_at timestamptz not null default now(),
  constraint signup_codes_seats_not_exceeded check (seats_used <= seats)
);
create unique index if not exists signup_codes_code_key on public.signup_codes (lower(code));

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  costume text not null,
  email text not null unique,
  avatar_url text,
  badges text[] not null default '{}',
  is_admin boolean not null default false,
  click_count integer not null default 0,
  signup_code_id uuid references public.signup_codes(id) on delete set null,
  deletion_pending_at timestamptz,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Public avatars are viewable by everyone"
on storage.objects
for select
to public
using (bucket_id = 'avatars');

create policy "Authenticated users may upload avatars"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
);

create policy "Authenticated users may update their own avatars"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and owner = auth.uid()
)
with check (
  bucket_id = 'avatars'
  and owner = auth.uid()
);

create policy "Authenticated users may delete avatars"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and owner = auth.uid()
);

alter table public.users enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_code_id uuid;
begin
  update public.signup_codes
    set seats_used = seats_used + 1
    where lower(code) = lower(btrim(coalesce(new.raw_user_meta_data ->> 'signup_code', '')))
      and seats_used < seats
    returning id into claimed_code_id;

  if claimed_code_id is null then
    raise exception 'Invalid or exhausted signup code';
  end if;

  insert into public.users (id, name, costume, email, avatar_url, badges, is_admin, click_count, signup_code_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'costume', ''),
    new.email,
    null,
    '{}'::text[],
    false,
    0,
    claimed_code_id
  )
  on conflict (id) do update
    set name = excluded.name,
        costume = excluded.costume,
        email = excluded.email,
        avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url),
        badges = coalesce(excluded.badges, public.users.badges, '{}'::text[]),
        is_admin = coalesce(public.users.is_admin, false),
        click_count = coalesce(public.users.click_count, 0),
        signup_code_id = coalesce(public.users.signup_code_id, excluded.signup_code_id);

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

create table if not exists public.karaoke_queue (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null default 'Unknown artist',
  queued_by uuid not null references public.users(id) on delete cascade,
  duration_seconds integer not null default 300,
  status text not null default 'queued' check (status in ('queued', 'playing', 'completed', 'skipped')),
  started_at timestamptz,
  ends_at timestamptz,
  skipped_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.karaoke_queue enable row level security;

create policy "Public karaoke queue is readable"
on public.karaoke_queue
for select
to public
using (true);

create policy "Authenticated users can add songs to the karaoke queue"
on public.karaoke_queue
for insert
to authenticated
with check (
  auth.uid() = queued_by
  and char_length(title) > 0
  and duration_seconds > 0
);

create policy "Users can update their own queued songs or admins can manage the queue"
on public.karaoke_queue
for update
to authenticated
using (
  auth.uid() = queued_by
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
)
with check (
  auth.uid() = queued_by
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

create policy "Owners and admins can delete songs from the karaoke queue"
on public.karaoke_queue for delete to authenticated
using (
  (select auth.uid()) = queued_by
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = (select auth.uid()) and admin_user.is_admin = true
  )
);

create or replace function public.touch_karaoke_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger karaoke_queue_updated_at
before update on public.karaoke_queue
for each row
execute function public.touch_karaoke_queue_updated_at();

create schema if not exists private;
revoke all on schema private from public;

-- Definer privileges are needed only inside this trigger to move other owners' songs.
create or replace function private.schedule_karaoke_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  song record;
  schedule_now timestamptz;
  cursor_at timestamptz;
  start_at timestamptz;
  end_at timestamptz;
  next_status text;
begin
  if current_setting('role', true) in ('anon', 'authenticated') and auth.uid() is null then
    raise exception 'Authentication required for queue changes' using errcode = '42501';
  end if;

  -- Nested DELETEs include FK cascades; only scheduler-generated UPDATEs are skipped.
  if pg_trigger_depth() > 1 and tg_op = 'UPDATE' then
    return null;
  end if;

  if tg_when = 'BEFORE' then
    -- Lock before any row locks, including when the queue is empty.
    perform pg_advisory_xact_lock(20261024, 1);
    return null;
  end if;

  schedule_now := clock_timestamp();
  cursor_at := schedule_now;
  for song in
    select * from public.karaoke_queue
    where status in ('queued', 'playing')
    order by created_at, id
  loop
    if song.ends_at is not null and song.ends_at <= schedule_now then
      update public.karaoke_queue set status = 'completed' where id = song.id;
      continue;
    end if;

    if cursor_at = schedule_now and song.started_at <= schedule_now then
      start_at := song.started_at;
    else
      start_at := cursor_at;
    end if;
    end_at := start_at + make_interval(secs => greatest(1, song.duration_seconds));
    next_status := case
      when end_at <= schedule_now then 'completed'
      when start_at <= schedule_now then 'playing'
      else 'queued'
    end;
    cursor_at := greatest(schedule_now, end_at);

    update public.karaoke_queue
    set status = next_status, started_at = start_at, ends_at = end_at
    where id = song.id
      and (status, started_at, ends_at) is distinct from (next_status, start_at, end_at);
  end loop;
  return null;
end;
$$;

revoke all on function private.schedule_karaoke_queue() from public, anon, authenticated;

create trigger karaoke_queue_lock
before insert or update or delete on public.karaoke_queue
for each statement execute function private.schedule_karaoke_queue();

create trigger karaoke_queue_schedule
after insert or update or delete on public.karaoke_queue
for each statement execute function private.schedule_karaoke_queue();

create table if not exists public.spooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  caption text not null default '',
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table public.spooks enable row level security;

create table if not exists public.spook_tagged_users (
  spook_id uuid not null references public.spooks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (spook_id, user_id)
);

alter table public.spook_tagged_users enable row level security;

create index if not exists spook_tagged_users_user_id_idx
  on public.spook_tagged_users (user_id);

insert into storage.buckets (id, name, public)
values ('spooks', 'spooks', true)
on conflict (id) do nothing;

create policy "Public spook images are viewable by everyone"
on storage.objects
for select
to public
using (bucket_id = 'spooks');

create policy "Authenticated users may upload spook images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'spooks'
  and auth.uid() is not null
);

create policy "Authenticated users may update their own spook images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'spooks'
  and owner = auth.uid()
)
with check (
  bucket_id = 'spooks'
  and owner = auth.uid()
);

create policy "Authenticated users may delete their own spook images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'spooks'
  and owner = auth.uid()
);

create policy "Public spooks are readable"
on public.spooks
for select
to public
using (true);

create policy "Users can insert their own spooks"
on public.spooks
for insert
to authenticated
with check (
  auth.uid() = user_id
  and char_length(caption) > 0
  and image_url is not null
);

create policy "Users can update their own spooks"
on public.spooks
for update
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

create policy "Users can delete their own spooks"
on public.spooks
for delete
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

create policy "Public spook tags are readable"
on public.spook_tagged_users
for select
to public
using (true);

create policy "Spook creators can tag users on their own spooks"
on public.spook_tagged_users
for insert
to authenticated
with check (
  exists (
    select 1 from public.spooks as s
    where s.id = spook_tagged_users.spook_id
      and s.user_id = auth.uid()
  )
);

create policy "Spook creators and admins can remove tags"
on public.spook_tagged_users
for delete
to authenticated
using (
  exists (
    select 1 from public.spooks as s
    where s.id = spook_tagged_users.spook_id
      and (
        s.user_id = auth.uid()
        or exists (
          select 1 from public.users as admin_user
          where admin_user.id = auth.uid()
            and admin_user.is_admin = true
        )
      )
  )
);

create or replace function private.current_account_active(require_admin boolean default false)
returns boolean language sql volatile security definer set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and deletion_pending_at is null
      and (not require_admin or is_admin)
  );
$$;
revoke all on function private.current_account_active(boolean) from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.current_account_active(boolean) to authenticated;

create or replace function public.account_is_active()
returns boolean language sql volatile security invoker set search_path = ''
as $$ select private.current_account_active(false) $$;
create or replace function public.account_is_active_admin()
returns boolean language sql volatile security invoker set search_path = ''
as $$ select private.current_account_active(true) $$;
revoke all on function public.account_is_active(), public.account_is_active_admin() from public;
grant execute on function public.account_is_active(), public.account_is_active_admin() to authenticated;

-- Serialize write admission with the pending transition. A stale JWT is not authorization.
create or replace function private.guard_account_writes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(20261025, 1);
  if current_setting('role', true) in ('authenticated', 'anon')
    and not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if tg_table_schema = 'public' and tg_table_name = 'users' and tg_op = 'DELETE'
    and current_setting('role', true) in ('authenticated', 'anon') then
    raise exception 'Use the account deletion endpoint' using errcode = '42501';
  end if;
  return null;
end;
$$;
revoke all on function private.guard_account_writes() from public, anon, authenticated;
create or replace trigger account_write_guard before insert or update or delete on public.users
for each statement execute function private.guard_account_writes();
create or replace trigger account_write_guard before insert or update or delete on public.spooks
for each statement execute function private.guard_account_writes();
create or replace trigger account_write_guard before insert or update or delete on public.spook_tagged_users
for each statement execute function private.guard_account_writes();
create or replace trigger account_write_guard before insert or update or delete on public.karaoke_queue
for each statement execute function private.guard_account_writes();
create or replace trigger account_write_guard before insert or update or delete on storage.objects
for each statement execute function private.guard_account_writes();

create or replace function private.guard_profile_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('role', true) not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' then
    if old.deletion_pending_at is not null
      or new.deletion_pending_at is distinct from old.deletion_pending_at then
      raise exception 'Deletion pending cannot be edited or reversed' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'Account identity cannot be changed' using errcode = '42501';
    end if;
    if new.is_admin is distinct from old.is_admin
      and not private.current_account_active(true)
      and not (new.id = auth.uid() and new.is_admin
        and not exists (select 1 from public.users where is_admin)) then
      raise exception 'Only admins can change admin permissions' using errcode = '42501';
    end if;
  elsif new.deletion_pending_at is not null or new.is_admin then
    raise exception 'New accounts must be active non-admins' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_changes() from public, anon, authenticated;
create or replace trigger guard_profile_changes before insert or update on public.users
for each row execute function private.guard_profile_changes();

drop policy "Enable update for authenticated users based on id or admin role" on public.users;
create policy "Enable update for authenticated users based on id or admin role"
on public.users for update to authenticated
using (auth.uid() = id or public.account_is_active_admin())
with check (auth.uid() = id or public.account_is_active_admin());
drop policy "Enable delete for admin users" on public.users;
revoke delete on public.users from authenticated;

do $$
declare relation text;
begin
  foreach relation in array array['users', 'spooks', 'spook_tagged_users', 'karaoke_queue'] loop
    execute format('create policy active_account_insert on public.%I as restrictive for insert to authenticated with check (public.account_is_active())', relation);
    execute format('create policy active_account_update on public.%I as restrictive for update to authenticated using (public.account_is_active()) with check (public.account_is_active())', relation);
    execute format('create policy active_account_delete on public.%I as restrictive for delete to authenticated using (public.account_is_active())', relation);
  end loop;
end;
$$;

create policy active_account_insert on storage.objects as restrictive for insert to authenticated
with check (public.account_is_active() and coalesce(nullif(owner_id, ''), owner::text) = auth.uid()::text);
create policy active_account_update on storage.objects as restrictive for update to authenticated
using (public.account_is_active() and coalesce(nullif(owner_id, ''), owner::text) = auth.uid()::text)
with check (public.account_is_active() and coalesce(nullif(owner_id, ''), owner::text) = auth.uid()::text);
create policy active_account_delete on storage.objects as restrictive for delete to authenticated
using (public.account_is_active() and coalesce(nullif(owner_id, ''), owner::text) = auth.uid()::text);

create or replace function private.begin_account_deletion(actor_id uuid, target_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(20261025, 1);
  if not exists (select 1 from public.users where id = actor_id and is_admin and deletion_pending_at is null) then
    raise exception 'Active admin required' using errcode = '42501';
  end if;
  if actor_id = target_id then
    raise exception 'Cannot delete yourself' using errcode = '42501';
  end if;
  update public.users set deletion_pending_at = coalesce(deletion_pending_at, clock_timestamp())
  where id = target_id;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
end;
$$;
create or replace function public.begin_account_deletion(actor_id uuid, target_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.begin_account_deletion(actor_id, target_id) $$;
revoke all on function private.begin_account_deletion(uuid, uuid), public.begin_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function private.begin_account_deletion(uuid, uuid), public.begin_account_deletion(uuid, uuid) to service_role;

create or replace function private.account_deletion_files(target_id uuid, batch_size integer)
returns table(bucket_id text, name text)
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.users where id = target_id and deletion_pending_at is not null) then
    raise exception 'Pending user not found' using errcode = 'P0002';
  end if;
  return query select o.bucket_id, o.name from storage.objects o
    where o.bucket_id in ('avatars', 'spooks')
      and coalesce(nullif(o.owner_id, ''), o.owner::text) = target_id::text
    order by o.bucket_id, o.name
    limit greatest(1, least(batch_size, 100));
end;
$$;
create or replace function public.account_deletion_files(target_id uuid, batch_size integer default 100)
returns table(bucket_id text, name text)
language sql security invoker set search_path = ''
as $$ select * from private.account_deletion_files(target_id, batch_size) $$;
revoke all on function private.account_deletion_files(uuid, integer), public.account_deletion_files(uuid, integer) from public, anon, authenticated;
grant execute on function private.account_deletion_files(uuid, integer), public.account_deletion_files(uuid, integer) to service_role;

create or replace function private.guard_signup_codes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.code := btrim(new.code);
  if current_setting('role', true) in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.seats_used := 0;
    elsif new.id is distinct from old.id
      or new.code is distinct from old.code
      or new.seats_used is distinct from old.seats_used then
      raise exception 'Only the seat count of a signup code can be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_signup_codes() from public, anon, authenticated;
create or replace trigger guard_signup_codes before insert or update on public.signup_codes
for each row execute function private.guard_signup_codes();

alter table public.signup_codes enable row level security;

drop policy if exists "Active admins can read signup codes" on public.signup_codes;
create policy "Active admins can read signup codes"
on public.signup_codes for select to authenticated
using (public.account_is_active_admin());

drop policy if exists "Active admins can add signup codes" on public.signup_codes;
create policy "Active admins can add signup codes"
on public.signup_codes for insert to authenticated
with check (public.account_is_active_admin());

drop policy if exists "Active admins can change signup code seats" on public.signup_codes;
create policy "Active admins can change signup code seats"
on public.signup_codes for update to authenticated
using (public.account_is_active_admin())
with check (public.account_is_active_admin());

drop policy if exists "Active admins can remove signup codes" on public.signup_codes;
create policy "Active admins can remove signup codes"
on public.signup_codes for delete to authenticated
using (public.account_is_active_admin());
