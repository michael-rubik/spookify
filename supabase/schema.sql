create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  costume text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, costume, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'costume', ''),
    new.email
  )
  on conflict (id) do update
    set name = excluded.name,
        costume = excluded.costume,
        email = excluded.email;

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

create policy "Enable update for authenticated users based on id"
on public.users
for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and auth.email() = email
);
