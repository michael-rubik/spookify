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
  spookify_score numeric(8,1) not null default 0,
  tinder_score numeric(8,1) not null default 0,
  fmk_score numeric(8,1) not null default 0,
  submitter_score numeric(8,1) not null default 0,
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
    -- Spookify rewards are server-authoritative: only private.award_spookify raises this flag.
    if (new.spookify_score, new.tinder_score, new.fmk_score, new.submitter_score)
      is distinct from (old.spookify_score, old.tinder_score, old.fmk_score, old.submitter_score)
      and coalesce(current_setting('spookify.award', true), '') <> 'on' then
      raise exception 'Spookify score is awarded by the server' using errcode = '42501';
    end if;
  elsif new.deletion_pending_at is not null or new.is_admin
    or new.spookify_score <> 0 or new.tinder_score <> 0 or new.fmk_score <> 0 or new.submitter_score <> 0 then
    raise exception 'New accounts must be active non-admins' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_changes() from public, anon, authenticated;

create or replace function private.award_spookify(
  p_user uuid,
  p_tinder numeric,
  p_fmk numeric,
  p_submitter numeric
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('spookify.award', 'on', true);
  update public.users
    set tinder_score = tinder_score + p_tinder,
        fmk_score = fmk_score + p_fmk,
        submitter_score = submitter_score + p_submitter,
        spookify_score = spookify_score + p_tinder + p_fmk + p_submitter,
        badges = case
          when spookify_score + p_tinder + p_fmk + p_submitter >= 100 and not ('songmaster' = any(badges))
            then array_append(badges, 'songmaster')
          else badges
        end
    where id = p_user;
  perform set_config('spookify.award', 'off', true);
end;
$$;
revoke all on function private.award_spookify(uuid, numeric, numeric, numeric) from public, anon, authenticated;

create or replace function private.award_song(p_song uuid, p_points numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.spookify_songs set points = points + p_points where id = p_song;
end;
$$;
revoke all on function private.award_song(uuid, numeric) from public, anon, authenticated;
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

-- Votes: an admin opens a named vote, every active user casts one anonymous ballot, an admin ends it.
-- Ballots are anonymous by construction: participation (who voted) and tallies (what was chosen) are unlinked.
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  category text not null check (btrim(category) <> '' and char_length(category) <= 60),
  status text not null default 'open' check (status in ('open', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists votes_single_open_idx on public.votes ((status)) where status = 'open';

create table if not exists public.vote_participation (
  vote_id uuid not null references public.votes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (vote_id, user_id)
);

create table if not exists public.vote_tallies (
  vote_id uuid not null references public.votes(id) on delete cascade,
  candidate_id uuid not null references public.users(id) on delete cascade,
  ballots integer not null check (ballots > 0),
  primary key (vote_id, candidate_id)
);

create table if not exists public.vote_winners (
  vote_id uuid not null references public.votes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (vote_id, user_id)
);

alter table public.votes enable row level security;
alter table public.vote_participation enable row level security;
alter table public.vote_tallies enable row level security;
alter table public.vote_winners enable row level security;

-- Writes only happen through the security definer functions below.
revoke all on public.votes, public.vote_participation, public.vote_tallies, public.vote_winners from anon, authenticated;
grant select on public.votes, public.vote_participation, public.vote_tallies, public.vote_winners to authenticated;

drop policy if exists "Active users can read votes" on public.votes;
create policy "Active users can read votes"
on public.votes for select to authenticated
using (public.account_is_active());

drop policy if exists "Users can see only their own participation" on public.vote_participation;
create policy "Users can see only their own participation"
on public.vote_participation for select to authenticated
using (public.account_is_active() and user_id = auth.uid());

-- Tallies stay hidden until the vote has ended.
drop policy if exists "Tallies of ended votes are readable" on public.vote_tallies;
create policy "Tallies of ended votes are readable"
on public.vote_tallies for select to authenticated
using (
  public.account_is_active()
  and exists (select 1 from public.votes v where v.id = vote_tallies.vote_id and v.status = 'ended')
);

drop policy if exists "Active users can read winners" on public.vote_winners;
create policy "Active users can read winners"
on public.vote_winners for select to authenticated
using (public.account_is_active());

create or replace function public.start_vote(p_category text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
  cleaned text := btrim(coalesce(p_category, ''));
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can start a vote' using errcode = '42501';
  end if;
  if cleaned = '' or char_length(cleaned) > 60 then
    raise exception 'The category must be 1 to 60 characters' using errcode = '22023';
  end if;
  begin
    insert into public.votes (category) values (cleaned) returning id into new_id;
  exception when unique_violation then
    raise exception 'A vote is already open' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;

create or replace function public.cast_ballot(p_vote_id uuid, p_candidate_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  voter uuid := auth.uid();
begin
  if voter is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  perform 1 from public.votes where id = p_vote_id and status = 'open' for share;
  if not found then
    raise exception 'This vote is not open' using errcode = 'P0001';
  end if;
  if p_candidate_id = voter then
    raise exception 'You cannot vote for yourself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users where id = p_candidate_id and deletion_pending_at is null) then
    raise exception 'Unknown candidate' using errcode = 'P0001';
  end if;
  begin
    insert into public.vote_participation (vote_id, user_id) values (p_vote_id, voter);
  exception when unique_violation then
    raise exception 'You have already voted' using errcode = 'P0001';
  end;
  insert into public.vote_tallies (vote_id, candidate_id, ballots) values (p_vote_id, p_candidate_id, 1)
  on conflict (vote_id, candidate_id) do update set ballots = public.vote_tallies.ballots + 1;
end;
$$;

create or replace function public.vote_progress(p_vote_id uuid)
returns table(voted integer, eligible integer)
language sql security definer set search_path = ''
as $$
  select
    (select count(*)::integer from public.vote_participation where vote_id = p_vote_id),
    (select count(*)::integer from public.users where deletion_pending_at is null)
  where private.current_account_active(false)
$$;

create or replace function public.end_vote(p_vote_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can end a vote' using errcode = '42501';
  end if;
  perform 1 from public.votes where id = p_vote_id and status = 'open' for update;
  if not found then
    raise exception 'This vote is not open' using errcode = 'P0001';
  end if;
  update public.votes set status = 'ended', ended_at = now() where id = p_vote_id;
  insert into public.vote_winners (vote_id, user_id)
  select vote_id, candidate_id from public.vote_tallies
  where vote_id = p_vote_id
    and ballots = (select max(ballots) from public.vote_tallies where vote_id = p_vote_id);
  -- Rewriting every tally in one transaction stops a row's transaction id from pointing at a single voter.
  update public.vote_tallies set ballots = ballots where vote_id = p_vote_id;
end;
$$;

-- Resets an open vote or deletes an ended one; participation, tallies and winners cascade away.
create or replace function public.delete_vote(p_vote_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can delete a vote' using errcode = '42501';
  end if;
  delete from public.votes where id = p_vote_id;
  if not found then
    raise exception 'Vote not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.start_vote(text), public.cast_ballot(uuid, uuid), public.vote_progress(uuid),
  public.end_vote(uuid), public.delete_vote(uuid) from public, anon, authenticated;
grant execute on function public.start_vote(text), public.cast_ballot(uuid, uuid), public.vote_progress(uuid),
  public.end_vote(uuid), public.delete_vote(uuid) to authenticated;

-- Spookify: users add Spotify songs to a shared pool (Source) and swipe through random pool songs (Tinder).
-- Unrelated to votes: a swipe is a named preference, never an anonymous ballot.
-- Rewards move in halves, so the score is numeric and is only ever written by the functions below.
create table if not exists public.spookify_songs (
  id uuid primary key default gen_random_uuid(),
  spotify_track_id text not null unique,
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  artist text not null check (btrim(artist) <> '' and char_length(artist) <= 200),
  album_art_url text,
  spotify_url text,
  points numeric(8,1) not null default 0,
  added_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.spookify_swipes (
  song_id uuid not null references public.spookify_songs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  direction text not null check (direction in ('right', 'left')),
  created_at timestamptz not null default now(),
  primary key (song_id, user_id)
);
create index if not exists spookify_swipes_user_idx on public.spookify_swipes (user_id);

alter table public.spookify_songs enable row level security;
alter table public.spookify_swipes enable row level security;

-- Writes only happen through the security definer functions below, so scores cannot be set by a client.
revoke all on public.spookify_songs, public.spookify_swipes from anon, authenticated;
grant select on public.spookify_songs, public.spookify_swipes to authenticated;

drop policy if exists "Active users can read the song pool" on public.spookify_songs;
create policy "Active users can read the song pool"
on public.spookify_songs for select to authenticated
using (public.account_is_active());

drop policy if exists "Users can see only their own swipes" on public.spookify_swipes;
create policy "Users can see only their own swipes"
on public.spookify_swipes for select to authenticated
using (public.account_is_active() and user_id = auth.uid());

create or replace function public.add_spookify_song(
  p_spotify_track_id text,
  p_title text,
  p_artist text,
  p_album_art_url text default null,
  p_spotify_url text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  submitter uuid := auth.uid();
  cleaned_track text := btrim(coalesce(p_spotify_track_id, ''));
  cleaned_title text := btrim(coalesce(p_title, ''));
  cleaned_artist text := btrim(coalesce(p_artist, ''));
  new_id uuid;
begin
  if submitter is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if cleaned_track = '' or cleaned_title = '' or cleaned_artist = '' then
    raise exception 'A song needs a Spotify track, a title and an artist' using errcode = '22023';
  end if;
  begin
    insert into public.spookify_songs (spotify_track_id, title, artist, album_art_url, spotify_url, added_by)
    values (
      cleaned_track,
      cleaned_title,
      cleaned_artist,
      nullif(btrim(coalesce(p_album_art_url, '')), ''),
      nullif(btrim(coalesce(p_spotify_url, '')), ''),
      submitter
    )
    returning id into new_id;
  exception when unique_violation then
    raise exception 'Song already added' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;

create or replace function public.swipe_spookify_song(p_song_id uuid, p_direction text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  swiper uuid := auth.uid();
  submitter uuid;
begin
  if swiper is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('right', 'left') then
    raise exception 'A swipe goes left or right' using errcode = '22023';
  end if;
  select added_by into submitter from public.spookify_songs where id = p_song_id for share;
  if not found then
    raise exception 'Unknown song' using errcode = 'P0002';
  end if;
  if submitter = swiper then
    raise exception 'You cannot swipe on your own song' using errcode = 'P0001';
  end if;
  begin
    insert into public.spookify_swipes (song_id, user_id, direction) values (p_song_id, swiper, p_direction);
  exception when unique_violation then
    raise exception 'You have already swiped on this song' using errcode = 'P0001';
  end;
  perform private.award_spookify(swiper, case when p_direction = 'right' then 1 else 0.5 end, 0, 0);
  if p_direction = 'right' then
    perform private.award_spookify(submitter, 0, 0, 1);
    perform private.award_song(p_song_id, 1);
  end if;
end;
$$;

-- One random song the caller has not swiped on yet; submitters never meet their own songs.
create or replace function public.next_spookify_song()
returns table(
  id uuid,
  spotify_track_id text,
  title text,
  artist text,
  album_art_url text,
  spotify_url text,
  added_by uuid
)
language sql security definer set search_path = ''
as $$
  select s.id, s.spotify_track_id, s.title, s.artist, s.album_art_url, s.spotify_url, s.added_by
  from public.spookify_songs s
  where private.current_account_active(false)
    and s.added_by <> auth.uid()
    and not exists (
      select 1 from public.spookify_swipes w where w.song_id = s.id and w.user_id = auth.uid()
    )
  order by random()
  limit 1
$$;

revoke all on function public.add_spookify_song(text, text, text, text, text),
  public.swipe_spookify_song(uuid, text), public.next_spookify_song() from public, anon, authenticated;
grant execute on function public.add_spookify_song(text, text, text, text, text),
  public.swipe_spookify_song(uuid, text), public.next_spookify_song() to authenticated;

-- Spookify FMK: three pool songs of the same tier get a different choice each (sing, listen, delete).
-- A song's tier is the points one user has given it; it is per user and never shared. Like swipes, FMK
-- rounds are written only through the functions below, so a client cannot set its own tiers or score.
create table if not exists public.spookify_fmk_tiers (
  user_id uuid not null references public.users(id) on delete cascade,
  song_id uuid not null references public.spookify_songs(id) on delete cascade,
  points integer not null default 0 check (points >= 0),
  deleted boolean not null default false,
  primary key (user_id, song_id)
);

-- Songs that already shared an FMK for a user; song_a < song_b keeps each pair stored once.
create table if not exists public.spookify_fmk_pairs (
  user_id uuid not null references public.users(id) on delete cascade,
  song_a uuid not null references public.spookify_songs(id) on delete cascade,
  song_b uuid not null references public.spookify_songs(id) on delete cascade,
  primary key (user_id, song_a, song_b),
  check (song_a < song_b)
);
create index if not exists spookify_fmk_tiers_song_idx on public.spookify_fmk_tiers (song_id);
create index if not exists spookify_fmk_pairs_song_b_idx on public.spookify_fmk_pairs (song_b);

alter table public.spookify_fmk_tiers enable row level security;
alter table public.spookify_fmk_pairs enable row level security;

revoke all on public.spookify_fmk_tiers, public.spookify_fmk_pairs from anon, authenticated;
grant select on public.spookify_fmk_tiers, public.spookify_fmk_pairs to authenticated;

drop policy if exists "Users can see only their own FMK tiers" on public.spookify_fmk_tiers;
create policy "Users can see only their own FMK tiers"
on public.spookify_fmk_tiers for select to authenticated
using (public.account_is_active() and user_id = auth.uid());

drop policy if exists "Users can see only their own FMK pairs" on public.spookify_fmk_pairs;
create policy "Users can see only their own FMK pairs"
on public.spookify_fmk_pairs for select to authenticated
using (public.account_is_active() and user_id = auth.uid());

-- Three songs from the lowest tier that still has a trio never matched before; none of them is the caller's own.
create or replace function public.next_spookify_fmk()
returns table(
  id uuid,
  spotify_track_id text,
  title text,
  artist text,
  album_art_url text,
  spotify_url text,
  added_by uuid,
  tier integer
)
language sql security definer set search_path = ''
as $$
  with candidates as (
    select s.id, coalesce(t.points, 0) as tier
    from public.spookify_songs s
    left join public.spookify_fmk_tiers t on t.song_id = s.id and t.user_id = auth.uid()
    where private.current_account_active(false)
      and s.added_by <> auth.uid()
      and not coalesce(t.deleted, false)
  ),
  trio as (
    select a.id as a_id, b.id as b_id, c.id as c_id, a.tier
    from candidates a
    join candidates b on b.tier = a.tier and b.id > a.id
    join candidates c on c.tier = a.tier and c.id > b.id
    where not exists (
      select 1 from public.spookify_fmk_pairs p
      where p.user_id = auth.uid()
        and ((p.song_a = a.id and p.song_b = b.id)
          or (p.song_a = a.id and p.song_b = c.id)
          or (p.song_a = b.id and p.song_b = c.id))
    )
    order by a.tier, random()
    limit 1
  )
  select s.id, s.spotify_track_id, s.title, s.artist, s.album_art_url, s.spotify_url, s.added_by, trio.tier
  from trio
  join public.spookify_songs s on s.id in (trio.a_id, trio.b_id, trio.c_id)
  order by random()
$$;

-- The highest tier any of the caller's songs has reached, deleted songs included.
create or replace function public.spookify_fmk_max_tier()
returns integer
language sql security definer set search_path = ''
as $$
  select coalesce(max(points), 0)
  from public.spookify_fmk_tiers
  where user_id = auth.uid() and private.current_account_active(false)
$$;

create or replace function public.submit_spookify_fmk(p_sing uuid, p_listen uuid, p_delete uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  chooser uuid := auth.uid();
  chosen uuid[] := array[p_sing, p_listen, p_delete];
  found_count integer;
  tier_count integer;
  has_own boolean;
  has_deleted boolean;
  sing_submitter uuid;
  listen_submitter uuid;
begin
  if chooser is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if p_sing is null or p_listen is null or p_delete is null
    or p_sing = p_listen or p_sing = p_delete or p_listen = p_delete then
    raise exception 'An FMK needs three different songs' using errcode = '22023';
  end if;

  select count(*), count(distinct coalesce(t.points, 0)), coalesce(bool_or(s.added_by = chooser), false),
    coalesce(bool_or(coalesce(t.deleted, false)), false)
  into found_count, tier_count, has_own, has_deleted
  from public.spookify_songs s
  left join public.spookify_fmk_tiers t on t.song_id = s.id and t.user_id = chooser
  where s.id = any(chosen);

  if found_count <> 3 then
    raise exception 'Unknown song' using errcode = 'P0002';
  end if;
  if has_own then
    raise exception 'You cannot choose your own song' using errcode = 'P0001';
  end if;
  if has_deleted then
    raise exception 'You already deleted one of these songs' using errcode = 'P0001';
  end if;
  if tier_count > 1 then
    raise exception 'These songs are not in the same tier' using errcode = 'P0001';
  end if;

  begin
    insert into public.spookify_fmk_pairs (user_id, song_a, song_b) values
      (chooser, least(p_sing, p_listen), greatest(p_sing, p_listen)),
      (chooser, least(p_sing, p_delete), greatest(p_sing, p_delete)),
      (chooser, least(p_listen, p_delete), greatest(p_listen, p_delete));
  exception when unique_violation then
    raise exception 'These songs have already faced each other' using errcode = 'P0001';
  end;

  insert into public.spookify_fmk_tiers (user_id, song_id, points) values (chooser, p_sing, 2)
    on conflict (user_id, song_id) do update set points = public.spookify_fmk_tiers.points + 2;
  insert into public.spookify_fmk_tiers (user_id, song_id, points) values (chooser, p_listen, 1)
    on conflict (user_id, song_id) do update set points = public.spookify_fmk_tiers.points + 1;
  insert into public.spookify_fmk_tiers (user_id, song_id, deleted) values (chooser, p_delete, true)
    on conflict (user_id, song_id) do update set deleted = true;

  select added_by into sing_submitter from public.spookify_songs where id = p_sing;
  select added_by into listen_submitter from public.spookify_songs where id = p_listen;
  perform private.award_spookify(chooser, 0, 1, 0);
  perform private.award_spookify(sing_submitter, 0, 0, 1);
  perform private.award_spookify(listen_submitter, 0, 0, 0.5);
  perform private.award_song(p_sing, 1);
  perform private.award_song(p_listen, 0.5);
end;
$$;

revoke all on function public.next_spookify_fmk(), public.spookify_fmk_max_tier(),
  public.submit_spookify_fmk(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.next_spookify_fmk(), public.spookify_fmk_max_tier(),
  public.submit_spookify_fmk(uuid, uuid, uuid) to authenticated;

-- Battle pass: every badge is worth points (XP), editable by admins. A user's XP is never stored; it is the sum
-- of the current points of the badges they hold, so changing a value corrects everybody at once.
create table if not exists public.badge_points (
  badge_id text primary key,
  points integer not null check (points between 0 and 1000)
);
insert into public.badge_points (badge_id, points) values
  ('spooker', 100), ('karaoke', 100), ('voter', 100),
  ('clicker', 200), ('tagged', 200), ('swipes', 200), ('songmaster', 200),
  ('fan', 300), ('fmk', 300),
  ('winner-winner', 500)
on conflict (badge_id) do nothing;

-- One value per custom badge text; badges an admin gave before this existed start at 10.
create table if not exists public.custom_badge_points (
  label text primary key check (btrim(label) <> ''),
  points integer not null default 10 check (points between 0 and 1000)
);
insert into public.custom_badge_points (label)
select distinct btrim(substr(b, 8)) from public.users u, unnest(u.badges) b
where b like 'custom:%' and btrim(substr(b, 8)) <> ''
on conflict (label) do nothing;

alter table public.badge_points enable row level security;
alter table public.custom_badge_points enable row level security;
revoke all on public.badge_points, public.custom_badge_points from anon, authenticated;
grant select on public.badge_points, public.custom_badge_points to authenticated;
grant update on public.badge_points to authenticated;
grant insert, update, delete on public.custom_badge_points to authenticated;

drop policy if exists "Active users can read badge points" on public.badge_points;
create policy "Active users can read badge points"
on public.badge_points for select to authenticated
using (public.account_is_active());
drop policy if exists "Admins can edit badge points" on public.badge_points;
create policy "Admins can edit badge points"
on public.badge_points for update to authenticated
using (public.account_is_active_admin()) with check (public.account_is_active_admin());

drop policy if exists "Active users can read custom badge points" on public.custom_badge_points;
create policy "Active users can read custom badge points"
on public.custom_badge_points for select to authenticated
using (public.account_is_active());
drop policy if exists "Admins can insert custom badge points" on public.custom_badge_points;
create policy "Admins can insert custom badge points"
on public.custom_badge_points for insert to authenticated
with check (public.account_is_active_admin());
drop policy if exists "Admins can edit custom badge points" on public.custom_badge_points;
create policy "Admins can edit custom badge points"
on public.custom_badge_points for update to authenticated
using (public.account_is_active_admin()) with check (public.account_is_active_admin());
drop policy if exists "Admins can delete custom badge points" on public.custom_badge_points;
create policy "Admins can delete custom badge points"
on public.custom_badge_points for delete to authenticated
using (public.account_is_active_admin());

-- Every vote pays its winners a set amount of points, 10 unless the admin says otherwise.
alter table public.votes
  add column if not exists winner_points integer not null default 10 check (winner_points between 0 and 1000);

drop function if exists public.start_vote(text);
create or replace function public.start_vote(p_category text, p_winner_points integer default 10)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
  cleaned text := btrim(coalesce(p_category, ''));
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can start a vote' using errcode = '42501';
  end if;
  if cleaned = '' or char_length(cleaned) > 60 then
    raise exception 'The category must be 1 to 60 characters' using errcode = '22023';
  end if;
  if p_winner_points is null or p_winner_points not between 0 and 1000 then
    raise exception 'Winner points must be 0 to 1000' using errcode = '22023';
  end if;
  begin
    insert into public.votes (category, winner_points) values (cleaned, p_winner_points) returning id into new_id;
  exception when unique_violation then
    raise exception 'A vote is already open' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;

create or replace function public.set_vote_winner_points(p_vote_id uuid, p_points integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can change winner points' using errcode = '42501';
  end if;
  if p_points is null or p_points not between 0 and 1000 then
    raise exception 'Winner points must be 0 to 1000' using errcode = '22023';
  end if;
  update public.votes set winner_points = p_points where id = p_vote_id;
  if not found then
    raise exception 'Vote not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Current value of every regular badge's goal for one user.
create or replace function private.badge_progress(p_user uuid)
returns table(badge_id text, progress numeric)
language sql stable security definer set search_path = ''
as $$
  select 'clicker'::text, coalesce((select click_count from public.users where id = p_user), 0)::numeric
  union all select 'songmaster', coalesce((select spookify_score from public.users where id = p_user), 0)::numeric
  union all select 'spooker', (select count(*) from public.spooks where user_id = p_user)::numeric
  union all select 'tagged', (
    select count(*) from public.spook_tagged_users t join public.spooks s on s.id = t.spook_id
    where t.user_id = p_user and s.user_id <> p_user
  )::numeric
  union all select 'fan', coalesce((
    select max(c) from (
      select count(*) as c from public.spookify_swipes w join public.spookify_songs s on s.id = w.song_id
      where s.added_by = p_user and w.direction = 'right' group by w.song_id
    ) per_song
  ), 0)::numeric
  union all select 'karaoke', (select count(*) from public.karaoke_queue where queued_by = p_user and status = 'completed')::numeric
  union all select 'swipes', (select count(*) from public.spookify_swipes where user_id = p_user)::numeric
  union all select 'fmk', (select count(*) / 3 from public.spookify_fmk_pairs where user_id = p_user)::numeric
  -- Only ended votes count, so resetting an open vote leaves no trace of who had voted.
  union all select 'voter', (
    select count(*) from public.vote_participation p join public.votes v on v.id = p.vote_id
    where p.user_id = p_user and v.status = 'ended'
  )::numeric
$$;
revoke all on function private.badge_progress(uuid) from public, anon, authenticated;

-- Awards the caller every regular badge whose goal is reached (add-only), then Winner winner once they hold all
-- nine, and returns the progress the battle pass shows.
create or replace function public.my_badge_progress()
returns table(badge_id text, progress numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  earned text[];
  regular text[] := array['clicker', 'songmaster', 'spooker', 'tagged', 'fan', 'karaoke', 'swipes', 'fmk', 'voter'];
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  select coalesce(array_agg(p.badge_id), '{}'::text[]) into earned
  from private.badge_progress(me) p
  join (values
    ('clicker', 500), ('songmaster', 100), ('spooker', 10), ('tagged', 10), ('fan', 10),
    ('karaoke', 3), ('swipes', 50), ('fmk', 25), ('voter', 1)
  ) as goal(id, target) on goal.id = p.badge_id
  where p.progress >= goal.target;

  update public.users u
  set badges = u.badges || array(select e from unnest(earned) e where not (e = any(u.badges)))
  where u.id = me and exists (select 1 from unnest(earned) e where not (e = any(u.badges)));

  update public.users u
  set badges = array_append(u.badges, 'winner-winner')
  where u.id = me
    and not ('winner-winner' = any(u.badges))
    and regular <@ u.badges;

  return query select p.badge_id, p.progress from private.badge_progress(me) p;
end;
$$;

revoke all on function public.start_vote(text, integer), public.set_vote_winner_points(uuid, integer),
  public.my_badge_progress() from public, anon, authenticated;
grant execute on function public.start_vote(text, integer), public.set_vote_winner_points(uuid, integer),
  public.my_badge_progress() to authenticated;
-- Badges, click counts and emails can no longer be edited by the user they belong to.
-- Badges are awarded by the server, clicks are registered through register_clicks(), and only admins edit the rest.

alter table public.users add column if not exists clicks_flushed_at timestamptz;

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
    -- Spookify rewards are server-authoritative: only the award functions raise this flag.
    if (new.spookify_score, new.tinder_score, new.fmk_score, new.submitter_score)
      is distinct from (old.spookify_score, old.tinder_score, old.fmk_score, old.submitter_score)
      and coalesce(current_setting('spookify.award', true), '') <> 'on' then
      raise exception 'Spookify score is awarded by the server' using errcode = '42501';
    end if;
    if (new.badges, new.click_count, new.clicks_flushed_at)
      is distinct from (old.badges, old.click_count, old.clicks_flushed_at)
      and coalesce(current_setting('spookify.award', true), '') <> 'on'
      and not private.current_account_active(true) then
      raise exception 'Badges and clicks are awarded by the server' using errcode = '42501';
    end if;
    if new.email is distinct from old.email and not private.current_account_active(true) then
      raise exception 'Only admins can change an email' using errcode = '42501';
    end if;
  elsif new.deletion_pending_at is not null or new.is_admin
    or new.spookify_score <> 0 or new.tinder_score <> 0 or new.fmk_score <> 0 or new.submitter_score <> 0
    or new.badges <> '{}'::text[] or new.click_count <> 0 then
    raise exception 'New accounts must be active non-admins' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_changes() from public, anon, authenticated;

-- Adds a batch of clicks for the caller. The batch is capped at 20 clicks per second since the previous batch
-- (at least 20, at most 200 per call), and the clicker badge is awarded by my_badge_progress().
create or replace function public.register_clicks(p_count integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  last_at timestamptz;
  current_count integer;
  elapsed numeric;
  granted integer;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  select u.clicks_flushed_at, u.click_count into last_at, current_count
  from public.users u where u.id = me for update;

  elapsed := extract(epoch from (now() - coalesce(last_at, now() - interval '1 second')));
  granted := least(greatest(coalesce(p_count, 0), 0), least(200, greatest(20, floor(20 * elapsed))::integer));

  perform set_config('spookify.award', 'on', true);
  update public.users set click_count = click_count + granted, clicks_flushed_at = now() where id = me;
  perform set_config('spookify.award', 'off', true);

  return current_count + granted;
end;
$$;

create or replace function public.my_badge_progress()
returns table(badge_id text, progress numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  earned text[];
  regular text[] := array['clicker', 'songmaster', 'spooker', 'tagged', 'fan', 'karaoke', 'swipes', 'fmk', 'voter'];
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  select coalesce(array_agg(p.badge_id), '{}'::text[]) into earned
  from private.badge_progress(me) p
  join (values
    ('clicker', 500), ('songmaster', 100), ('spooker', 10), ('tagged', 10), ('fan', 10),
    ('karaoke', 3), ('swipes', 50), ('fmk', 25), ('voter', 1)
  ) as goal(id, target) on goal.id = p.badge_id
  where p.progress >= goal.target;

  perform set_config('spookify.award', 'on', true);
  update public.users u
  set badges = u.badges || array(select e from unnest(earned) e where not (e = any(u.badges)))
  where u.id = me and exists (select 1 from unnest(earned) e where not (e = any(u.badges)));

  update public.users u
  set badges = array_append(u.badges, 'winner-winner')
  where u.id = me
    and not ('winner-winner' = any(u.badges))
    and regular <@ u.badges;
  perform set_config('spookify.award', 'off', true);

  return query select p.badge_id, p.progress from private.badge_progress(me) p;
end;
$$;

revoke all on function public.register_clicks(integer), public.my_badge_progress() from public, anon, authenticated;
grant execute on function public.register_clicks(integer), public.my_badge_progress() to authenticated;

-- Every user has a distinct costume (ignoring case and surrounding spaces), so a costume identifies one person in votes.
-- Existing duplicates are left alone; only new or changed costumes are checked.

create or replace function private.guard_unique_costume()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  key text := lower(btrim(coalesce(new.costume, '')));
begin
  if key = '' then return new; end if;
  if tg_op = 'UPDATE' and key = lower(btrim(coalesce(old.costume, ''))) then return new; end if;

  perform pg_advisory_xact_lock(hashtext('costume:' || key));
  if exists (
    select 1 from public.users u where u.id <> new.id and lower(btrim(u.costume)) = key
  ) then
    raise exception 'Costume already taken' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_unique_costume() from public, anon, authenticated;

drop trigger if exists guard_unique_costume on public.users;
create trigger guard_unique_costume before insert or update of costume on public.users
for each row execute function private.guard_unique_costume();

-- Lets the signup form warn before an account is created; the caller's own costume counts as available.
create or replace function public.costume_available(p_costume text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.users u
    where lower(btrim(u.costume)) = lower(btrim(coalesce(p_costume, '')))
      and btrim(coalesce(p_costume, '')) <> ''
      and u.id is distinct from auth.uid()
  )
$$;
revoke all on function public.costume_available(text) from public, anon, authenticated;
grant execute on function public.costume_available(text) to anon, authenticated;

