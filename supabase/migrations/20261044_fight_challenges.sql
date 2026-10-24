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
