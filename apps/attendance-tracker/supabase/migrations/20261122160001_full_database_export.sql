-- =====================================================================
-- Full database export: everything needed to rebuild this database in
-- another Supabase project, as one .sql file.
--
-- The Settings page calls these three functions and stitches their
-- output into a single script:
--
--   export_database_schema()   extensions, enums, sequences, tables,
--                              constraints, functions, views, indexes,
--                              triggers, RLS switches, policies, grants,
--                              comments and sequence positions
--   export_database_tables()   which tables hold data, in load order
--   export_table_data(...)     one page of one table as an INSERT
--
-- Why it is built in the database and not in the browser: the schema,
-- the policies and the grants live in the system catalogs, which the
-- API never exposes, and RLS would hide rows from even a super admin's
-- ordinary reads. SECURITY DEFINER reads both, so every function here
-- refuses anyone who is not a super admin before it does anything.
--
-- HOW THE SCRIPT IS ORDERED, and why it restores cleanly:
--   1. extensions and enum types
--   2. tables, sequences, checks/keys, functions and views -- inside a
--      block that retries what failed until nothing more succeeds, so
--      the order objects depend on each other in never has to be
--      worked out by hand
--   3. the data, with no triggers and no foreign keys yet, so the audit
--      log is not written to and the guards do not reject old rows
--   4. foreign keys, indexes, triggers, RLS, policies, grants, comments
--      and sequence positions, again retried
--
-- auth.users and auth.identities are included so that people keep their
-- sign-ins (password hashes, not passwords). Personnel files are on the
-- cPanel host, not here, and Edge Function secrets cannot be read back
-- by anyone -- both have to be carried over separately.
-- =====================================================================

