alter table public.users
  add column if not exists avatar_url text,
  add column if not exists badges text[] not null default '{}';

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
  and auth.uid() is not null
)
with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
);

create policy "Authenticated users may delete avatars"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and auth.uid() is not null
);

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
