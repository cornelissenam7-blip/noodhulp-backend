-- Customer-owned data; existing admin tables remain untouched.
begin;
create table if not exists public.amcinova_products (
 code text primary key check (code ~ '^[a-z_]{3,40}$'), name text not null,
 price_cents integer check(price_cents >= 0), currency text not null default 'EUR',
 checkout_enabled boolean not null default false,
 check (not checkout_enabled or price_cents is not null)
);
insert into public.amcinova_products(code,name) values
 ('sitebuilder','Sitebuilder'),('offertetool','Offertetool'),('promotie','Promotie-agent')
 on conflict(code) do nothing;
create table if not exists public.amcinova_customer_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 company_name text not null default '' check(length(company_name)<=200),
 created_at timestamptz not null default now()
);
create table if not exists public.amcinova_customer_purchases (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 product_code text not null references public.amcinova_products(code),
 provider_payment_id text unique not null, status text not null check(status in ('pending','paid','failed','canceled','refunded')),
 amount_cents integer not null check(amount_cents>=0), currency text not null default 'EUR',
 created_at timestamptz not null default now(), verified_at timestamptz
);
create table if not exists public.amcinova_customer_access (
 user_id uuid not null references auth.users(id) on delete cascade,
 product_code text not null references public.amcinova_products(code),
 status text not null check(status in ('active','revoked')),
 source text not null check(source in ('purchase','trial','manual')),
 purchase_id uuid references public.amcinova_customer_purchases(id),
 expires_at timestamptz, created_at timestamptz not null default now(),
 primary key(user_id,product_code), check(source <> 'purchase' or purchase_id is not null)
);
create table if not exists public.amcinova_customer_documents (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 product_code text not null references public.amcinova_products(code),
 project_id uuid not null, revision integer not null check(revision>0),
 name text not null check(length(name) between 1 and 200), payload jsonb not null,
 created_at timestamptz not null default now(),
 unique(user_id,product_code,project_id,revision),
 check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=1800000)
);
create index if not exists amcinova_customer_documents_owner on public.amcinova_customer_documents(user_id,product_code,created_at desc);
alter table public.amcinova_products enable row level security;
alter table public.amcinova_customer_profiles enable row level security;
alter table public.amcinova_customer_purchases enable row level security;
alter table public.amcinova_customer_access enable row level security;
alter table public.amcinova_customer_documents enable row level security;
revoke all on public.amcinova_products,public.amcinova_customer_profiles,public.amcinova_customer_purchases,public.amcinova_customer_access,public.amcinova_customer_documents from anon,authenticated;
grant select on public.amcinova_products,public.amcinova_customer_purchases,public.amcinova_customer_access,public.amcinova_customer_documents to authenticated;
grant select,insert,update on public.amcinova_customer_profiles to authenticated;
grant insert on public.amcinova_customer_documents to authenticated;
create policy customer_products_read on public.amcinova_products for select to authenticated using(true);
create policy customer_profile_read on public.amcinova_customer_profiles for select to authenticated using(user_id=auth.uid());
create policy customer_profile_insert on public.amcinova_customer_profiles for insert to authenticated with check(user_id=auth.uid());
create policy customer_profile_update on public.amcinova_customer_profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy customer_purchase_read on public.amcinova_customer_purchases for select to authenticated using(user_id=auth.uid());
create policy customer_access_read on public.amcinova_customer_access for select to authenticated using(user_id=auth.uid());
create policy customer_document_read on public.amcinova_customer_documents for select to authenticated using(user_id=auth.uid());
create policy customer_document_insert on public.amcinova_customer_documents for insert to authenticated with check(
 user_id=auth.uid() and exists(select 1 from public.amcinova_customer_access a
 where a.user_id=auth.uid() and a.product_code=amcinova_customer_documents.product_code
 and a.status='active' and (a.expires_at is null or a.expires_at>now())
 and (a.source<>'purchase' or exists(select 1 from public.amcinova_customer_purchases p
 where p.id=a.purchase_id and p.user_id=auth.uid() and p.product_code=a.product_code and p.status='paid' and p.verified_at is not null))));
-- There is deliberately no customer write policy for purchases/access/products.
-- Purchase access must only be granted after server-side payment verification.
grant all on public.amcinova_products,public.amcinova_customer_profiles,public.amcinova_customer_purchases,public.amcinova_customer_access,public.amcinova_customer_documents to service_role;
create or replace function public.amcinova_validate_purchase_access() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.source='purchase' and new.status='active' and not exists(select 1 from public.amcinova_customer_purchases p
 where p.id=new.purchase_id and p.user_id=new.user_id and p.product_code=new.product_code
 and p.status='paid' and p.verified_at is not null) then
 raise exception 'Verified purchase for this owner and product required';
 end if;
 return new;
end $$;
create trigger customer_purchase_access_check before insert or update on public.amcinova_customer_access
 for each row execute function public.amcinova_validate_purchase_access();
commit;
