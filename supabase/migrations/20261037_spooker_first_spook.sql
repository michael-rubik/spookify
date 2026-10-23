-- The spooker badge is awarded for the first spook instead of the tenth.
-- Everyone who has already posted a spook receives it on their next badge check.

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
    ('clicker', 500), ('songmaster', 100), ('spooker', 1), ('tagged', 10), ('fan', 10),
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

revoke all on function public.my_badge_progress() from public, anon, authenticated;
grant execute on function public.my_badge_progress() to authenticated;
