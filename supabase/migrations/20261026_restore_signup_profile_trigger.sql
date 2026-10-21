-- Re-install the signup profile trigger so name and costume from the signUp
-- metadata are always persisted, even if the deployed database drifted.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
