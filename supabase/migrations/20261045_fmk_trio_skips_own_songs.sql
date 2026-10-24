-- Spookify FMK: a user keeps the trio they were dealt until they lock it in or skip it (skips are a daily
-- milestone reward), and may now be dealt their own songs, which earn only half the points when voted on.

-- A quarter point (listening to your own song) needs two decimals.
alter table public.users
  alter column spookify_score type numeric(8,2),
  alter column tinder_score type numeric(8,2),
  alter column fmk_score type numeric(8,2),
  alter column submitter_score type numeric(8,2);
alter table public.spookify_songs alter column points type numeric(8,2);

alter table public.battle_pass_levels
  add column if not exists fmk_skips integer not null default 0 check (fmk_skips between 0 and 100);

-- The trio a user is currently dealt, in display order. Removing any of its songs removes the row, so a new
-- trio is dealt (this also covers deleted accounts and the Spookify reset).
create table if not exists public.spookify_fmk_trios (
  user_id uuid primary key references public.users(id) on delete cascade,
  song_1 uuid not null references public.spookify_songs(id) on delete cascade,
  song_2 uuid not null references public.spookify_songs(id) on delete cascade,
  song_3 uuid not null references public.spookify_songs(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists spookify_fmk_trios_song_2_idx on public.spookify_fmk_trios (song_2);
create index if not exists spookify_fmk_trios_song_3_idx on public.spookify_fmk_trios (song_3);

create table if not exists public.spookify_fmk_skips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  skipped_at timestamptz not null default now()
);
create index if not exists spookify_fmk_skips_user_idx on public.spookify_fmk_skips (user_id, skipped_at);

alter table public.spookify_fmk_trios enable row level security;
alter table public.spookify_fmk_skips enable row level security;
revoke all on public.spookify_fmk_trios, public.spookify_fmk_skips from anon, authenticated;

-- Three shuffled songs from the lowest tier that still has a trio never matched before, skipping the
-- songs the user deleted and any trio equal to p_exclude. Null when no such trio exists.
create or replace function private.draw_fmk_trio(p_user uuid, p_exclude uuid[])
returns uuid[]
language sql security definer set search_path = ''
as $$
  with candidates as (
    select s.id, coalesce(t.points, 0) as tier
    from public.spookify_songs s
    left join public.spookify_fmk_tiers t on t.song_id = s.id and t.user_id = p_user
    where not coalesce(t.deleted, false)
  ),
  trio as (
    select a.id as a_id, b.id as b_id, c.id as c_id, a.tier
    from candidates a
    join candidates b on b.tier = a.tier and b.id > a.id
    join candidates c on c.tier = a.tier and c.id > b.id
    where not exists (
      select 1 from public.spookify_fmk_pairs p
      where p.user_id = p_user
        and ((p.song_a = a.id and p.song_b = b.id)
          or (p.song_a = a.id and p.song_b = c.id)
          or (p.song_a = b.id and p.song_b = c.id))
    )
      and (p_exclude is null or array[a.id, b.id, c.id] <> p_exclude)
    order by a.tier, random()
    limit 1
  )
  select array(select x from unnest(array[trio.a_id, trio.b_id, trio.c_id]) x order by random())
  from trio
$$;

create or replace function private.fmk_skip_limit(p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(fmk_skips), 0)::integer
  from public.battle_pass_levels
  where xp_required <= private.user_xp(p_user)
$$;

revoke all on function private.draw_fmk_trio(uuid, uuid[]), private.fmk_skip_limit(uuid) from public, anon, authenticated;

-- The caller's current trio, dealt on first use and kept until it is locked in or skipped.
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
    select s.id, s.spotify_track_id, s.title, s.artist, s.album_art_url, s.spotify_url, s.added_by,
      coalesce((select t.points from public.spookify_fmk_tiers t where t.user_id = me and t.song_id = s.id), 0)
    from public.spookify_fmk_trios f
    cross join lateral unnest(array[f.song_1, f.song_2, f.song_3]) with ordinality as u(song_id, pos)
    join public.spookify_songs s on s.id = u.song_id
    where f.user_id = me
    order by u.pos;
end;
$$;

create or replace function public.my_fmk_skips()
returns table(skips_left integer, skips_total integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  total integer;
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  total := private.fmk_skip_limit(me);
  return query select
    greatest(0, total - (select count(*) from public.spookify_fmk_skips k
      where k.user_id = me and k.skipped_at >= private.limit_day_start())::integer),
    total;
end;
$$;

-- Swaps the current trio for another one, which costs one of today's skips.
create or replace function public.skip_spookify_fmk()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  current_trio public.spookify_fmk_trios;
  drawn uuid[];
begin
  if me is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  select * into current_trio from public.spookify_fmk_trios where user_id = me for update;
  if not found then
    raise exception 'You have no trio to skip' using errcode = 'P0001';
  end if;
  if private.fmk_skip_limit(me) - (
    select count(*) from public.spookify_fmk_skips k where k.user_id = me and k.skipped_at >= private.limit_day_start()
  ) <= 0 then
    raise exception 'No skips left today' using errcode = 'P0001';
  end if;

  drawn := private.draw_fmk_trio(
    me,
    (select array_agg(x order by x) from unnest(array[current_trio.song_1, current_trio.song_2, current_trio.song_3]) x)
  );
  if drawn is null then
    raise exception 'There is no other trio to skip to' using errcode = 'P0001';
  end if;

  update public.spookify_fmk_trios
  set song_1 = drawn[1], song_2 = drawn[2], song_3 = drawn[3], created_at = now()
  where user_id = me;
  insert into public.spookify_fmk_skips (user_id) values (me);
end;
$$;

-- Only the dealt trio can be locked in. Voting on your own song keeps its tier gain but pays half the
-- song and submitter points.
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

revoke all on function public.next_spookify_fmk(), public.my_fmk_skips(), public.skip_spookify_fmk(),
  public.submit_spookify_fmk(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.next_spookify_fmk(), public.my_fmk_skips(), public.skip_spookify_fmk(),
  public.submit_spookify_fmk(uuid, uuid, uuid) to authenticated;
