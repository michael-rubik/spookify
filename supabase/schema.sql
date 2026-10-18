create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  costume text not null,
  email text not null unique,
  avatar_url text,
  badges text[] not null default '{}',
  is_admin boolean not null default false,
  click_count integer not null default 0,
  signup_email_status text not null default 'not_sent' check (signup_email_status in ('not_sent', 'pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Public avatars are viewable by everyone"
on storage.objects
for select
to public
using (bucket_id = 'avatars');

create policy "Authenticated users may upload avatars"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
);

create policy "Authenticated users may update their own avatars"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and owner = auth.uid()
)
with check (
  bucket_id = 'avatars'
  and owner = auth.uid()
);

create policy "Authenticated users may delete avatars"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and owner = auth.uid()
);

alter table public.users enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, costume, email, avatar_url, badges, is_admin, click_count, signup_email_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'costume', ''),
    new.email,
    null,
    '{}'::text[],
    false,
    0,
    'not_sent'
  )
  on conflict (id) do update
    set name = excluded.name,
        costume = excluded.costume,
        email = excluded.email,
        avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url),
        badges = coalesce(excluded.badges, public.users.badges, '{}'::text[]),
        is_admin = coalesce(public.users.is_admin, false),
        click_count = coalesce(public.users.click_count, 0),
        signup_email_status = coalesce(public.users.signup_email_status, 'not_sent');

  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "Enable insert for authenticated users only"
on public.users
for insert
to authenticated, dashboard_user
with check (
  auth.uid() = id
  and auth.email() = email
);

create policy "Enable read access for all users"
on public.users
for select
to public
using (true);

create policy "Enable update for authenticated users based on id or admin role"
on public.users
for update
to authenticated
using (
  auth.uid() = id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
)
with check (
  auth.uid() = id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

create policy "Enable delete for admin users"
on public.users
for delete
to authenticated
using (
  exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

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

create table if not exists public.spooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  caption text not null default '',
  image_url text not null,
  tagged_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.spooks enable row level security;

insert into storage.buckets (id, name, public)
values ('spooks', 'spooks', true)
on conflict (id) do nothing;

create policy "Public spook images are viewable by everyone"
on storage.objects
for select
to public
using (bucket_id = 'spooks');

create policy "Authenticated users may upload spook images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'spooks'
  and auth.uid() is not null
);

create policy "Authenticated users may update their own spook images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'spooks'
  and owner = auth.uid()
)
with check (
  bucket_id = 'spooks'
  and owner = auth.uid()
);

create policy "Authenticated users may delete their own spook images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'spooks'
  and owner = auth.uid()
);

create policy "Public spooks are readable"
on public.spooks
for select
to public
using (true);

create policy "Users can insert their own spooks"
on public.spooks
for insert
to authenticated
with check (
  auth.uid() = user_id
  and char_length(caption) > 0
  and image_url is not null
);

create policy "Users can update their own spooks"
on public.spooks
for update
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);

create policy "Users can delete their own spooks"
on public.spooks
for delete
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.users as admin_user
    where admin_user.id = auth.uid()
      and admin_user.is_admin = true
  )
);
