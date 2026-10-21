-- Signup codes: creating an account requires a code with a free seat.
-- Seats are counted per redemption and are never freed, including when the user is deleted.
create table if not exists public.signup_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (btrim(code) <> ''),
  seats integer not null check (seats > 0),
  seats_used integer not null default 0 check (seats_used >= 0),
  created_at timestamptz not null default now(),
  constraint signup_codes_seats_not_exceeded check (seats_used <= seats)
);
create unique index if not exists signup_codes_code_key on public.signup_codes (lower(code));

alter table public.users
  add column if not exists signup_code_id uuid references public.signup_codes(id) on delete set null;

-- Redeems the code atomically with account creation; an invalid or full code aborts the signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_code_id uuid;
begin
  update public.signup_codes
    set seats_used = seats_used + 1
    where lower(code) = lower(btrim(coalesce(new.raw_user_meta_data ->> 'signup_code', '')))
      and seats_used < seats
    returning id into claimed_code_id;

  if claimed_code_id is null then
    raise exception 'Invalid or exhausted signup code';
  end if;

  insert into public.users (id, name, costume, email, avatar_url, badges, is_admin, click_count, signup_code_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'costume', ''),
    new.email,
    null,
    '{}'::text[],
    false,
    0,
    claimed_code_id
  )
  on conflict (id) do update
    set name = excluded.name,
        costume = excluded.costume,
        email = excluded.email,
        avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url),
        badges = coalesce(excluded.badges, public.users.badges, '{}'::text[]),
        is_admin = coalesce(public.users.is_admin, false),
        click_count = coalesce(public.users.click_count, 0),
        signup_code_id = coalesce(public.users.signup_code_id, excluded.signup_code_id);

  return new;
end;
$$;

-- Email confirmation is no longer used.
alter table public.users drop column if exists signup_email_status;

create or replace function private.guard_signup_codes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.code := btrim(new.code);
  if current_setting('role', true) in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.seats_used := 0;
    elsif new.id is distinct from old.id
      or new.code is distinct from old.code
      or new.seats_used is distinct from old.seats_used then
      raise exception 'Only the seat count of a signup code can be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_signup_codes() from public, anon, authenticated;
create or replace trigger guard_signup_codes before insert or update on public.signup_codes
for each row execute function private.guard_signup_codes();

alter table public.signup_codes enable row level security;

drop policy if exists "Active admins can read signup codes" on public.signup_codes;
create policy "Active admins can read signup codes"
on public.signup_codes for select to authenticated
using (public.account_is_active_admin());

drop policy if exists "Active admins can add signup codes" on public.signup_codes;
create policy "Active admins can add signup codes"
on public.signup_codes for insert to authenticated
with check (public.account_is_active_admin());

drop policy if exists "Active admins can change signup code seats" on public.signup_codes;
create policy "Active admins can change signup code seats"
on public.signup_codes for update to authenticated
using (public.account_is_active_admin())
with check (public.account_is_active_admin());

drop policy if exists "Active admins can remove signup codes" on public.signup_codes;
create policy "Active admins can remove signup codes"
on public.signup_codes for delete to authenticated
using (public.account_is_active_admin());
