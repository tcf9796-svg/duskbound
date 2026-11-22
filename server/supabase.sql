-- Duskbound online profiles (Supabase). Run once in the project's SQL Editor. See DESIGN.md "Online profiles".
-- One row per signed-in player; `data` is the game's profile object (meta.js newProfile / sanitizeProfile).

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Let signed-in players reach the table through the Data API (new projects may not grant this automatically);
-- the policies below still limit each player to their own row. Signed-out visitors get nothing.
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;

-- Each player can only see and change their own row.
-- (Phase 2, server-side rewards, will remove the insert/update policies so only a server function can write.)
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "create own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid() = user_id);
create policy "create own profile" on public.profiles for insert with check (auth.uid() = user_id);
create policy "update own profile" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep a single profile small (the game's is a few KB).
alter table public.profiles drop constraint if exists profile_size;
alter table public.profiles add constraint profile_size check (pg_column_size(data) < 65536);
