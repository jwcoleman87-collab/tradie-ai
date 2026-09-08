-- Synthetic substitutes for the hosted Supabase Auth and Storage metadata only.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role e2e_authenticator login noinherit password 'synthetic-local-authenticator';
grant anon, authenticated, service_role to e2e_authenticator;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant select on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;
