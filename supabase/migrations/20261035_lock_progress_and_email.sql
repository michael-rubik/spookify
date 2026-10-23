-- Badges, click counts and emails can no longer be edited by the user they belong to.
-- Badges are awarded by the server, clicks are registered through register_clicks(), and only admins edit the rest.

alter table public.users add column if not exists clicks_flushed_at timestamptz;

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
    if (new.spookify_score, new.tinder_score, new.fmk_score, new.submitter_score)
      is distinct from (old.spookify_score, old.tinder_score, old.fmk_score, old.submitter_score)
      and coalesce(current_setting('spookify.award', true), '') <> 'on' then
      raise exception 'Spookify score is awarded by the server' using errcode = '42501';
    end if;
    if (new.badges, new.click_count, new.clicks_flushed_at)
      is distinct from (old.badges, old.click_count, old.clicks_flushed_at)
      and coalesce(current_setting('spookify.award', true), '') <> 'on'
      and not private.current_account_active(true) then
      raise exception 'Badges and clicks are awarded by the server' using errcode = '42501';
    end if;
    if new.email is distinct from old.email and not private.current_account_active(true) then
      raise exception 'Only admins can change an email' using errcode = '42501';
    end if;
  elsif new.deletion_pending_at is not null or new.is_admin
    or new.spookify_score <> 0 or new.tinder_score <> 0 or new.fmk_score <> 0 or new.submitter_score <> 0
    or new.badges <> '{}'::text[] or new.click_count <> 0 then
    raise exception 'New accounts must be active non-admins' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_changes() from public, anon, authenticated;

-- Adds a batch of clicks for the caller. The batch is capped at 20 clicks per second since the previous batch
-- (at least 20, at most 200 per call), and the clicker badge is awarded by my_badge_progress().
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

  return current_count + granted;
end;
$$;

create or replace function public.my_badge_progress()
returns table(badge_id text, progress numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  earned text[];
  regular text[] := array['clicker', 'songmaster', 'spooker', 'tagged', 'fan', 'karaoke', 'swipes', 'fmk', 'voter'];
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  select coalesce(array_agg(p.badge_id), '{}'::text[]) into earned
  from private.badge_progress(me) p
  join (values
    ('clicker', 500), ('songmaster', 100), ('spooker', 10), ('tagged', 10), ('fan', 10),
    ('karaoke', 3), ('swipes', 50), ('fmk', 25), ('voter', 1)
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
