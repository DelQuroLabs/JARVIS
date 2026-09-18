-- JARVIS - Supabase schema
-- Apply in the SQL editor of a fresh project, or with: supabase db push
--
-- Security posture:
--   * RLS is ENABLED and FORCED on every table (forced applies it to the table
--     owner too, so a mistake in a future function cannot silently bypass it).
--   * Four explicit policies per table: select / insert / update / delete, all
--     keyed on auth.uid() = user_id.
--   * The `anon` role is granted nothing. Only `authenticated` may touch data.
--   * Rows are stored as { id, user_id, updated_at, payload jsonb } so the client
--     shape can evolve without a migration for every field.

begin;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- synced collections
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'conversations', 'memory_items', 'workflows', 'skills',
    'routines', 'ideas', 'traces', 'crew_runs',
    -- the project library: one row per project card. Attachments are inline
    -- data URLs inside the payload, so rows here can be large.
    'projects',
    -- key_vault holds API credentials and is only written when the user turns
    -- "Include keys in cloud sync" on. Same RLS as everything else: a row is
    -- readable only by the account that owns it.
    'key_vault'
  ];
begin
  foreach t in array tables loop
    execute format($f$
      create table if not exists public.%I (
        id         text        not null,
        user_id    uuid        not null references auth.users (id) on delete cascade,
        updated_at timestamptz not null default now(),
        payload    jsonb       not null,
        primary key (id)
      );
    $f$, t);

    execute format('create index if not exists %I on public.%I (user_id, updated_at desc);', t || '_user_idx', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- row-level security: enable, force, and write four policies per table
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'conversations', 'memory_items', 'workflows', 'skills',
    'routines', 'ideas', 'traces', 'crew_runs', 'projects',
    'key_vault'
  ];
  owner_col text;
begin
  foreach t in array tables loop
    owner_col := case when t = 'profiles' then 'id' else 'user_id' end;

    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I;', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I;', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I;', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() = %I);',
      t || '_select_own', t, owner_col);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (auth.uid() = %I);',
      t || '_insert_own', t, owner_col);
    execute format(
      'create policy %I on public.%I for update to authenticated using (auth.uid() = %I) with check (auth.uid() = %I);',
      t || '_update_own', t, owner_col, owner_col);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (auth.uid() = %I);',
      t || '_delete_own', t, owner_col);

    -- anon gets nothing at all; authenticated gets ordinary DML, still filtered by RLS.
    execute format('revoke all on public.%I from anon;', t);
    execute format('revoke all on public.%I from public;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end
$$;

revoke all on schema public from anon;
grant usage on schema public to authenticated;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'conversations', 'memory_items', 'workflows', 'skills',
    'routines', 'ideas', 'traces', 'crew_runs', 'projects',
    'key_vault'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I on public.%I;', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at();',
      t || '_touch', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- create a profile row on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, handle, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
