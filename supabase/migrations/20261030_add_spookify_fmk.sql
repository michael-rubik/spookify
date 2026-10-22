-- Spookify FMK: three pool songs of the same tier get a different choice each (sing, listen, delete).
-- A song's tier is the points one user has given it; it is per user and never shared. Like swipes, FMK
-- rounds are written only through the functions below, so a client cannot set its own tiers or score.
create table if not exists public.spookify_fmk_tiers (
  user_id uuid not null references public.users(id) on delete cascade,
  song_id uuid not null references public.spookify_songs(id) on delete cascade,
  points integer not null default 0 check (points >= 0),
  deleted boolean not null default false,
  primary key (user_id, song_id)
);

-- Songs that already shared an FMK for a user; song_a < song_b keeps each pair stored once.
create table if not exists public.spookify_fmk_pairs (
  user_id uuid not null references public.users(id) on delete cascade,
  song_a uuid not null references public.spookify_songs(id) on delete cascade,
  song_b uuid not null references public.spookify_songs(id) on delete cascade,
  primary key (user_id, song_a, song_b),
  check (song_a < song_b)
);
create index if not exists spookify_fmk_tiers_song_idx on public.spookify_fmk_tiers (song_id);
create index if not exists spookify_fmk_pairs_song_b_idx on public.spookify_fmk_pairs (song_b);

alter table public.spookify_fmk_tiers enable row level security;
alter table public.spookify_fmk_pairs enable row level security;

revoke all on public.spookify_fmk_tiers, public.spookify_fmk_pairs from anon, authenticated;
grant select on public.spookify_fmk_tiers, public.spookify_fmk_pairs to authenticated;

drop policy if exists "Users can see only their own FMK tiers" on public.spookify_fmk_tiers;
create policy "Users can see only their own FMK tiers"
on public.spookify_fmk_tiers for select to authenticated
using (public.account_is_active() and user_id = auth.uid());

drop policy if exists "Users can see only their own FMK pairs" on public.spookify_fmk_pairs;
create policy "Users can see only their own FMK pairs"
on public.spookify_fmk_pairs for select to authenticated
using (public.account_is_active() and user_id = auth.uid());

-- Three songs from the lowest tier that still has a trio never matched before; none of them is the caller's own.
create or replace function public.next_spookify_fmk()
returns table(
  id uuid,
  spotify_track_id text,
  title text,
  artist text,
  album_art_url text,
  spotify_url text,
  added_by uuid,
  tier integer
)
language sql security definer set search_path = ''
as $$
  with candidates as (
    select s.id, coalesce(t.points, 0) as tier
    from public.spookify_songs s
    left join public.spookify_fmk_tiers t on t.song_id = s.id and t.user_id = auth.uid()
    where private.current_account_active(false)
      and s.added_by <> auth.uid()
      and not coalesce(t.deleted, false)
  ),
  trio as (
    select a.id as a_id, b.id as b_id, c.id as c_id, a.tier
    from candidates a
    join candidates b on b.tier = a.tier and b.id > a.id
    join candidates c on c.tier = a.tier and c.id > b.id
    where not exists (
      select 1 from public.spookify_fmk_pairs p
      where p.user_id = auth.uid()
        and ((p.song_a = a.id and p.song_b = b.id)
          or (p.song_a = a.id and p.song_b = c.id)
          or (p.song_a = b.id and p.song_b = c.id))
    )
    order by a.tier, random()
    limit 1
  )
  select s.id, s.spotify_track_id, s.title, s.artist, s.album_art_url, s.spotify_url, s.added_by, trio.tier
  from trio
  join public.spookify_songs s on s.id in (trio.a_id, trio.b_id, trio.c_id)
  order by random()
$$;

-- The highest tier any of the caller's songs has reached, deleted songs included.
create or replace function public.spookify_fmk_max_tier()
returns integer
language sql security definer set search_path = ''
as $$
  select coalesce(max(points), 0)
  from public.spookify_fmk_tiers
  where user_id = auth.uid() and private.current_account_active(false)
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

  perform set_config('spookify.award', 'on', true);
  update public.users set spookify_score = spookify_score + 3.1 where id = chooser;
  perform set_config('spookify.award', 'off', true);
end;
$$;

revoke all on function public.next_spookify_fmk(), public.spookify_fmk_max_tier(),
  public.submit_spookify_fmk(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.next_spookify_fmk(), public.spookify_fmk_max_tier(),
  public.submit_spookify_fmk(uuid, uuid, uuid) to authenticated;
