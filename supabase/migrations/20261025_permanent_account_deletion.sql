alter table public.users add column if not exists deletion_pending_at timestamptz;

create schema if not exists private;
revoke all on schema private from public;

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
-- Statement triggers run before row locks and before karaoke's own scheduling lock.
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

drop policy if exists "Enable update for authenticated users based on id or admin role" on public.users;
create policy "Enable update for authenticated users based on id or admin role"
on public.users for update to authenticated
using (auth.uid() = id or public.account_is_active_admin())
with check (auth.uid() = id or public.account_is_active_admin());
drop policy if exists "Enable delete for admin users" on public.users;
revoke delete on public.users from authenticated;

-- Restrictive policies also protect deployments with additional permissive policies.
do $$
declare relation text;
begin
  foreach relation in array array['users', 'spooks', 'spook_tagged_users', 'karaoke_queue'] loop
    execute format('drop policy if exists active_account_insert on public.%I', relation);
    execute format('create policy active_account_insert on public.%I as restrictive for insert to authenticated with check (public.account_is_active())', relation);
    execute format('drop policy if exists active_account_update on public.%I', relation);
    execute format('create policy active_account_update on public.%I as restrictive for update to authenticated using (public.account_is_active()) with check (public.account_is_active())', relation);
    execute format('drop policy if exists active_account_delete on public.%I', relation);
    execute format('create policy active_account_delete on public.%I as restrictive for delete to authenticated using (public.account_is_active())', relation);
  end loop;
end;
$$;

drop policy if exists active_account_insert on storage.objects;
create policy active_account_insert on storage.objects as restrictive for insert to authenticated
with check (public.account_is_active() and coalesce(nullif(owner_id, ''), owner::text) = auth.uid()::text);
drop policy if exists active_account_update on storage.objects;
create policy active_account_update on storage.objects as restrictive for update to authenticated
using (public.account_is_active() and coalesce(nullif(owner_id, ''), owner::text) = auth.uid()::text)
with check (public.account_is_active() and coalesce(nullif(owner_id, ''), owner::text) = auth.uid()::text);
drop policy if exists active_account_delete on storage.objects;
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

-- Nested DELETEs include FK cascades. Only scheduler-generated nested UPDATEs
-- must be suppressed; skipping every nested trigger leaves cascade queue gaps.
create or replace function private.schedule_karaoke_queue()
returns trigger language plpgsql security definer set search_path = ''
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
  if pg_trigger_depth() > 1 and tg_op = 'UPDATE' then return null; end if;
  if tg_when = 'BEFORE' then
    perform pg_advisory_xact_lock(20261024, 1);
    return null;
  end if;
  schedule_now := clock_timestamp();
  cursor_at := schedule_now;
  for song in
    select * from public.karaoke_queue where status in ('queued', 'playing')
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
    next_status := case when end_at <= schedule_now then 'completed'
      when start_at <= schedule_now then 'playing' else 'queued' end;
    cursor_at := greatest(schedule_now, end_at);
    update public.karaoke_queue
    set status = next_status, started_at = start_at, ends_at = end_at
    where id = song.id and (status, started_at, ends_at) is distinct from (next_status, start_at, end_at);
  end loop;
  return null;
end;
$$;
revoke all on function private.schedule_karaoke_queue() from public, anon, authenticated;