-- Spookify FMK without tiers: any three songs the user has not deleted are dealt together, at random. A deleted
-- song leaves that user's pool for good, so a matched trio can never come back and no pair history is needed.
-- Points are counted per song (spookify_songs.points) as before, and the trio shows them.

create table if not exists public.spookify_fmk_deleted (
  user_id uuid not null references public.users(id) on delete cascade,
  song_id uuid not null references public.spookify_songs(id) on delete cascade,
  primary key (user_id, song_id)
);
create index if not exists spookify_fmk_deleted_song_idx on public.spookify_fmk_deleted (song_id);
alter table public.spookify_fmk_deleted enable row level security;
revoke all on public.spookify_fmk_deleted from anon, authenticated;

insert into public.spookify_fmk_deleted (user_id, song_id)
select user_id, song_id from public.spookify_fmk_tiers where deleted
on conflict do nothing;

create or replace function private.draw_fmk_trio(p_user uuid, p_exclude uuid[])
returns uuid[]
language plpgsql security definer set search_path = ''
as $$
declare
  drawn uuid[];
begin
  for attempt in 1..5 loop
    select array_agg(x.id) into drawn
    from (
      select s.id
      from public.spookify_songs s
      where not exists (
        select 1 from public.spookify_fmk_deleted d where d.user_id = p_user and d.song_id = s.id
      )
      order by random()
      limit 3
    ) x;

    if coalesce(cardinality(drawn), 0) < 3 then
      return null;
    end if;
    if p_exclude is null or (select array_agg(y order by y) from unnest(drawn) y) <> p_exclude then
      return drawn;
    end if;
  end loop;

  return null;
end;
$$;
revoke all on function private.draw_fmk_trio(uuid, uuid[]) from public, anon, authenticated;

drop function if exists public.spookify_fmk_max_tier();
drop function if exists public.next_spookify_fmk();

-- The caller's current trio, dealt on first use and kept until it is locked in or skipped. Each song carries
-- the points it has collected so far.
create function public.next_spookify_fmk()
returns table(
  id uuid,
  spotify_track_id text,
  title text,
  artist text,
  album_art_url text,
  spotify_url text,
  added_by uuid,
  points numeric
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
    select s.id, s.spotify_track_id, s.title, s.artist, s.album_art_url, s.spotify_url, s.added_by, s.points
    from public.spookify_fmk_trios f
    cross join lateral unnest(array[f.song_1, f.song_2, f.song_3]) with ordinality as u(song_id, pos)
    join public.spookify_songs s on s.id = u.song_id
    where f.user_id = me
    order by u.pos;
end;
$$;

-- Only the dealt trio can be locked in. Voting on your own song pays half the song and submitter points.
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

  insert into public.spookify_fmk_deleted (user_id, song_id) values (chooser, p_delete)
    on conflict do nothing;

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

revoke all on function public.next_spookify_fmk(), public.submit_spookify_fmk(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.next_spookify_fmk(), public.submit_spookify_fmk(uuid, uuid, uuid) to authenticated;

-- Every locked-in round deletes exactly one song, so the rounds played are the deleted songs.
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
  union all select 'fmk', (select count(*) from public.spookify_fmk_deleted where user_id = p_user)::numeric
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

drop table if exists public.spookify_fmk_pairs;
drop table if exists public.spookify_fmk_tiers;
