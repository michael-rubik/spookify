-- Every user has a distinct costume (ignoring case and surrounding spaces), so a costume identifies one person in votes.
-- Existing duplicates are left alone; only new or changed costumes are checked.

create or replace function private.guard_unique_costume()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  key text := lower(btrim(coalesce(new.costume, '')));
begin
  if key = '' then return new; end if;
  if tg_op = 'UPDATE' and key = lower(btrim(coalesce(old.costume, ''))) then return new; end if;

  perform pg_advisory_xact_lock(hashtext('costume:' || key));
  if exists (
    select 1 from public.users u where u.id <> new.id and lower(btrim(u.costume)) = key
  ) then
    raise exception 'Costume already taken' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_unique_costume() from public, anon, authenticated;

drop trigger if exists guard_unique_costume on public.users;
create trigger guard_unique_costume before insert or update of costume on public.users
for each row execute function private.guard_unique_costume();

-- Lets the signup form warn before an account is created; the caller's own costume counts as available.
create or replace function public.costume_available(p_costume text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.users u
    where lower(btrim(u.costume)) = lower(btrim(coalesce(p_costume, '')))
      and btrim(coalesce(p_costume, '')) <> ''
      and u.id is distinct from auth.uid()
  )
$$;
revoke all on function public.costume_available(text) from public, anon, authenticated;
grant execute on function public.costume_available(text) to anon, authenticated;
