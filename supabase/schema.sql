-- Expense Tracker: Supabase schema.
-- Paste this whole file into Supabase Dashboard -> SQL Editor -> New query -> Run.

-- Shared trigger: stamp server time for incremental pulls, and ignore writes
-- that are older than what the server already has (last write wins).
create or replace function public.sync_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- stale write from another device, keep the newer row
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

create table if not exists public.categories (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  name text not null,
  icon text not null,
  color text not null,
  sort integer not null default 0,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.expenses (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  amount numeric(12,2) not null,
  category_id text,
  note text not null default '',
  date date not null,
  paid_by text not null default 'me',
  shares jsonb not null default '[]',
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.people (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  name text not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.budgets (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  category_id text not null,
  amount numeric(12,2) not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.settlements (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  person_id text not null,
  amount numeric(12,2) not null,
  direction text not null check (direction in ('paid', 'received')),
  date date not null,
  note text not null default '',
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- v2: credits and accounts (safe to run on an existing project; it only adds).
alter table public.expenses add column if not exists type text not null default 'expense'
  check (type in ('expense', 'credit'));
alter table public.expenses add column if not exists account_id text;

create table if not exists public.accounts (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  name text not null,
  bank text not null,
  kind text not null check (kind in ('card', 'bank')),
  last4 text not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

do $$
declare
  t text;
begin
  foreach t in array array['categories', 'accounts', 'expenses', 'people', 'budgets', 'settlements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('drop trigger if exists sync_stamp on public.%I', t);
    execute format(
      'create trigger sync_stamp before insert or update on public.%I
         for each row execute function public.sync_stamp()', t);
    execute format(
      'create index if not exists %I on public.%I (user_id, server_updated_at)',
      t || '_pull_idx', t);
  end loop;
end $$;

-- =====================================================================
-- v3: sharing expenses with friends who have an account (Splitwise-style).
-- Safe to run on an existing project; it only adds.
-- =====================================================================

-- Personal tables: remember which friends are linked to an account, and which
-- expenses / settle-ups are shared.
-- (user_id is the row's owner; the friend's account goes in friend_uid.)
alter table public.people add column if not exists friend_uid text;
alter table public.people add column if not exists email text;
alter table public.expenses add column if not exists shared smallint not null default 0;
alter table public.settlements add column if not exists shared smallint not null default 0;

-- Profiles: the name your friends see. Created automatically for every account.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  name text not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_email_idx on public.profiles (lower(email));
alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create or replace function public.create_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, lower(new.email), split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists create_profile on auth.users;
create trigger create_profile after insert on auth.users for each row execute function public.create_profile();
-- Accounts that existed before this ran.
insert into public.profiles (id, email, name)
select id, lower(email), split_part(email, '@', 1) from auth.users where email is not null
on conflict (id) do nothing;

-- Find a friend's account by exact email. Returns nothing for unknown emails and
-- never lists other users.
create or replace function public.find_account(p_email text)
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name from public.profiles p
  where p.email = lower(trim(p_email)) and p.id <> auth.uid()
  limit 1
$$;
revoke all on function public.find_account(text) from public, anon;
grant execute on function public.find_account(text) to authenticated;

-- Shared expenses and settle-ups. Every person in them who has an account is a
-- member and can see and edit them; nobody else can.
create table if not exists public.shared_expenses (
  id text primary key,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  member_ids uuid[] not null,
  amount numeric(12,2) not null,
  date date not null,
  note text not null default '',
  category text,
  paid_by jsonb not null,
  shares jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.shared_settlements (
  id text primary key,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  member_ids uuid[] not null,
  from_uid uuid not null,
  to_uid uuid not null,
  from_name text not null default '',
  to_name text not null default '',
  amount numeric(12,2) not null,
  date date not null,
  note text not null default '',
  updated_at bigint not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now()
);

-- created_by is always the account that first saved the row and can't be changed
-- later; stale edits are ignored (last write wins), like the personal tables.
create or replace function public.shared_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    if new.updated_at < old.updated_at then
      return null;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['shared_expenses', 'shared_settlements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated
       using ((select auth.uid()) = any(member_ids))', t);
    execute format('drop policy if exists "members add" on public.%I', t);
    execute format('create policy "members add" on public.%I for insert to authenticated
       with check ((select auth.uid()) = any(member_ids))', t);
    execute format('drop policy if exists "members edit" on public.%I', t);
    execute format('create policy "members edit" on public.%I for update to authenticated
       using ((select auth.uid()) = any(member_ids)) with check ((select auth.uid()) = any(member_ids))', t);
    execute format('drop trigger if exists shared_stamp on public.%I', t);
    execute format('create trigger shared_stamp before insert or update on public.%I
       for each row execute function public.shared_stamp()', t);
    execute format('create index if not exists %I on public.%I using gin (member_ids)', t || '_members_idx', t);
    execute format('create index if not exists %I on public.%I (server_updated_at)', t || '_pull_idx', t);
  end loop;
end $$;
