create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  costume text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Enable insert for authenticated users only"
on public.users
for insert
to authenticated, dashboard_user
with check (auth.uid() = id);

create policy "Enable read access for all users"
on public.users
for select
to public
using (true);

create policy "Enable update for users based on email"
on public.users
for update
to public
using (auth.email() = email)
with check (auth.email() = email);
