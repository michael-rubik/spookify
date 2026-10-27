-- Dealing a trio no longer searches every same-tier triple (O(n^3)) for one never matched before: it samples
-- three random songs from the lowest tier that has at least three, retrying a few times to avoid p_exclude.
create or replace function private.draw_fmk_trio(p_user uuid, p_exclude uuid[])
returns uuid[]
language plpgsql security definer set search_path = ''
as $$
declare
  lowest_tier integer;
  drawn uuid[];
begin
  select c.tier into lowest_tier
  from (
    select coalesce(t.points, 0) as tier
    from public.spookify_songs s
    left join public.spookify_fmk_tiers t on t.song_id = s.id and t.user_id = p_user
    where not coalesce(t.deleted, false)
  ) c
  group by c.tier
  having count(*) >= 3
  order by c.tier
  limit 1;

  if lowest_tier is null then
    return null;
  end if;

  for attempt in 1..5 loop
    select array_agg(x.id) into drawn
    from (
      select s.id
      from public.spookify_songs s
      left join public.spookify_fmk_tiers t on t.song_id = s.id and t.user_id = p_user
      where not coalesce(t.deleted, false) and coalesce(t.points, 0) = lowest_tier
      order by random()
      limit 3
    ) x;

    if p_exclude is null or (select array_agg(y order by y) from unnest(drawn) y) <> p_exclude then
      return drawn;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function private.draw_fmk_trio(uuid, uuid[]) from public, anon, authenticated;
