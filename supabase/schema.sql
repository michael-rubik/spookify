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

-- Daily cap on songs a user can add (rolling 24 hours), editable by admins.
create table if not exists public.app_settings (
  key text primary key,
  int_value integer not null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

insert into public.app_settings (key, int_value) values ('daily_song_limit', 10)
on conflict (key) do nothing;

create index if not exists spookify_songs_added_by_created_idx on public.spookify_songs (added_by, created_at);

create or replace function public.daily_song_limit()
returns integer
language sql stable security definer set search_path = ''
as $$
  select int_value from public.app_settings where key = 'daily_song_limit'
$$;

create or replace function public.set_daily_song_limit(p_limit integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can change the song limit' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 0 and 1000 then
    raise exception 'The song limit must be 0 to 1000' using errcode = '22023';
  end if;
  update public.app_settings set int_value = p_limit where key = 'daily_song_limit';
end;
$$;

revoke all on function public.daily_song_limit(), public.set_daily_song_limit(integer) from public, anon, authenticated;
grant execute on function public.daily_song_limit(), public.set_daily_song_limit(integer) to authenticated;

-- Battle pass levels: reaching a level (by XP) raises how many songs a user may add per rolling 24 hours.
-- A user's limit is the base `daily_song_limit` plus the bonus songs of every level they have reached.
-- Levels are numbered by XP order (level 1 = lowest threshold) and editable by admins.
create table if not exists public.battle_pass_levels (
  id uuid primary key default gen_random_uuid(),
  xp_required integer not null unique check (xp_required between 0 and 100000),
  bonus_songs integer not null default 0 check (bonus_songs between 0 and 100)
);
insert into public.battle_pass_levels (xp_required, bonus_songs)
select * from (values (200, 1), (500, 1), (1000, 1), (1500, 1), (2200, 1)) as seed(xp_required, bonus_songs)
where not exists (select 1 from public.battle_pass_levels);

alter table public.battle_pass_levels enable row level security;
revoke all on public.battle_pass_levels from anon, authenticated;
grant select, insert, update, delete on public.battle_pass_levels to authenticated;

drop policy if exists "Active users can read battle pass levels" on public.battle_pass_levels;
create policy "Active users can read battle pass levels"
on public.battle_pass_levels for select to authenticated
using (public.account_is_active());
drop policy if exists "Admins can manage battle pass levels" on public.battle_pass_levels;
create policy "Admins can manage battle pass levels"
on public.battle_pass_levels for all to authenticated
using (public.account_is_active_admin()) with check (public.account_is_active_admin());

-- Same sum the battle pass shows: held pass badges, custom badges (10 unless set) and vote wins.
create or replace function private.user_xp(p_user uuid)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  return (
    with held as (
      select distinct b from public.users u, unnest(u.badges) b where u.id = p_user
    )
    select (
      coalesce((select sum(bp.points) from held join public.badge_points bp on bp.badge_id = held.b), 0)
      + coalesce((
        select sum(coalesce(cp.points, 10))
        from held left join public.custom_badge_points cp on cp.label = btrim(substr(held.b, 8))
        where held.b like 'custom:%' and btrim(substr(held.b, 8)) <> ''
      ), 0)
      + coalesce((
        select sum(v.winner_points)
        from public.vote_winners w join public.votes v on v.id = w.vote_id
        where w.user_id = p_user
      ), 0)
    )::integer
  );
end;
$$;

create or replace function private.song_limit(p_user uuid)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  return coalesce(public.daily_song_limit(), 10) + coalesce((
    select sum(bonus_songs) from public.battle_pass_levels where xp_required <= private.user_xp(p_user)
  ), 0)::integer;
end;
$$;

create or replace function public.my_song_allowance()
returns table(xp integer, level integer, daily_limit integer, added_today integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_xp integer;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  my_xp := private.user_xp(me);
  return query select
    my_xp,
    (select count(*) from public.battle_pass_levels l where l.xp_required <= my_xp)::integer,
    private.song_limit(me),
    (select count(*) from public.spookify_songs s
      where s.added_by = me and s.created_at > now() - interval '24 hours')::integer;
end;
$$;

revoke all on function private.user_xp(uuid), private.song_limit(uuid) from public, anon, authenticated;
revoke all on function public.my_song_allowance() from public, anon, authenticated;
grant execute on function public.my_song_allowance() to authenticated;

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
  -- Serialise a user's submissions so parallel requests cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtextextended('add_spookify_song:' || submitter::text, 0));
  if (
    select count(*) from public.spookify_songs
    where added_by = submitter and created_at > now() - interval '24 hours'
  ) >= private.song_limit(submitter) then
    raise exception 'Daily song limit reached' using errcode = 'P0001';
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

-- The spooker badge is awarded for the first spook instead of the tenth.
-- Everyone who has already posted a spook receives it on their next badge check.

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
    ('clicker', 500), ('songmaster', 100), ('spooker', 1), ('tagged', 10), ('fan', 10),
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

revoke all on function public.my_badge_progress() from public, anon, authenticated;
grant execute on function public.my_badge_progress() to authenticated;

-- Admins can hide every costume with one switch: while hidden, a costume is only visible to its owner.
-- The column is no longer readable straight from public.users; clients read it through visible_costumes().

insert into public.app_settings (key, int_value) values ('costumes_hidden', 0)
on conflict (key) do nothing;

-- Readable before sign in, so the signup form can tell people whether their costume will be shown.
create or replace function public.costumes_hidden()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select int_value <> 0 from public.app_settings where key = 'costumes_hidden'), false)
$$;

create or replace function public.set_costumes_hidden(p_hidden boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can hide costumes' using errcode = '42501';
  end if;
  if p_hidden is null then
    raise exception 'Choose hidden or visible' using errcode = '22023';
  end if;
  insert into public.app_settings (key, int_value) values ('costumes_hidden', case when p_hidden then 1 else 0 end)
  on conflict (key) do update set int_value = excluded.int_value;
end;
$$;

-- Everyone's costume while costumes are shown, otherwise only the caller's own.
create or replace function public.visible_costumes()
returns table (id uuid, costume text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.costume
  from public.users u
  where private.current_account_active(false)
    and (not public.costumes_hidden() or u.id = auth.uid())
$$;

revoke all on function public.costumes_hidden(), public.set_costumes_hidden(boolean), public.visible_costumes()
  from public, anon, authenticated;
grant execute on function public.costumes_hidden() to anon, authenticated;
grant execute on function public.set_costumes_hidden(boolean), public.visible_costumes() to authenticated;

-- Every column except costume stays readable; later columns need an explicit grant.
revoke select on public.users from anon, authenticated;
do $$
declare
  readable text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into readable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'users' and column_name <> 'costume';
  execute format('grant select (%s) on public.users to authenticated', readable);
end;
$$;

-- Clicker fights: a fighter (250+ lifetime clicks) calls a timed contest in the clicker view. Every fighter takes
-- part automatically; each click beyond 250 made while it runs adds to their fight score. Winning earns a badge.

insert into public.app_settings (key, int_value) values ('fight_duration_minutes', 5), ('daily_fight_limit', 1)
on conflict (key) do nothing;

alter table public.battle_pass_levels
  add column if not exists bonus_fights integer not null default 0 check (bonus_fights between 0 and 100);

create table if not exists public.clicker_fights (
  id uuid primary key default gen_random_uuid(),
  called_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  closed_at timestamptz
);
create index if not exists clicker_fights_called_by_started_idx on public.clicker_fights (called_by, started_at);

create table if not exists public.clicker_fight_scores (
  fight_id uuid not null references public.clicker_fights(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  clicks integer not null default 0,
  won boolean not null default false,
  primary key (fight_id, user_id)
);

alter table public.clicker_fights enable row level security;
alter table public.clicker_fight_scores enable row level security;
revoke all on public.clicker_fights, public.clicker_fight_scores from anon, authenticated;
grant select on public.clicker_fights, public.clicker_fight_scores to authenticated;

drop policy if exists "Active users can read clicker fights" on public.clicker_fights;
create policy "Active users can read clicker fights"
on public.clicker_fights for select to authenticated
using (public.account_is_active());
drop policy if exists "Active users can read clicker fight scores" on public.clicker_fight_scores;
create policy "Active users can read clicker fight scores"
on public.clicker_fight_scores for select to authenticated
using (public.account_is_active());

-- Two new regular badges' points, plus the legacy badge that replaces Winner winner for its former holders.
insert into public.badge_points (badge_id, points) values ('fight-winner', 200), ('legacy-winner', 100)
on conflict (badge_id) do nothing;

-- Ends every fight whose time is up and marks its winners: the top score, ties included, but only when at least
-- two fighters exist and the top score is above 0. Runs lazily whenever a client asks about or feeds a fight.
create or replace function private.close_clicker_fights()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  due uuid;
  top integer;
  fighters integer;
begin
  for due in
    select id from public.clicker_fights where closed_at is null and ends_at <= now() for update
  loop
    update public.clicker_fights set closed_at = now() where id = due;
    select count(*) into fighters from public.users u where u.click_count >= 250 and u.deletion_pending_at is null;
    select coalesce(max(s.clicks), 0) into top
    from public.clicker_fight_scores s join public.users u on u.id = s.user_id
    where s.fight_id = due and u.deletion_pending_at is null;
    if fighters >= 2 and top > 0 then
      update public.clicker_fight_scores s set won = true
      from public.users u
      where s.fight_id = due and s.clicks = top and u.id = s.user_id and u.deletion_pending_at is null;
    end if;
  end loop;
end;
$$;

create or replace function private.fight_limit(p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce((select int_value from public.app_settings where key = 'daily_fight_limit'), 1) + coalesce((
    select sum(bonus_fights) from public.battle_pass_levels where xp_required <= private.user_xp(p_user)
  ), 0)::integer
$$;

revoke all on function private.close_clicker_fights(), private.fight_limit(uuid) from public, anon, authenticated;

-- Dropped first so the file can be re-applied after later migrations changed these signatures.
drop function if exists public.clicker_fight_settings();
drop function if exists public.set_clicker_fight_settings(integer, integer);
drop function if exists public.set_clicker_fight_settings(integer, integer, integer);
drop function if exists public.clicker_fight_state();

create or replace function public.clicker_fight_settings()
returns table(duration_minutes integer, daily_limit integer)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce((select int_value from public.app_settings where key = 'fight_duration_minutes'), 5),
    coalesce((select int_value from public.app_settings where key = 'daily_fight_limit'), 1)
$$;

create or replace function public.set_clicker_fight_settings(p_minutes integer, p_limit integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can change the clicker fight settings' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 1 and 120 then
    raise exception 'A fight lasts 1 to 120 minutes' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 0 and 100 then
    raise exception 'The daily fight limit must be 0 to 100' using errcode = '22023';
  end if;
  insert into public.app_settings (key, int_value) values ('fight_duration_minutes', p_minutes), ('daily_fight_limit', p_limit)
  on conflict (key) do update set int_value = excluded.int_value;
end;
$$;

-- The latest fight (running or finished) and what the caller may do next.
create or replace function public.clicker_fight_state()
returns table(
  fight_id uuid, started_at timestamptz, ends_at timestamptz, running boolean, server_now timestamptz,
  fighters integer, daily_limit integer, calls_today integer, next_call_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  latest public.clicker_fights;
  limit_n integer;
  used integer;
  oldest timestamptz;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  perform private.close_clicker_fights();

  select * into latest from public.clicker_fights f order by f.started_at desc limit 1;
  limit_n := private.fight_limit(me);
  select count(*), min(f.started_at) into used, oldest
  from public.clicker_fights f where f.called_by = me and f.started_at > now() - interval '24 hours';

  return query select
    latest.id, latest.started_at, latest.ends_at, (latest.id is not null and latest.closed_at is null), now(),
    (select count(*) from public.users u where u.click_count >= 250 and u.deletion_pending_at is null)::integer,
    limit_n, used, case when used >= limit_n then oldest + interval '24 hours' end;
end;
$$;

create or replace function public.call_clicker_fight()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  minutes integer;
  new_id uuid;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if coalesce((select click_count from public.users where id = me), 0) < 250 then
    raise exception 'You need 250 clicks to call a clicker fight' using errcode = '42501';
  end if;

  -- One fight at a time: serialise every call.
  perform pg_advisory_xact_lock(hashtextextended('call_clicker_fight', 0));
  perform private.close_clicker_fights();
  if exists (select 1 from public.clicker_fights where closed_at is null) then
    raise exception 'A clicker fight is already running' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.clicker_fights where called_by = me and started_at > now() - interval '24 hours'
  ) >= private.fight_limit(me) then
    raise exception 'Daily fight limit reached' using errcode = 'P0001';
  end if;

  select int_value into minutes from public.app_settings where key = 'fight_duration_minutes';
  insert into public.clicker_fights (called_by, ends_at)
  values (me, now() + make_interval(mins => coalesce(minutes, 5)))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.clicker_fight_settings(), public.set_clicker_fight_settings(integer, integer),
  public.clicker_fight_state(), public.call_clicker_fight() from public, anon, authenticated;
grant execute on function public.clicker_fight_settings(), public.set_clicker_fight_settings(integer, integer),
  public.clicker_fight_state(), public.call_clicker_fight() to authenticated;

-- Fight clicks are ordinary clicks that also score: only the part of a batch beyond 250 lifetime clicks counts.
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
  counted integer;
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

  counted := greatest(0, current_count + granted - greatest(current_count, 250));
  if counted > 0 then
    perform private.close_clicker_fights();
    insert into public.clicker_fight_scores (fight_id, user_id, clicks)
    select f.id, me, counted from public.clicker_fights f where f.closed_at is null and f.ends_at > now()
    on conflict (fight_id, user_id) do update set clicks = public.clicker_fight_scores.clicks + excluded.clicks;
  end if;

  return current_count + granted;
end;
$$;

-- Winning a fight is a tenth regular badge, so Winner winner now needs it too.
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
  union all select 'fight-winner', (
    select count(*) from public.clicker_fight_scores where user_id = p_user and won
  )::numeric
$$;
revoke all on function private.badge_progress(uuid) from public, anon, authenticated;

create or replace function public.my_badge_progress()
returns table(badge_id text, progress numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  earned text[];
  regular text[] := array[
    'clicker', 'songmaster', 'spooker', 'tagged', 'fan', 'karaoke', 'swipes', 'fmk', 'voter', 'fight-winner'
  ];
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  perform private.close_clicker_fights();

  select coalesce(array_agg(p.badge_id), '{}'::text[]) into earned
  from private.badge_progress(me) p
  join (values
    ('clicker', 500), ('songmaster', 100), ('spooker', 1), ('tagged', 10), ('fan', 10),
    ('karaoke', 3), ('swipes', 50), ('fmk', 25), ('voter', 1), ('fight-winner', 1)
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

-- Current Winner winner holders lose it and receive the legacy badge instead; they earn Winner winner back by
-- winning a fight. Holders who already won a fight keep it, which also makes this safe to run twice.
update public.users
set badges = array_remove(badges, 'winner-winner')
  || array(select 'legacy-winner' where not ('legacy-winner' = any(badges)))
where 'winner-winner' = any(badges) and not ('fight-winner' = any(badges));
-- Daily limits (songs added, clicker fight calls) reset at midnight Europe/Berlin instead of rolling 24h,
-- or immediately when an admin calls reset_daily_limits().
insert into public.app_settings (key, int_value) values ('limits_reset_at', 0)
on conflict (key) do nothing;

-- Start of the current limit day: the later of local midnight and the last admin reset.
create or replace function private.limit_day_start()
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select greatest(
    date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin',
    to_timestamp(coalesce((select int_value from public.app_settings where key = 'limits_reset_at'), 0))
  )
$$;

create or replace function private.next_limit_reset()
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select (date_trunc('day', now() at time zone 'Europe/Berlin') + interval '1 day') at time zone 'Europe/Berlin'
$$;

create or replace function public.reset_daily_limits()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can reset the daily limits' using errcode = '42501';
  end if;
  insert into public.app_settings (key, int_value) values ('limits_reset_at', ceil(extract(epoch from now()))::integer)
  on conflict (key) do update set int_value = excluded.int_value;
end;
$$;

revoke all on function private.limit_day_start(), private.next_limit_reset() from public, anon, authenticated;
revoke all on function public.reset_daily_limits() from public, anon, authenticated;
grant execute on function public.reset_daily_limits() to authenticated;

create or replace function public.my_song_allowance()
returns table(xp integer, level integer, daily_limit integer, added_today integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_xp integer;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  my_xp := private.user_xp(me);
  return query select
    my_xp,
    (select count(*) from public.battle_pass_levels l where l.xp_required <= my_xp)::integer,
    private.song_limit(me),
    (select count(*) from public.spookify_songs s
      where s.added_by = me and s.created_at >= private.limit_day_start())::integer;
end;
$$;

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
  -- Serialise a user's submissions so parallel requests cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtextextended('add_spookify_song:' || submitter::text, 0));
  if (
    select count(*) from public.spookify_songs
    where added_by = submitter and created_at >= private.limit_day_start()
  ) >= private.song_limit(submitter) then
    raise exception 'Daily song limit reached' using errcode = 'P0001';
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

create or replace function public.clicker_fight_state()
returns table(
  fight_id uuid, started_at timestamptz, ends_at timestamptz, running boolean, server_now timestamptz,
  fighters integer, daily_limit integer, calls_today integer, next_call_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  latest public.clicker_fights;
  limit_n integer;
  used integer;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  perform private.close_clicker_fights();

  select * into latest from public.clicker_fights f order by f.started_at desc limit 1;
  limit_n := private.fight_limit(me);
  select count(*) into used
  from public.clicker_fights f where f.called_by = me and f.started_at >= private.limit_day_start();

  return query select
    latest.id, latest.started_at, latest.ends_at, (latest.id is not null and latest.closed_at is null), now(),
    (select count(*) from public.users u where u.click_count >= 250 and u.deletion_pending_at is null)::integer,
    limit_n, used, case when used >= limit_n then private.next_limit_reset() end;
end;
$$;

create or replace function public.call_clicker_fight()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  minutes integer;
  new_id uuid;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if coalesce((select click_count from public.users where id = me), 0) < 250 then
    raise exception 'You need 250 clicks to call a clicker fight' using errcode = '42501';
  end if;

  -- One fight at a time: serialise every call.
  perform pg_advisory_xact_lock(hashtextextended('call_clicker_fight', 0));
  perform private.close_clicker_fights();
  if exists (select 1 from public.clicker_fights where closed_at is null) then
    raise exception 'A clicker fight is already running' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.clicker_fights where called_by = me and started_at >= private.limit_day_start()
  ) >= private.fight_limit(me) then
    raise exception 'Daily fight limit reached' using errcode = 'P0001';
  end if;

  select int_value into minutes from public.app_settings where key = 'fight_duration_minutes';
  insert into public.clicker_fights (called_by, ends_at)
  values (me, now() + make_interval(mins => coalesce(minutes, 5)))
  returning id into new_id;
  return new_id;
end;
$$;

-- A clicker fight starts only when another fighter accepts a challenge within the acceptance window.
-- An unaccepted or withdrawn challenge uses none of the caller's daily fight limit.
insert into public.app_settings (key, int_value) values ('challenge_window_minutes', 1)
on conflict (key) do nothing;

create table if not exists public.clicker_challenges (
  id uuid primary key default gen_random_uuid(),
  called_by uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by uuid references public.users (id) on delete set null,
  accepted_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists clicker_challenges_created_idx on public.clicker_challenges (created_at desc);
alter table public.clicker_challenges enable row level security;
revoke all on public.clicker_challenges from anon, authenticated;

-- Winners need at least two fighters who scored above 0, so a lone clicker cannot win.
create or replace function private.close_clicker_fights()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  due uuid;
  top integer;
  scorers integer;
begin
  for due in
    select id from public.clicker_fights where closed_at is null and ends_at <= now() for update
  loop
    update public.clicker_fights set closed_at = now() where id = due;
    select count(*) filter (where s.clicks > 0), coalesce(max(s.clicks), 0) into scorers, top
    from public.clicker_fight_scores s join public.users u on u.id = s.user_id
    where s.fight_id = due and u.deletion_pending_at is null;
    if scorers >= 2 and top > 0 then
      update public.clicker_fight_scores s set won = true
      from public.users u
      where s.fight_id = due and s.clicks = top and u.id = s.user_id and u.deletion_pending_at is null;
    end if;
  end loop;
end;
$$;

drop function if exists public.clicker_fight_settings();
drop function if exists public.set_clicker_fight_settings(integer, integer);
drop function if exists public.clicker_fight_state();

create or replace function public.clicker_fight_settings()
returns table(duration_minutes integer, daily_limit integer, challenge_minutes integer)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce((select int_value from public.app_settings where key = 'fight_duration_minutes'), 5),
    coalesce((select int_value from public.app_settings where key = 'daily_fight_limit'), 1),
    coalesce((select int_value from public.app_settings where key = 'challenge_window_minutes'), 1)
$$;

create or replace function public.set_clicker_fight_settings(p_minutes integer, p_limit integer, p_challenge_minutes integer default 1)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can change the clicker fight settings' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 1 and 120 then
    raise exception 'A fight lasts 1 to 120 minutes' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 0 and 100 then
    raise exception 'The daily fight limit must be 0 to 100' using errcode = '22023';
  end if;
  if p_challenge_minutes is null or p_challenge_minutes not between 1 and 60 then
    raise exception 'A challenge waits 1 to 60 minutes' using errcode = '22023';
  end if;
  insert into public.app_settings (key, int_value) values
    ('fight_duration_minutes', p_minutes), ('daily_fight_limit', p_limit), ('challenge_window_minutes', p_challenge_minutes)
  on conflict (key) do update set int_value = excluded.int_value;
end;
$$;

-- The latest fight, the pending challenge (if any) and what the caller may do next.
create or replace function public.clicker_fight_state()
returns table(
  fight_id uuid, started_at timestamptz, ends_at timestamptz, running boolean, server_now timestamptz,
  fighters integer, daily_limit integer, calls_today integer, next_call_at timestamptz,
  challenge_id uuid, challenge_by uuid, challenge_by_name text, challenge_expires_at timestamptz,
  challenge_expired boolean
)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  latest public.clicker_fights;
  chal public.clicker_challenges;
  limit_n integer;
  used integer;
  pending boolean;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  perform private.close_clicker_fights();

  select * into latest from public.clicker_fights f order by f.started_at desc limit 1;
  select * into chal from public.clicker_challenges c order by c.created_at desc limit 1;
  pending := chal.id is not null and chal.accepted_at is null and chal.cancelled_at is null and chal.expires_at > now();
  limit_n := private.fight_limit(me);
  select count(*) into used
  from public.clicker_fights f where f.called_by = me and f.started_at >= private.limit_day_start();

  return query select
    latest.id, latest.started_at, latest.ends_at, (latest.id is not null and latest.closed_at is null), now(),
    (select count(*) from public.clicker_fight_scores s join public.users u on u.id = s.user_id where s.fight_id = latest.id and s.clicks > 0 and u.deletion_pending_at is null)::integer,
    limit_n, used, case when used >= limit_n then private.next_limit_reset() end,
    case when pending then chal.id end,
    case when pending then chal.called_by end,
    case when pending then (select u.name from public.users u where u.id = chal.called_by) end,
    case when pending then chal.expires_at end,
    (chal.id is not null and not pending and chal.accepted_at is null and chal.cancelled_at is null);
end;
$$;

-- Issues a challenge; the fight itself starts when someone accepts.
create or replace function public.call_clicker_fight()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  minutes integer;
  new_id uuid;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if coalesce((select click_count from public.users where id = me), 0) < 250 then
    raise exception 'You need 250 clicks to call a clicker fight' using errcode = '42501';
  end if;

  -- One challenge or fight at a time: serialise every call, accept and cancel.
  perform pg_advisory_xact_lock(hashtextextended('call_clicker_fight', 0));
  perform private.close_clicker_fights();
  if exists (select 1 from public.clicker_fights where closed_at is null) then
    raise exception 'A clicker fight is already running' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.clicker_challenges where accepted_at is null and cancelled_at is null and expires_at > now()
  ) then
    raise exception 'A challenge is already waiting' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.clicker_fights where called_by = me and started_at >= private.limit_day_start()
  ) >= private.fight_limit(me) then
    raise exception 'Daily fight limit reached' using errcode = 'P0001';
  end if;

  select int_value into minutes from public.app_settings where key = 'challenge_window_minutes';
  insert into public.clicker_challenges (called_by, expires_at)
  values (me, now() + make_interval(mins => coalesce(minutes, 1)))
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.accept_clicker_challenge()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  chal public.clicker_challenges;
  minutes integer;
  new_id uuid;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if coalesce((select click_count from public.users where id = me), 0) < 250 then
    raise exception 'You need 250 clicks to accept a challenge' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('call_clicker_fight', 0));
  perform private.close_clicker_fights();
  select * into chal from public.clicker_challenges
  where accepted_at is null and cancelled_at is null and expires_at > now()
  order by created_at desc limit 1;
  if chal.id is null then
    raise exception 'No challenge is waiting' using errcode = 'P0001';
  end if;
  if chal.called_by = me then
    raise exception 'You cannot accept your own challenge' using errcode = '42501';
  end if;
  if (
    select count(*) from public.clicker_fights where called_by = chal.called_by and started_at >= private.limit_day_start()
  ) >= private.fight_limit(chal.called_by) then
    raise exception 'Daily fight limit reached' using errcode = 'P0001';
  end if;

  select int_value into minutes from public.app_settings where key = 'fight_duration_minutes';
  insert into public.clicker_fights (called_by, ends_at)
  values (chal.called_by, now() + make_interval(mins => coalesce(minutes, 5)))
  returning id into new_id;
  update public.clicker_challenges set accepted_by = me, accepted_at = now() where id = chal.id;
  return new_id;
end;
$$;

create or replace function public.cancel_clicker_challenge()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('call_clicker_fight', 0));
  update public.clicker_challenges set cancelled_at = now()
  where called_by = me and accepted_at is null and cancelled_at is null and expires_at > now();
end;
$$;

revoke all on function public.clicker_fight_settings(), public.set_clicker_fight_settings(integer, integer, integer),
  public.clicker_fight_state(), public.call_clicker_fight(), public.accept_clicker_challenge(),
  public.cancel_clicker_challenge() from public, anon, authenticated;
grant execute on function public.clicker_fight_settings(), public.set_clicker_fight_settings(integer, integer, integer),
  public.clicker_fight_state(), public.call_clicker_fight(), public.accept_clicker_challenge(),
  public.cancel_clicker_challenge() to authenticated;

-- Spookify FMK: a user keeps the trio they were dealt until they lock it in or skip it (skips are a daily
-- milestone reward), and may now be dealt their own songs, which earn only half the points when voted on.

-- A quarter point (listening to your own song) needs two decimals.
alter table public.users
  alter column spookify_score type numeric(8,2),
  alter column tinder_score type numeric(8,2),
  alter column fmk_score type numeric(8,2),
  alter column submitter_score type numeric(8,2);
alter table public.spookify_songs alter column points type numeric(8,2);

alter table public.battle_pass_levels
  add column if not exists fmk_skips integer not null default 0 check (fmk_skips between 0 and 100);

-- The trio a user is currently dealt, in display order. Removing any of its songs removes the row, so a new
-- trio is dealt (this also covers deleted accounts and the Spookify reset).
create table if not exists public.spookify_fmk_trios (
  user_id uuid primary key references public.users(id) on delete cascade,
  song_1 uuid not null references public.spookify_songs(id) on delete cascade,
  song_2 uuid not null references public.spookify_songs(id) on delete cascade,
  song_3 uuid not null references public.spookify_songs(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists spookify_fmk_trios_song_2_idx on public.spookify_fmk_trios (song_2);
create index if not exists spookify_fmk_trios_song_3_idx on public.spookify_fmk_trios (song_3);

create table if not exists public.spookify_fmk_skips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  skipped_at timestamptz not null default now()
);
create index if not exists spookify_fmk_skips_user_idx on public.spookify_fmk_skips (user_id, skipped_at);

alter table public.spookify_fmk_trios enable row level security;
alter table public.spookify_fmk_skips enable row level security;
revoke all on public.spookify_fmk_trios, public.spookify_fmk_skips from anon, authenticated;

-- Three shuffled songs from the lowest tier that still has a trio never matched before, skipping the
-- songs the user deleted and any trio equal to p_exclude. Null when no such trio exists.
create or replace function private.draw_fmk_trio(p_user uuid, p_exclude uuid[])
returns uuid[]
language sql security definer set search_path = ''
as $$
  with candidates as (
    select s.id, coalesce(t.points, 0) as tier
    from public.spookify_songs s
    left join public.spookify_fmk_tiers t on t.song_id = s.id and t.user_id = p_user
    where not coalesce(t.deleted, false)
  ),
  trio as (
    select a.id as a_id, b.id as b_id, c.id as c_id, a.tier
    from candidates a
    join candidates b on b.tier = a.tier and b.id > a.id
    join candidates c on c.tier = a.tier and c.id > b.id
    where not exists (
      select 1 from public.spookify_fmk_pairs p
      where p.user_id = p_user
        and ((p.song_a = a.id and p.song_b = b.id)
          or (p.song_a = a.id and p.song_b = c.id)
          or (p.song_a = b.id and p.song_b = c.id))
    )
      and (p_exclude is null or array[a.id, b.id, c.id] <> p_exclude)
    order by a.tier, random()
    limit 1
  )
  select array(select x from unnest(array[trio.a_id, trio.b_id, trio.c_id]) x order by random())
  from trio
$$;

create or replace function private.fmk_skip_limit(p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(fmk_skips), 0)::integer
  from public.battle_pass_levels
  where xp_required <= private.user_xp(p_user)
$$;

revoke all on function private.draw_fmk_trio(uuid, uuid[]), private.fmk_skip_limit(uuid) from public, anon, authenticated;

-- The caller's current trio, dealt on first use and kept until it is locked in or skipped.
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
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  drawn uuid[];
begin
  if me is null or not private.current_account_active(false) then
    return;
  end if;
  if not exists (select 1 from public.spookify_fmk_trios f where f.user_id = me) then
    drawn := private.draw_fmk_trio(me, null);
    if drawn is not null then
      insert into public.spookify_fmk_trios (user_id, song_1, song_2, song_3)
      values (me, drawn[1], drawn[2], drawn[3])
      on conflict (user_id) do nothing;
    end if;
  end if;
  return query
    select s.id, s.spotify_track_id, s.title, s.artist, s.album_art_url, s.spotify_url, s.added_by,
      coalesce((select t.points from public.spookify_fmk_tiers t where t.user_id = me and t.song_id = s.id), 0)
    from public.spookify_fmk_trios f
    cross join lateral unnest(array[f.song_1, f.song_2, f.song_3]) with ordinality as u(song_id, pos)
    join public.spookify_songs s on s.id = u.song_id
    where f.user_id = me
    order by u.pos;
end;
$$;

create or replace function public.my_fmk_skips()
returns table(skips_left integer, skips_total integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  total integer;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  total := private.fmk_skip_limit(me);
  return query select
    greatest(0, total - (select count(*) from public.spookify_fmk_skips k
      where k.user_id = me and k.skipped_at >= private.limit_day_start())::integer),
    total;
end;
$$;

-- Swaps the current trio for another one, which costs one of today's skips.
create or replace function public.skip_spookify_fmk()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  current_trio public.spookify_fmk_trios;
  drawn uuid[];
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  select * into current_trio from public.spookify_fmk_trios where user_id = me for update;
  if not found then
    raise exception 'You have no trio to skip' using errcode = 'P0001';
  end if;
  if private.fmk_skip_limit(me) - (
    select count(*) from public.spookify_fmk_skips k where k.user_id = me and k.skipped_at >= private.limit_day_start()
  ) <= 0 then
    raise exception 'No skips left today' using errcode = 'P0001';
  end if;

  drawn := private.draw_fmk_trio(
    me,
    (select array_agg(x order by x) from unnest(array[current_trio.song_1, current_trio.song_2, current_trio.song_3]) x)
  );
  if drawn is null then
    raise exception 'There is no other trio to skip to' using errcode = 'P0001';
  end if;

  update public.spookify_fmk_trios
  set song_1 = drawn[1], song_2 = drawn[2], song_3 = drawn[3], created_at = now()
  where user_id = me;
  insert into public.spookify_fmk_skips (user_id) values (me);
end;
$$;

-- Only the dealt trio can be locked in. Voting on your own song keeps its tier gain but pays half the
-- song and submitter points.
create or replace function public.submit_spookify_fmk(p_sing uuid, p_listen uuid, p_delete uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  chooser uuid := auth.uid();
  chosen uuid[] := array[p_sing, p_listen, p_delete];
  dealt public.spookify_fmk_trios;
  sing_submitter uuid;
  listen_submitter uuid;
  sing_factor numeric;
  listen_factor numeric;
begin
  if chooser is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if p_sing is null or p_listen is null or p_delete is null
    or p_sing = p_listen or p_sing = p_delete or p_listen = p_delete then
    raise exception 'An FMK needs three different songs' using errcode = '22023';
  end if;

  select * into dealt from public.spookify_fmk_trios where user_id = chooser for update;
  if not found
    or (select array_agg(x order by x) from unnest(array[dealt.song_1, dealt.song_2, dealt.song_3]) x)
      is distinct from (select array_agg(x order by x) from unnest(chosen) x) then
    raise exception 'These songs are not your current trio' using errcode = 'P0001';
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
  sing_factor := case when sing_submitter = chooser then 0.5 else 1 end;
  listen_factor := case when listen_submitter = chooser then 0.5 else 1 end;

  perform private.award_spookify(chooser, 0, 1, 0);
  perform private.award_spookify(sing_submitter, 0, 0, 1 * sing_factor);
  perform private.award_spookify(listen_submitter, 0, 0, 0.5 * listen_factor);
  perform private.award_song(p_sing, 1 * sing_factor);
  perform private.award_song(p_listen, 0.5 * listen_factor);

  delete from public.spookify_fmk_trios where user_id = chooser;
end;
$$;

revoke all on function public.next_spookify_fmk(), public.my_fmk_skips(), public.skip_spookify_fmk(),
  public.submit_spookify_fmk(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.next_spookify_fmk(), public.my_fmk_skips(), public.skip_spookify_fmk(),
  public.submit_spookify_fmk(uuid, uuid, uuid) to authenticated;

-- Admins can turn karaoke off and on. While it is off the view is hidden and nobody can add songs to the queue.
insert into public.app_settings (key, int_value) values ('karaoke_enabled', 1)
on conflict (key) do nothing;

create or replace function public.karaoke_enabled()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select int_value <> 0 from public.app_settings where key = 'karaoke_enabled'), true)
$$;

create or replace function public.set_karaoke_enabled(p_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can turn karaoke on or off' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Choose enabled or disabled' using errcode = '22023';
  end if;
  insert into public.app_settings (key, int_value) values ('karaoke_enabled', case when p_enabled then 1 else 0 end)
  on conflict (key) do update set int_value = excluded.int_value;
end;
$$;

revoke all on function public.karaoke_enabled(), public.set_karaoke_enabled(boolean) from public, anon, authenticated;
grant execute on function public.karaoke_enabled(), public.set_karaoke_enabled(boolean) to authenticated;

drop policy if exists "Authenticated users can add songs to the karaoke queue" on public.karaoke_queue;
create policy "Authenticated users can add songs to the karaoke queue"
on public.karaoke_queue
for insert
to authenticated
with check (
  auth.uid() = queued_by
  and char_length(title) > 0
  and duration_seconds > 0
  and public.karaoke_enabled()
);

-- Fan favourite now counts every tinder like (right swipe) on any song the user added, not the best single song.
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
  union all select 'fan', (
    select count(*) from public.spookify_swipes w join public.spookify_songs s on s.id = w.song_id
    where s.added_by = p_user and w.direction = 'right'
  )::numeric
  union all select 'karaoke', (select count(*) from public.karaoke_queue where queued_by = p_user and status = 'completed')::numeric
  union all select 'swipes', (select count(*) from public.spookify_swipes where user_id = p_user)::numeric
  union all select 'fmk', (select count(*) / 3 from public.spookify_fmk_pairs where user_id = p_user)::numeric
  -- Only ended votes count, so resetting an open vote leaves no trace of who had voted.
  union all select 'voter', (
    select count(*) from public.vote_participation p join public.votes v on v.id = p.vote_id
    where p.user_id = p_user and v.status = 'ended'
  )::numeric
  union all select 'fight-winner', (
    select count(*) from public.clicker_fight_scores where user_id = p_user and won
  )::numeric
$$;
revoke all on function private.badge_progress(uuid) from public, anon, authenticated;
