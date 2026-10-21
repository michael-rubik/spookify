-- Minimal stand-in for the Supabase pieces schema.sql depends on (throwaway e2e database only).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role dashboard_user nologin;
create role authenticator login noinherit password 'e2e-authenticator';
grant anon, authenticated to authenticator;

create schema auth;
create schema storage;

create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
create function auth.email() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '') $$;

create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, owner_id text, unique (bucket_id, name)
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to authenticated, anon, service_role;
grant all on all tables in schema storage to authenticated, service_role;
