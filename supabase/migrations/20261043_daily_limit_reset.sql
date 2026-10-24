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
