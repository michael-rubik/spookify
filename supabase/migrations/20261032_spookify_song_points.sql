-- Submitters earn from other users' plays of their songs, and each song keeps the points it earned
-- for its submitter so the song leaderboard can rank songs: right swipe +1, sing +1, listen +0.5.
-- A left swipe no longer pays the submitter.
alter table public.spookify_songs
  add column if not exists points numeric(8,1) not null default 0;

create or replace function private.award_song(p_song uuid, p_points numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.spookify_songs set points = points + p_points where id = p_song;
end;
$$;
revoke all on function private.award_song(uuid, numeric) from public, anon, authenticated;

-- Rebuild song and submitter points from stored swipes and FMK tiers (sing is 2 tier points, listen 1).
update public.spookify_songs s set points =
  coalesce((select count(*) from public.spookify_swipes w where w.song_id = s.id and w.direction = 'right'), 0)
  + coalesce((select sum(t.points) * 0.5 from public.spookify_fmk_tiers t where t.song_id = s.id), 0);
update public.users u set
  submitter_score = coalesce((select sum(s.points) from public.spookify_songs s where s.added_by = u.id), 0);
update public.users set spookify_score = tinder_score + fmk_score + submitter_score;

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
