-- Run after 001_fairturn_memory.sql. Every row should return the expected value.
select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'fairturn_memory';

select
  has_table_privilege('anon', 'public.fairturn_memory', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.fairturn_memory', 'select') as authenticated_can_select,
  has_table_privilege('service_role', 'public.fairturn_memory', 'select') as service_can_select,
  has_table_privilege('service_role', 'public.fairturn_memory', 'insert') as service_can_insert,
  has_table_privilege('service_role', 'public.fairturn_memory', 'delete') as service_can_delete;

select indexname
from pg_catalog.pg_indexes
where schemaname = 'public' and tablename = 'fairturn_memory'
order by indexname;

select policyname
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'fairturn_memory';
