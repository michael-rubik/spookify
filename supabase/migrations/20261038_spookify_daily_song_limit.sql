-- Daily cap on songs a user can add to the Spookify pool (rolling 24 hours), editable by admins.
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
  ) >= coalesce(public.daily_song_limit(), 10) then
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

revoke all on function public.daily_song_limit(), public.set_daily_song_limit(integer) from public, anon, authenticated;
grant execute on function public.daily_song_limit(), public.set_daily_song_limit(integer) to authenticated;
