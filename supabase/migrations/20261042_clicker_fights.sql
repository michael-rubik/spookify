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
