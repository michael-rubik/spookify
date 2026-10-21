-- Votes: an admin opens a named vote, every active user casts one anonymous ballot, an admin ends it.
-- Ballots are anonymous by construction: participation (who voted) and tallies (what was chosen) are unlinked.
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  category text not null check (btrim(category) <> '' and char_length(category) <= 60),
  status text not null default 'open' check (status in ('open', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists votes_single_open_idx on public.votes ((status)) where status = 'open';

create table if not exists public.vote_participation (
  vote_id uuid not null references public.votes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (vote_id, user_id)
);

create table if not exists public.vote_tallies (
  vote_id uuid not null references public.votes(id) on delete cascade,
  candidate_id uuid not null references public.users(id) on delete cascade,
  ballots integer not null check (ballots > 0),
  primary key (vote_id, candidate_id)
);

create table if not exists public.vote_winners (
  vote_id uuid not null references public.votes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (vote_id, user_id)
);

alter table public.votes enable row level security;
alter table public.vote_participation enable row level security;
alter table public.vote_tallies enable row level security;
alter table public.vote_winners enable row level security;

-- Writes only happen through the security definer functions below.
revoke all on public.votes, public.vote_participation, public.vote_tallies, public.vote_winners from anon, authenticated;
grant select on public.votes, public.vote_participation, public.vote_tallies, public.vote_winners to authenticated;

drop policy if exists "Active users can read votes" on public.votes;
create policy "Active users can read votes"
on public.votes for select to authenticated
using (public.account_is_active());

drop policy if exists "Users can see only their own participation" on public.vote_participation;
create policy "Users can see only their own participation"
on public.vote_participation for select to authenticated
using (public.account_is_active() and user_id = auth.uid());

-- Tallies stay hidden until the vote has ended.
drop policy if exists "Tallies of ended votes are readable" on public.vote_tallies;
create policy "Tallies of ended votes are readable"
on public.vote_tallies for select to authenticated
using (
  public.account_is_active()
  and exists (select 1 from public.votes v where v.id = vote_tallies.vote_id and v.status = 'ended')
);

drop policy if exists "Active users can read winners" on public.vote_winners;
create policy "Active users can read winners"
on public.vote_winners for select to authenticated
using (public.account_is_active());

create or replace function public.start_vote(p_category text)
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
  begin
    insert into public.votes (category) values (cleaned) returning id into new_id;
  exception when unique_violation then
    raise exception 'A vote is already open' using errcode = 'P0001';
  end;
  return new_id;
end;
$$;

create or replace function public.cast_ballot(p_vote_id uuid, p_candidate_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  voter uuid := auth.uid();
begin
  if voter is null or not private.current_account_active(false) then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  perform 1 from public.votes where id = p_vote_id and status = 'open' for share;
  if not found then
    raise exception 'This vote is not open' using errcode = 'P0001';
  end if;
  if p_candidate_id = voter then
    raise exception 'You cannot vote for yourself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users where id = p_candidate_id and deletion_pending_at is null) then
    raise exception 'Unknown candidate' using errcode = 'P0001';
  end if;
  begin
    insert into public.vote_participation (vote_id, user_id) values (p_vote_id, voter);
  exception when unique_violation then
    raise exception 'You have already voted' using errcode = 'P0001';
  end;
  insert into public.vote_tallies (vote_id, candidate_id, ballots) values (p_vote_id, p_candidate_id, 1)
  on conflict (vote_id, candidate_id) do update set ballots = public.vote_tallies.ballots + 1;
end;
$$;

create or replace function public.vote_progress(p_vote_id uuid)
returns table(voted integer, eligible integer)
language sql security definer set search_path = ''
as $$
  select
    (select count(*)::integer from public.vote_participation where vote_id = p_vote_id),
    (select count(*)::integer from public.users where deletion_pending_at is null)
  where private.current_account_active(false)
$$;

create or replace function public.end_vote(p_vote_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can end a vote' using errcode = '42501';
  end if;
  perform 1 from public.votes where id = p_vote_id and status = 'open' for update;
  if not found then
    raise exception 'This vote is not open' using errcode = 'P0001';
  end if;
  update public.votes set status = 'ended', ended_at = now() where id = p_vote_id;
  insert into public.vote_winners (vote_id, user_id)
  select vote_id, candidate_id from public.vote_tallies
  where vote_id = p_vote_id
    and ballots = (select max(ballots) from public.vote_tallies where vote_id = p_vote_id);
  -- Rewriting every tally in one transaction stops a row's transaction id from pointing at a single voter.
  update public.vote_tallies set ballots = ballots where vote_id = p_vote_id;
end;
$$;

-- Resets an open vote or deletes an ended one; participation, tallies and winners cascade away.
create or replace function public.delete_vote(p_vote_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can delete a vote' using errcode = '42501';
  end if;
  delete from public.votes where id = p_vote_id;
  if not found then
    raise exception 'Vote not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.start_vote(text), public.cast_ballot(uuid, uuid), public.vote_progress(uuid),
  public.end_vote(uuid), public.delete_vote(uuid) from public, anon, authenticated;
grant execute on function public.start_vote(text), public.cast_ballot(uuid, uuid), public.vote_progress(uuid),
  public.end_vote(uuid), public.delete_vote(uuid) to authenticated;
