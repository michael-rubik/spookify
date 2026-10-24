-- Admins can turn karaoke off and on. While it is off the view is hidden and nobody can add songs to the queue.
insert into public.app_settings (key, int_value) values ('karaoke_enabled', 1)
on conflict (key) do nothing;

create or replace function public.karaoke_enabled()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select int_value <> 0 from public.app_settings where key = 'karaoke_enabled'), true)
$$;

create or replace function public.set_karaoke_enabled(p_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.current_account_active(true) then
    raise exception 'Only admins can turn karaoke on or off' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Choose enabled or disabled' using errcode = '22023';
  end if;
  insert into public.app_settings (key, int_value) values ('karaoke_enabled', case when p_enabled then 1 else 0 end)
  on conflict (key) do update set int_value = excluded.int_value;
end;
$$;

revoke all on function public.karaoke_enabled(), public.set_karaoke_enabled(boolean) from public, anon, authenticated;
grant execute on function public.karaoke_enabled(), public.set_karaoke_enabled(boolean) to authenticated;

drop policy if exists "Authenticated users can add songs to the karaoke queue" on public.karaoke_queue;
create policy "Authenticated users can add songs to the karaoke queue"
on public.karaoke_queue
for insert
to authenticated
with check (
  auth.uid() = queued_by
  and char_length(title) > 0
  and duration_seconds > 0
  and public.karaoke_enabled()
);
