-- Run once in the Supabase SQL editor for the database used by api.amcinova.com.
create table if not exists public.amcinova_quotes (
  id uuid primary key,
  lead_id text,
  revision integer not null default 1 check (revision > 0),
  quote_number text not null default '',
  customer_name text not null default '',
  company_name text not null default '',
  total_cents bigint not null check (total_cents >= 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists amcinova_quotes_lead_updated on public.amcinova_quotes(lead_id, updated_at desc);
alter table public.amcinova_quotes enable row level security;
revoke all on public.amcinova_quotes from anon, authenticated;
grant select, insert, update on public.amcinova_quotes to service_role;
-- No browser-facing RLS policies: access is exclusively through the checked backend.