-- A DO block that runs each statement in its own subtransaction and keeps
-- retrying the failures while any pass makes progress. strict = true
-- aborts the restore if anything is left over; false only warns.
create or replace function public.export_retry_block(p_statements text[], p_strict boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  tag text := 'ienergy_' || substr(md5(array_to_string(p_statements, '')), 1, 12);
  body text;
begin
  if coalesce(cardinality(p_statements), 0) = 0 then
    return '-- (nothing in this section)';
  end if;
  body := E'do $' || tag || E'_do$\ndeclare\n  pending text[] := array[\n'
    || (select string_agg('$' || tag || '$' || s || '$' || tag || '$', E',\n' order by n)
          from unnest(p_statements) with ordinality as u(s, n))
    || E'\n  ]::text[];\n'
    || E'  failed text[];\n  errs text[];\n  s text;\n  i int;\n'
    || E'begin\n'
    || E'  loop\n'
    || E'    failed := ''{}''; errs := ''{}'';\n'
    || E'    foreach s in array pending loop\n'
    || E'      begin\n        execute s;\n'
    || E'      exception when others then\n'
    || E'        failed := failed || s; errs := errs || sqlerrm;\n'
    || E'      end;\n'
    || E'    end loop;\n'
    || E'    exit when cardinality(failed) = 0 or cardinality(failed) = cardinality(pending);\n'
    || E'    pending := failed;\n'
    || E'  end loop;\n'
    || E'  if cardinality(failed) > 0 then\n'
    || E'    for i in 1 .. cardinality(failed) loop\n'
    || E'      raise warning ''Not restored: % -- %'', left(failed[i], 300), errs[i];\n'
    || E'    end loop;\n'
    || case when p_strict
         then E'    raise exception ''% statement(s) could not be restored; see the warnings above.'', cardinality(failed);\n'
         else E'    raise warning ''% statement(s) were skipped; see the warnings above.'', cardinality(failed);\n'
       end
    || E'  end if;\n'
    || E'end $' || tag || E'_do$;';
  return body;
end
$fn$;

revoke all on function public.export_retry_block(text[], boolean) from public, anon, authenticated;


create or replace function public.export_database_schema()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  pre   text := '';
  objs  text[] := '{}';
  post  text[] := '{}';
  r     record;
  g     record;
  cols  text;
  kw    text;
  managed constant text[] := array['public', 'anon', 'authenticated', 'service_role'];
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can export the database.' using errcode = '42501';
  end if;

  -- 1. Extensions (plpgsql is always there) and enum types --------------
  for r in
    select e.extname, n.nspname
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname <> 'plpgsql'
     order by e.extname
  loop
    pre := pre || format('create extension if not exists %I with schema %I;', r.extname, r.nspname) || E'\n';
  end loop;

  for r in
    select t.oid, format('%I.%I', n.nspname, t.typname) as name
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype = 'e'
       and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
     order by t.typname
  loop
    pre := pre || format(
      'do $t$ begin create type %s as enum (%s); exception when duplicate_object then null; end $t$;',
      r.name,
      (select string_agg(quote_literal(enumlabel), ', ' order by enumsortorder)
         from pg_enum where enumtypid = r.oid)) || E'\n';
  end loop;

  -- 2. Sequences that are not an identity column's own -------------------
  for r in
    select c.oid::regclass::text as name, s.seqtypid, s.seqincrement, s.seqmin, s.seqmax,
           s.seqstart, s.seqcache, s.seqcycle
      from pg_class c
      join pg_sequence s on s.seqrelid = c.oid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('i', 'e'))
  loop
    objs := objs || format('create sequence if not exists %s as %s increment by %s minvalue %s maxvalue %s start with %s cache %s%s',
      r.name, format_type(r.seqtypid, null), r.seqincrement, r.seqmin, r.seqmax, r.seqstart, r.seqcache,
      case when r.seqcycle then ' cycle' else '' end);
  end loop;

  -- Tables, with defaults, generated and identity columns ----------------
  for r in
    select c.oid, c.oid::regclass::text as name, c.relpersistence
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relispartition
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     order by c.relname
  loop
    select string_agg(
             format('%I %s', a.attname, format_type(a.atttypid, a.atttypmod))
             || case when a.attcollation <> 0 and a.attcollation <> ty.typcollation
                     then ' collate ' || (select format('%I.%I', cn.nspname, co.collname)
                                            from pg_collation co join pg_namespace cn on cn.oid = co.collnamespace
                                           where co.oid = a.attcollation)
                     else '' end
             || case when a.attidentity = 'a' then ' generated always as identity'
                     when a.attidentity = 'd' then ' generated by default as identity'
                     when a.attgenerated = 's' then ' generated always as (' || pg_get_expr(ad.adbin, ad.adrelid) || ') stored'
                     when ad.adbin is not null then ' default ' || pg_get_expr(ad.adbin, ad.adrelid)
                     else '' end
             || case when a.attnotnull then ' not null' else '' end,
             E',\n  ' order by a.attnum)
      into cols
      from pg_attribute a
      join pg_type ty on ty.oid = a.atttypid
      left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
     where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped;

    objs := objs || format(E'create %stable if not exists %s (\n  %s\n)',
      case when r.relpersistence = 'u' then 'unlogged ' else '' end, r.name, coalesce(cols, ''));
  end loop;

  -- Keys and checks go with the tables; foreign keys wait for the data ---
  for r in
    select con.conname, con.conrelid::regclass::text as tbl, pg_get_constraintdef(con.oid) as def, con.contype
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and con.contype in ('p', 'u', 'c', 'x', 'f') and con.conislocal
     order by con.contype, con.conname
  loop
    if r.contype = 'f' then
      post := post || format('alter table %s add constraint %I %s', r.tbl, r.conname, r.def);
    else
      objs := objs || format('alter table %s add constraint %I %s', r.tbl, r.conname, r.def);
    end if;
  end loop;

  -- Functions and procedures (not those an extension brought) ------------
  for r in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by p.proname
  loop
    objs := objs || pg_get_functiondef(r.oid);
  end loop;

  -- Views, with options such as security_invoker -------------------------
  for r in
    select c.oid, c.oid::regclass::text as name, c.reloptions, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     order by c.relname
  loop
    objs := objs || format('create %s %s%s as %s',
      case when r.relkind = 'm' then 'materialized view if not exists' else 'or replace view' end,
      r.name,
      case when r.reloptions is not null then ' with (' || array_to_string(r.reloptions, ', ') || ')' else '' end,
      rtrim(pg_get_viewdef(r.oid), E'; \n'));
  end loop;

  -- 4. After the data ----------------------------------------------------
  -- Indexes that are not already a key's own.
  for r in
    select pg_get_indexdef(i.indexrelid) as def
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.contype in ('p', 'u', 'x'))
  loop
    post := post || r.def;
  end loop;

  -- Rewrite rules other than the ones that make a view a view.
  for r in
    select pg_get_ruledef(ru.oid) as def
      from pg_rewrite ru
      join pg_class c on c.oid = ru.ev_class
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and ru.rulename <> '_RETURN'
  loop
    post := post || rtrim(r.def, E'; \n');
  end loop;

  -- Triggers on our tables, and our own triggers on auth.users etc.
  for r in
    select t.tgname, t.tgrelid::regclass::text as tbl, t.tgenabled, pg_get_triggerdef(t.oid) as def
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace pn on pn.oid = p.pronamespace
     where not t.tgisinternal
       and (n.nspname = 'public' or pn.nspname = 'public')
     order by t.tgrelid::regclass::text, t.tgname
  loop
    post := post || r.def;
    if r.tgenabled = 'D' then
      post := post || format('alter table %s disable trigger %I', r.tbl, r.tgname);
    end if;
  end loop;

  -- Row level security switches.
  for r in
    select c.oid::regclass::text as name, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    if r.relrowsecurity then
      post := post || format('alter table %s enable row level security', r.name);
    end if;
    if r.relforcerowsecurity then
      post := post || format('alter table %s force row level security', r.name);
    end if;
  end loop;

  -- Policies: ours, and any on storage.
  for r in
    select * from pg_policies where schemaname in ('public', 'storage')
     order by schemaname, tablename, policyname
  loop
    post := post || format('create policy %I on %I.%I as %s for %s to %s%s%s',
      r.policyname, r.schemaname, r.tablename, lower(r.permissive), lower(r.cmd),
      (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ')
         from unnest(r.roles) x),
      case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
  end loop;

  -- Grants on tables, views and sequences, then on columns, for the API
  -- roles. Revoked first, because a fresh project grants them far more.
  for r in
    select c.oid, c.oid::regclass::text as name, c.relkind, c.relacl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S') and c.relacl is not null
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    kw := case when r.relkind = 'S' then 'sequence' else 'table' end;
    post := post || format('revoke all on %s %s from public, anon, authenticated, service_role', kw, r.name);
    for g in
      select coalesce(ro.rolname, 'public') as grantee, string_agg(a.privilege_type, ', ') as privs
        from aclexplode(r.relacl) a left join pg_roles ro on ro.oid = a.grantee
       where coalesce(ro.rolname, 'public') = any (managed)
       group by 1
    loop
      post := post || format('grant %s on %s %s to %s', g.privs, kw, r.name,
        case when g.grantee = 'public' then 'public' else quote_ident(g.grantee) end);
    end loop;
  end loop;

  for r in
    select c.oid::regclass::text as name, a.attname, a.attacl
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and a.attacl is not null and a.attnum > 0 and not a.attisdropped
  loop
    for g in
      select coalesce(ro.rolname, 'public') as grantee, string_agg(x.privilege_type, ', ') as privs
        from aclexplode(r.attacl) x left join pg_roles ro on ro.oid = x.grantee
       where coalesce(ro.rolname, 'public') = any (managed)
       group by 1
    loop
      post := post || format('grant %s (%I) on table %s to %s', g.privs, r.attname, r.name,
        case when g.grantee = 'public' then 'public' else quote_ident(g.grantee) end);
    end loop;
  end loop;

  -- Who may call which function.
  for r in
    select p.oid::regprocedure::text as sig, p.prokind, p.proacl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p') and p.proacl is not null
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    kw := case when r.prokind = 'p' then 'procedure' else 'function' end;
    post := post || format('revoke all on %s %s from public, anon, authenticated, service_role', kw, r.sig);
    for g in
      select coalesce(ro.rolname, 'public') as grantee
        from aclexplode(r.proacl) a left join pg_roles ro on ro.oid = a.grantee
       where coalesce(ro.rolname, 'public') = any (managed) and a.privilege_type = 'EXECUTE'
    loop
      post := post || format('grant execute on %s %s to %s', kw, r.sig,
        case when g.grantee = 'public' then 'public' else quote_ident(g.grantee) end);
    end loop;
  end loop;

  -- Comments: tables, views, columns, functions, types.
  for r in
    select c.oid::regclass::text as name, c.relkind, d.description
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_description d on d.objoid = c.oid and d.classoid = 'pg_class'::regclass and d.objsubid = 0
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S')
  loop
    post := post || format('comment on %s %s is %L',
      case r.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'S' then 'sequence' else 'table' end,
      r.name, r.description);
  end loop;

  for r in
    select c.oid::regclass::text as name, a.attname, d.description
      from pg_description d
      join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
     where n.nspname = 'public' and d.objsubid > 0
  loop
    post := post || format('comment on column %s.%I is %L', r.name, r.attname, r.description);
  end loop;

  for r in
    select p.oid::regprocedure::text as sig, p.prokind, d.description
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_description d on d.objoid = p.oid and d.classoid = 'pg_proc'::regclass
     where n.nspname = 'public'
  loop
    post := post || format('comment on %s %s is %L',
      case when r.prokind = 'p' then 'procedure' else 'function' end, r.sig, r.description);
  end loop;

  for r in
    select format('%I.%I', n.nspname, t.typname) as name, d.description
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_description d on d.objoid = t.oid and d.classoid = 'pg_type'::regclass
     where n.nspname = 'public' and t.typtype = 'e'
  loop
    post := post || format('comment on type %s is %L', r.name, r.description);
  end loop;

  -- Sequences: who owns them, and where they had got to, so new rows do
  -- not collide with the ones just loaded.
  for r in
    select s.oid::regclass::text as seq, d.deptype,
           tc.oid::regclass::text as tbl, a.attname,
           ps.last_value
      from pg_class s
      join pg_namespace n on n.oid = s.relnamespace
      join pg_sequences ps on ps.schemaname = n.nspname and ps.sequencename = s.relname
      left join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
                           and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
      left join pg_class tc on tc.oid = d.refobjid
      left join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
     where n.nspname = 'public' and s.relkind = 'S'
  loop
    if r.deptype = 'a' then
      post := post || format('alter sequence %s owned by %s.%I', r.seq, r.tbl, r.attname);
    end if;
    if r.last_value is not null then
      if r.deptype = 'i' then
        post := post || format('select pg_catalog.setval(pg_catalog.pg_get_serial_sequence(%L, %L), %s, true)',
          r.tbl, r.attname, r.last_value);
      else
        post := post || format('select pg_catalog.setval(%L, %s, true)', r.seq, r.last_value);
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'pre', pre,
    'objects', public.export_retry_block(objs, true),
    'post', public.export_retry_block(post, false),
    'object_count', cardinality(objs),
    'post_count', cardinality(post),
    'exported_at', now(),
    'postgres', current_setting('server_version')
  );
