begin;
create table public.amcinova_offertetool_monthly (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 mode text not null check (mode in ('live','test')),
 consent_at timestamptz not null,
 customer_id text unique,
 first_payment_id text unique,
 subscription_id text unique,
 paid_through date,
 cancelled_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index amcinova_offertetool_monthly_current
 on public.amcinova_offertetool_monthly (user_id, mode) where cancelled_at is null;
alter table public.amcinova_offertetool_monthly enable row level security;
revoke all on public.amcinova_offertetool_monthly from public, anon, authenticated;
grant select, insert, update on public.amcinova_offertetool_monthly to service_role;
commit;
