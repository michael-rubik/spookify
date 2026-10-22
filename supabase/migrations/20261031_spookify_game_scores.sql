-- Spookify scores per game. Adding a song pays nothing; submitters earn from other users' swipes and FMK
-- choices on their songs (submitter_score, the "Add song to game" score). Swiping pays the swiper
-- (tinder_score) and each FMK round pays its player (fmk_score). spookify_score stays the total of all three.
alter table public.users
  add column if not exists tinder_score numeric(8,1) not null default 0,
  add column if not exists fmk_score numeric(8,1) not null default 0,
  add column if not exists submitter_score numeric(8,1) not null default 0;

-- Re-stated from the Spookify migration, now guarding every score column.
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
        spookify_score = spookify_score + p_tinder + p_fmk + p_submitter
    where id = p_user;
  perform set_config('spookify.award', 'off', true);
end;
$$;
revoke all on function private.award_spookify(uuid, numeric, numeric, numeric) from public, anon, authenticated;

-- Rebuild every score from the stored swipes under the new rules; FMK scores start at zero.
update public.users u set
  tinder_score = coalesce((
    select sum(case w.direction when 'right' then 1 else 0.5 end)
    from public.spookify_swipes w where w.user_id = u.id
  ), 0),
  submitter_score = coalesce((
    select count(*) * 0.5
    from public.spookify_swipes w join public.spookify_songs s on s.id = w.song_id
    where s.added_by = u.id and w.direction = 'left'
  ), 0),
  fmk_score = 0;
update public.users set spookify_score = tinder_score + fmk_score + submitter_score;

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
  if p_direction = 'left' then
    perform private.award_spookify(submitter, 0, 0, 0.5);
  end if;
end;
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
end;
$$;
