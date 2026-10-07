begin;
alter table public.amcinova_customer_profiles add column if not exists tester_application jsonb
 check(tester_application is null or (jsonb_typeof(tester_application)='object' and octet_length(tester_application::text)<8000));
commit;
