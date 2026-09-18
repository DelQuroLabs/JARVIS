-- JARVIS - schema verification.
-- Run AFTER schema.sql. Every check raises an exception on failure, so a clean
-- run is real evidence rather than an assurance. Record the output against
-- SEC-001 in artifacts/verification.json.

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'conversations', 'memory_items', 'workflows', 'skills',
    'routines', 'ideas', 'traces', 'crew_runs',
    -- key_vault holds API credentials and is only written when the user turns
    -- "Include keys in cloud sync" on. Same RLS as everything else: a row is
    -- readable only by the account that owns it.
    'key_vault'
  ];
  n int;
  rls_on boolean;
  rls_forced boolean;
begin
  foreach t in array tables loop
    select relrowsecurity, relforcerowsecurity into rls_on, rls_forced
      from pg_class where oid = ('public.' || quote_ident(t))::regclass;

    if rls_on is null then
      raise exception 'FAIL: table public.% does not exist', t;
    end if;
    if not rls_on then
      raise exception 'FAIL: RLS is not enabled on public.%', t;
    end if;
    if not rls_forced then
      raise exception 'FAIL: RLS is not FORCED on public.%', t;
    end if;

    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t;
    if n <> 4 then
      raise exception 'FAIL: public.% has % policies, expected exactly 4', t, n;
    end if;

    select count(*) into n
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = t and grantee = 'anon';
    if n <> 0 then
      raise exception 'FAIL: role anon still holds % grant(s) on public.%', n, t;
    end if;

    select count(*) into n
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = t and grantee = 'authenticated';
    if n = 0 then
      raise exception 'FAIL: role authenticated has no grants on public.%', t;
    end if;

    raise notice 'ok: public.% - RLS enabled+forced, 4 policies, anon revoked', t;
  end loop;

  raise notice 'PASS: % tables verified', array_length(tables, 1);
end
$$;

-- Belt and braces: list what actually exists so the output is inspectable.
select tablename,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       c.relrowsecurity  as rls_enabled,
       c.relforcerowsecurity as rls_forced
  from pg_tables t
  join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public'
 order by tablename;
