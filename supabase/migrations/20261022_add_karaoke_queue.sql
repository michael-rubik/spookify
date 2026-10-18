create table if not exists public.karaoke_queue (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null default 'Unknown artist',
  queued_by uuid not null references public.users(id) on delete cascade,
  duration_seconds integer not null default 300,
  status text not null default 'queued' check (status in ('queued', 'playing', 'completed', 'skipped')),
  started_at timestamptz,
  ends_at timestamptz,
  skipped_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.karaoke_queue enable row level security;

create policy "Public karaoke queue is readable"
on public.karaoke_queue
for select
to public
using (true);

create policy "Authenticated users can add songs to the karaoke queue"
on public.karaoke_queue
for insert
to authenticated
with check (
  auth.uid() = queued_by
  and char_length(title) > 0
  and duration_seconds > 0
);

create policy "Users can update their own queued songs or admins can manage the queue"
on public.karaoke_queue
for update
to authenticated
using (
  auth.uid() = queued_by
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
)
with check (
  auth.uid() = queued_by
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

create policy "Admins can delete songs from the karaoke queue"
on public.karaoke_queue
for delete
to authenticated
using (
  exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

create or replace function public.touch_karaoke_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger karaoke_queue_updated_at
before update on public.karaoke_queue
for each row
execute function public.touch_karaoke_queue_updated_at();
