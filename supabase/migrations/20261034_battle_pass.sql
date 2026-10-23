-- Battle pass: every badge is worth points (XP), editable by admins. A user's XP is never stored; it is the sum
-- of the current points of the badges they hold, so changing a value corrects everybody at once.
create table if not exists public.badge_points (
  badge_id text primary key,
  points integer not null check (points between 0 and 1000)
);
insert into public.badge_points (badge_id, points) values
  ('spooker', 100), ('karaoke', 100), ('voter', 100),
  ('clicker', 200), ('tagged', 200), ('swipes', 200), ('songmaster', 200),
  ('fan', 300), ('fmk', 300),
  ('winner-winner', 500)
on conflict (badge_id) do nothing;

-- One value per custom badge text; badges an admin gave before this existed start at 10.
create table if not exists public.custom_badge_points (
  label text primary key check (btrim(label) <> ''),
  points integer not null default 10 check (points between 0 and 1000)
);
insert into public.custom_badge_points (label)
select distinct btrim(substr(b, 8)) from public.users u, unnest(u.badges) b
where b like 'custom:%' and btrim(substr(b, 8)) <> ''
on conflict (label) do nothing;

alter table public.badge_points enable row level security;
alter table public.custom_badge_points enable row level security;
revoke all on public.badge_points, public.custom_badge_points from anon, authenticated;
grant select on public.badge_points, public.custom_badge_points to authenticated;
grant update on public.badge_points to authenticated;
grant insert, update, delete on public.custom_badge_points to authenticated;

drop policy if exists "Active users can read badge points" on public.badge_points;
create policy "Active users can read badge points"
on public.badge_points for select to authenticated
using (public.account_is_active());
drop policy if exists "Admins can edit badge points" on public.badge_points;
create policy "Admins can edit badge points"
on public.badge_points for update to authenticated
using (public.account_is_active_admin()) with check (public.account_is_active_admin());

drop policy if exists "Active users can read custom badge points" on public.custom_badge_points;
create policy "Active users can read custom badge points"
on public.custom_badge_points for select to authenticated
using (public.account_is_active());
drop policy if exists "Admins can insert custom badge points" on public.custom_badge_points;
create policy "Admins can insert custom badge points"
on public.custom_badge_points for insert to authenticated
with check (public.account_is_active_admin());
drop policy if exists "Admins can edit custom badge points" on public.custom_badge_points;
create policy "Admins can edit custom badge points"
on public.custom_badge_points for update to authenticated
using (public.account_is_active_admin()) with check (public.account_is_active_admin());
drop policy if exists "Admins can delete custom badge points" on public.custom_badge_points;
create policy "Admins can delete custom badge points"
on public.custom_badge_points for delete to authenticated
using (public.account_is_active_admin());

-- Every vote pays its winners a set amount of points, 10 unless the admin says otherwise.
alter table public.votes
  add column if not exists winner_points integer not null default 10 check (winner_points between 0 and 1000);

drop function if exists public.start_vote(text);
create or replace function public.start_vote(p_category text, p_winner_points integer default 10)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
  cleaned text := btrim(coalesce(p_category, ''));
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can start a vote' using errcode = '42501';
  end if;
  if cleaned = '' or char_length(cleaned) > 60 then
    raise exception 'The category must be 1 to 60 characters' using errcode = '22023';
  end if;
  if p_winner_points is null or p_winner_points not between 0 and 1000 then
    raise exception 'Winner points must be 0 to 1000' using errcode = '22023';
  end if;
  begin
    insert into public.votes (category, winner_points) values (cleaned, p_winner_points) returning id into new_id;
  exception when unique_violation then
    raise exception 'A vote is already open' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;

create or replace function public.set_vote_winner_points(p_vote_id uuid, p_points integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can change winner points' using errcode = '42501';
  end if;
  if p_points is null or p_points not between 0 and 1000 then
    raise exception 'Winner points must be 0 to 1000' using errcode = '22023';
  end if;
  update public.votes set winner_points = p_points where id = p_vote_id;
  if not found then
    raise exception 'Vote not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Current value of every regular badge's goal for one user.
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
$$;
revoke all on function private.badge_progress(uuid) from public, anon, authenticated;

-- Awards the caller every regular badge whose goal is reached (add-only), then Winner winner once they hold all
-- nine, and returns the progress the battle pass shows.
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

  update public.users u
  set badges = u.badges || array(select e from unnest(earned) e where not (e = any(u.badges)))
  where u.id = me and exists (select 1 from unnest(earned) e where not (e = any(u.badges)));

  update public.users u
  set badges = array_append(u.badges, 'winner-winner')
  where u.id = me
    and not ('winner-winner' = any(u.badges))
    and regular <@ u.badges;

  return query select p.badge_id, p.progress from private.badge_progress(me) p;
end;
$$;

revoke all on function public.start_vote(text, integer), public.set_vote_winner_points(uuid, integer),
  public.my_badge_progress() from public, anon, authenticated;
grant execute on function public.start_vote(text, integer), public.set_vote_winner_points(uuid, integer),
  public.my_badge_progress() to authenticated;
