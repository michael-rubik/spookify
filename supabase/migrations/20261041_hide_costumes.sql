-- Admins can hide every costume with one switch: while hidden, a costume is only visible to its owner.
-- The column is no longer readable straight from public.users; clients read it through visible_costumes().

insert into public.app_settings (key, int_value) values ('costumes_hidden', 0)
on conflict (key) do nothing;

-- Readable before sign in, so the signup form can tell people whether their costume will be shown.
create or replace function public.costumes_hidden()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select int_value <> 0 from public.app_settings where key = 'costumes_hidden'), false)
$$;

create or replace function public.set_costumes_hidden(p_hidden boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can hide costumes' using errcode = '42501';
  end if;
  if p_hidden is null then
    raise exception 'Choose hidden or visible' using errcode = '22023';
  end if;
  insert into public.app_settings (key, int_value) values ('costumes_hidden', case when p_hidden then 1 else 0 end)
  on conflict (key) do update set int_value = excluded.int_value;
end;
$$;

-- Everyone's costume while costumes are shown, otherwise only the caller's own.
create or replace function public.visible_costumes()
returns table (id uuid, costume text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.costume
  from public.users u
  where private.current_account_active(false)
    and (not public.costumes_hidden() or u.id = auth.uid())
$$;

revoke all on function public.costumes_hidden(), public.set_costumes_hidden(boolean), public.visible_costumes()
  from public, anon, authenticated;
grant execute on function public.costumes_hidden() to anon, authenticated;
grant execute on function public.set_costumes_hidden(boolean), public.visible_costumes() to authenticated;

-- Every column except costume stays readable; later columns need an explicit grant.
revoke select on public.users from anon, authenticated;
do $$
declare
  readable text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into readable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'users' and column_name <> 'costume';
  execute format('grant select (%s) on public.users to authenticated', readable);
end;
$$;
