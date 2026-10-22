-- Spookify: users add Spotify songs to a shared pool (Source) and swipe through random pool songs (Tinder).
-- Unrelated to votes: a swipe is a named preference, never an anonymous ballot.
-- Rewards move in halves, so the score is numeric and is only ever written by the functions below.
alter table public.users add column if not exists spookify_score numeric(8,1) not null default 0;

-- Re-stated from the account deletion guard, plus the rule that only the award functions move a score.
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
    if new.spookify_score is distinct from old.spookify_score
      and coalesce(current_setting('spookify.award', true), '') <> 'on' then
      raise exception 'Spookify score is awarded by the server' using errcode = '42501';
    end if;
  elsif new.deletion_pending_at is not null or new.is_admin or new.spookify_score <> 0 then
    raise exception 'New accounts must be active non-admins' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_changes() from public, anon, authenticated;

create table if not exists public.spookify_songs (
  id uuid primary key default gen_random_uuid(),
  spotify_track_id text not null unique,
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  artist text not null check (btrim(artist) <> '' and char_length(artist) <= 200),
  album_art_url text,
  spotify_url text,
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
  perform set_config('spookify.award', 'on', true);
  update public.users set spookify_score = spookify_score + 0.5 where id = submitter;
  perform set_config('spookify.award', 'off', true);
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
  perform set_config('spookify.award', 'on', true);
  update public.users
    set spookify_score = spookify_score + case when p_direction = 'right' then 1 else 0.5 end
    where id = swiper;
  if p_direction = 'right' then
    update public.users set spookify_score = spookify_score + 1 where id = submitter;
  end if;
  perform set_config('spookify.award', 'off', true);
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