end
$fn$;

revoke all on function public.export_database_schema() from public, anon, authenticated;
grant execute on function public.export_database_schema() to authenticated;


-- The tables that hold data, in the order they should be loaded: the
-- sign-ins first (identities need their user), then ours.
create or replace function public.export_database_tables()
returns table (table_schema text, table_name text, approx_rows bigint)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can export the database.' using errcode = '42501';
  end if;
  return query
    select n.nspname::text, c.relname::text, greatest(c.reltuples, 0)::bigint
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where (n.nspname = 'public' and c.relkind = 'r' and not c.relispartition
            and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e'))
        or (n.nspname = 'auth' and c.relname in ('users', 'identities'))
     order by case when n.nspname = 'auth' then (case c.relname when 'users' then 0 else 1 end) else 2 end,
              c.relname;
end
$fn$;

revoke all on function public.export_database_tables() from public, anon, authenticated;
grant execute on function public.export_database_tables() to authenticated;


-- One page of one table, as a single INSERT, with how many rows it
-- holds: {"sql": "...", "rows": 2000}, or null past the last page. Values travel as JSON and
-- are turned back into the table's own row type on the way in, so every
-- column type round-trips without quoting rules per type. Generated
-- columns are left out (the database recomputes them) and identity
-- values are kept as they are.
create or replace function public.export_table_data(
  p_schema text, p_table text, p_offset integer, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  rel   regclass;
  cols  text;
  data  text;
  n     integer;
  stmt  text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can export the database.' using errcode = '42501';
  end if;
  if not (p_schema = 'public' or (p_schema = 'auth' and p_table in ('users', 'identities'))) then
    raise exception 'Table %.% is not part of the export.', p_schema, p_table;
  end if;

  rel := format('%I.%I', p_schema, p_table)::regclass;

  select string_agg(quote_ident(attname), ', ' order by attnum)
    into cols
    from pg_attribute
   where attrelid = rel and attnum > 0 and not attisdropped and attgenerated = '';

  execute format(
    'select json_agg(row_to_json(t))::text, count(*) from (select %s from %s order by ctid offset %s limit %s) t',
    cols, rel, greatest(p_offset, 0), least(greatest(p_limit, 1), 5000))
    into data, n;

  if n = 0 then
    return null;
  end if;

  stmt := format('insert into %s (%s) overriding system value select %s from pg_catalog.json_populate_recordset(null::%s, %L)',
    rel, cols, cols, rel, data);

  -- A new project's auth tables can differ by a column or two. If they
  -- do, say so and carry on rather than lose the whole restore.
  if p_schema = 'auth' then
    stmt := format(E'do $auth_%s$ begin\n  %s on conflict do nothing;\nexception when others then\n  raise warning ''Sign-ins in %s were not copied: %%'', sqlerrm;\nend $auth_%s$;',
      p_table, stmt, rel, p_table);
  else
    stmt := stmt || ';';
  end if;

  return jsonb_build_object('sql', stmt, 'rows', n);
end
$fn$;

revoke all on function public.export_table_data(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.export_table_data(text, text, integer, integer) to authenticated;
