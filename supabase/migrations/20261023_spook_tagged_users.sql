-- Spooks: 1 creator x 1 spook x n tagged users.
-- Replaces the single spooks.tagged_user_id column with a join table.

create table if not exists public.spook_tagged_users (
  spook_id uuid not null references public.spooks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (spook_id, user_id)
);

-- Backfill existing single tags into the join table before dropping the column.
insert into public.spook_tagged_users (spook_id, user_id)
  select id, tagged_user_id
  from public.spooks
  where tagged_user_id is not null
on conflict (spook_id, user_id) do nothing;

alter table public.spooks drop column if exists tagged_user_id;

alter table public.spook_tagged_users enable row level security;

create policy "Public spook tags are readable"
on public.spook_tagged_users
for select
to public
using (true);

create policy "Spook creators can tag users on their own spooks"
on public.spook_tagged_users
for insert
to authenticated
with check (
  exists (
    select 1 from public.spooks as s
    where s.id = spook_tagged_users.spook_id
      and s.user_id = auth.uid()
  )
);

create policy "Spook creators and admins can remove tags"
on public.spook_tagged_users
for delete
to authenticated
using (
  exists (
    select 1 from public.spooks as s
    where s.id = spook_tagged_users.spook_id
      and (
        s.user_id = auth.uid()
        or exists (
          select 1 from public.users as admin_user
          where admin_user.id = auth.uid()
            and admin_user.is_admin = true
        )
      )
  )
);

create index if not exists spook_tagged_users_user_id_idx
  on public.spook_tagged_users (user_id);
