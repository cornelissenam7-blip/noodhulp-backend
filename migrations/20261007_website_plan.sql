begin;
alter table public.amcinova_customer_profiles add column if not exists website_plan jsonb
 check (website_plan is null or (jsonb_typeof(website_plan)='object' and octet_length(website_plan::text)<16000));
commit;
