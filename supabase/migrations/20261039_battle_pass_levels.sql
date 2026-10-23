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
