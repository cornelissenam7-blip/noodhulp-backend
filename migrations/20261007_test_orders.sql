begin;
create table if not exists public.amcinova_test_orders (
 id uuid primary key, user_id uuid not null references auth.users(id),
 email text not null, status text not null default 'TEST' check(status='TEST'),
 selected jsonb not null check(jsonb_typeof(selected)='array'),
 payment_method text not null check(payment_method in ('once','spread')),
 terms integer not null check(terms in (3,6,12)),
 estimate jsonb not null check(jsonb_typeof(estimate)='object' and octet_length(estimate::text)<10000),
 created_at timestamptz not null default now()
);
alter table public.amcinova_test_orders enable row level security;
revoke all on public.amcinova_test_orders from anon,authenticated;
grant select,insert on public.amcinova_test_orders to authenticated;
grant all on public.amcinova_test_orders to service_role;
create policy own_test_order_read on public.amcinova_test_orders for select to authenticated using(user_id=auth.uid());
create policy own_test_order_insert on public.amcinova_test_orders for insert to authenticated with check(user_id=auth.uid() and email=auth.jwt()->>'email' and status='TEST');
commit;
