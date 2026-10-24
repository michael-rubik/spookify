-- Restores Fan favourite to the best single song (undoes 20261049_fan_badge_total_likes.sql).
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
