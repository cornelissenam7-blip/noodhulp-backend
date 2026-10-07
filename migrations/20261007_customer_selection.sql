begin;
insert into public.amcinova_products(code,name) values
 ('planner','Woning- en keukenplanner'),('shophulp','Shop-hulp'),
 ('campaign','Campaign Agent'),('admaker','AdMaker')
on conflict(code) do nothing;
alter table public.amcinova_customer_profiles add column if not exists selected_products jsonb not null default '[]'::jsonb
 check(jsonb_typeof(selected_products)='array' and selected_products <@ '["sitebuilder","offertetool","planner","shophulp","campaign","admaker","promotie"]'::jsonb);
-- Existing owner-only profile policies protect these preferences. Selecting is not purchasing.
commit;
