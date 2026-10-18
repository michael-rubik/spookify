-- Normalize a quoted uppercase USERS table to the canonical lowercase users table.
-- This intentionally only merges tables that are schema-compatible with public.users.
do $$
declare
  has_lowercase_users boolean := false;
  has_uppercase_users boolean := false;
  uppercase_has_matching_id boolean := false;
  uppercase_has_is_admin boolean := false;
  uppercase_has_click_count boolean := false;
  uppercase_has_signup_email_status boolean := false;
  uppercase_has_created_at boolean := false;
begin
  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'users'
  ) into has_lowercase_users;

  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'USERS'
  ) into has_uppercase_users;

  if has_uppercase_users then
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'id'
        and data_type = 'uuid'
    ) into uppercase_has_matching_id;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'is_admin'
        and data_type = 'boolean'
    ) into uppercase_has_is_admin;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'click_count'
        and data_type = 'integer'
    ) into uppercase_has_click_count;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'signup_email_status'
    ) into uppercase_has_signup_email_status;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'USERS'
        and column_name = 'created_at'
    ) into uppercase_has_created_at;
  end if;

  if has_uppercase_users and not has_lowercase_users then
    execute 'alter table public."USERS" rename to users';
  elsif has_uppercase_users and has_lowercase_users then
    if uppercase_has_matching_id and uppercase_has_is_admin and uppercase_has_click_count and uppercase_has_signup_email_status and uppercase_has_created_at then
      execute $sql$
        insert into public.users (id, name, costume, email, is_admin, click_count, signup_email_status, created_at)
        select id, name, costume, email, is_admin, click_count, signup_email_status, created_at
        from public."USERS"
        on conflict (id) do update
          set name = excluded.name,
              costume = excluded.costume,
              email = excluded.email,
              is_admin = excluded.is_admin,
              click_count = excluded.click_count,
              signup_email_status = excluded.signup_email_status,
              created_at = excluded.created_at;
      $sql$;

      execute 'drop table public."USERS"';
    else
      raise notice 'Skipped merge for public."USERS" because it is not schema-compatible with public.users';
    end if;
  end if;
end $$;
