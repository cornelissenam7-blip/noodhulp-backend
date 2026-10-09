-- Read-only checks for the existing database. Do not enable collection before review.
select c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='amcinova_campaign_leads';
select indexdef from pg_indexes where schemaname='public' and tablename='amcinova_campaign_leads';
select policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename='amcinova_campaign_leads';
select grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='amcinova_campaign_leads';
