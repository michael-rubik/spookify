-- Queue timing is maintained in the database, not by a viewer's RLS-limited updates.
drop policy "Admins can delete songs from the karaoke queue" on public.karaoke_queue;
create policy "Owners and admins can delete songs from the karaoke queue"
on public.karaoke_queue for delete to authenticated
using (
  (select auth.uid()) = queued_by
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = (select auth.uid()) and admin_user.is_admin = true
  )
);

create schema if not exists private;
revoke all on schema private from public;

-- Definer privileges are needed only inside this trigger to move other owners' songs.
create or replace function private.schedule_karaoke_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  song record;
  schedule_now timestamptz;
  cursor_at timestamptz;
  start_at timestamptz;
  end_at timestamptz;
  next_status text;
begin
  if current_setting('role', true) in ('anon', 'authenticated') and auth.uid() is null then
    raise exception 'Authentication required for queue changes' using errcode = '42501';
  end if;

  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_when = 'BEFORE' then
    -- Lock before any row locks, including when the queue is empty.
    perform pg_advisory_xact_lock(20261024, 1);
    return null;
  end if;

  schedule_now := clock_timestamp();
  cursor_at := schedule_now;
  for song in
    select * from public.karaoke_queue
    where status in ('queued', 'playing')
    order by created_at, id
  loop
    if song.ends_at is not null and song.ends_at <= schedule_now then
      update public.karaoke_queue set status = 'completed' where id = song.id;
      continue;
    end if;

    if cursor_at = schedule_now and song.started_at <= schedule_now then
      start_at := song.started_at;
    else
      start_at := cursor_at;
    end if;
    end_at := start_at + make_interval(secs => greatest(1, song.duration_seconds));
    next_status := case
      when end_at <= schedule_now then 'completed'
      when start_at <= schedule_now then 'playing'
      else 'queued'
    end;
    cursor_at := greatest(schedule_now, end_at);

    update public.karaoke_queue
    set status = next_status, started_at = start_at, ends_at = end_at
    where id = song.id
      and (status, started_at, ends_at) is distinct from (next_status, start_at, end_at);
  end loop;
  return null;
end;
$$;

revoke all on function private.schedule_karaoke_queue() from public, anon, authenticated;

create trigger karaoke_queue_lock
before insert or update or delete on public.karaoke_queue
for each statement execute function private.schedule_karaoke_queue();

create trigger karaoke_queue_schedule
after insert or update or delete on public.karaoke_queue
for each statement execute function private.schedule_karaoke_queue();

-- Repair existing live entries without modifying archived timestamps.
update public.karaoke_queue set updated_at = now() where status in ('queued', 'playing');