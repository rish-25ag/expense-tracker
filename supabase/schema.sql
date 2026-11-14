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
