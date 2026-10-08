-- Apply before enabling CUSTOMER_AI_CREDITS_ENABLED. No commercial quantities/prices seeded.
begin;
create table public.amcinova_ai_credit_grants (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 product_code text not null references public.amcinova_products(code),
 units integer not null check(units>0), remaining integer not null check(remaining>=0 and remaining<=units),
 source text not null check(source in ('included','monthly','topup','test')),
 reference text not null unique,
 expires_at timestamptz, created_at timestamptz not null default now()
);
create table public.amcinova_ai_credit_usage (
 request_id uuid primary key, user_id uuid not null references auth.users(id),
 product_code text not null references public.amcinova_products(code),
 grant_id uuid not null references public.amcinova_ai_credit_grants(id),
 status text not null default 'reserved' check(status in ('reserved','consumed','refunded')),
 created_at timestamptz not null default now()
);
create table public.amcinova_ai_topup_requests (
 id uuid primary key, user_id uuid not null references auth.users(id),
 product_code text not null references public.amcinova_products(code),
 units integer not null check(units in (10,25,100)),
 status text not null default 'TEST' check(status='TEST'),
 created_at timestamptz not null default now()
);
alter table public.amcinova_ai_topup_requests enable row level security;
revoke all on public.amcinova_ai_topup_requests from anon,authenticated;
grant select,insert on public.amcinova_ai_topup_requests to authenticated;
grant all on public.amcinova_ai_topup_requests to service_role;
create policy topup_own_read on public.amcinova_ai_topup_requests for select to authenticated using(user_id=auth.uid());
create policy topup_own_insert on public.amcinova_ai_topup_requests for insert to authenticated with check(user_id=auth.uid() and status='TEST');
alter table public.amcinova_ai_credit_grants enable row level security;
alter table public.amcinova_ai_credit_usage enable row level security;
revoke all on public.amcinova_ai_credit_grants,public.amcinova_ai_credit_usage from anon,authenticated;
grant select on public.amcinova_ai_credit_grants,public.amcinova_ai_credit_usage to authenticated;
grant all on public.amcinova_ai_credit_grants,public.amcinova_ai_credit_usage to service_role;
create policy credits_own on public.amcinova_ai_credit_grants for select to authenticated using(user_id=auth.uid());
create policy usage_own on public.amcinova_ai_credit_usage for select to authenticated using(user_id=auth.uid());
create index credits_balance on public.amcinova_ai_credit_grants(user_id,product_code) where remaining>0;
create index credits_history on public.amcinova_ai_credit_usage(user_id,created_at desc);
create function public.amcinova_credit_reserve(p_user uuid,p_product text,p_request uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare g uuid;
begin
 -- Serialize requests per customer/product, including duplicate request IDs.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_product,0));
 if exists(select 1 from amcinova_ai_credit_usage where request_id=p_request) then
  raise exception 'Request already reserved';
 end if;
 select id into g from amcinova_ai_credit_grants
 where user_id=p_user and product_code=p_product and remaining>0 and (expires_at is null or expires_at>now())
 order by expires_at asc nulls last,created_at,id limit 1 for update;
 if g is null then return false; end if;
 update amcinova_ai_credit_grants set remaining=remaining-1 where id=g;
 insert into amcinova_ai_credit_usage(request_id,user_id,product_code,grant_id) values(p_request,p_user,p_product,g);
 return true;
end $$;
create function public.amcinova_credit_complete(p_request uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 update amcinova_ai_credit_usage set status='consumed' where request_id=p_request and status='reserved';
 return exists(select 1 from amcinova_ai_credit_usage where request_id=p_request and status='consumed');
end $$;
-- Called only by trusted backend after verified payment, or an explicit test grant.
-- A reference identifies one purchase/paid subscription period, never a client choice.
create function public.amcinova_credit_grant(p_user uuid,p_product text,p_units integer,p_source text,p_reference text,p_expires timestamptz default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare g amcinova_ai_credit_grants;
begin
 if p_units is null or p_units<1 or p_units>100000 or p_source not in ('included','monthly','topup','test') or p_reference is null or length(p_reference)<8 or length(p_reference)>200 then
  raise exception 'Invalid grant';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_reference,1));
 select * into g from amcinova_ai_credit_grants where reference=p_reference;
 if found then
  if g.user_id<>p_user or g.product_code<>p_product or g.units<>p_units or g.source<>p_source or g.expires_at is distinct from p_expires then raise exception 'Conflicting grant reference'; end if;
  return g.id;
 end if;
 insert into amcinova_ai_credit_grants(user_id,product_code,units,remaining,source,reference,expires_at)
 values(p_user,p_product,p_units,p_units,p_source,p_reference,p_expires) returning * into g;
 return g.id;
end $$;
revoke all on function public.amcinova_credit_complete(uuid),public.amcinova_credit_grant(uuid,text,integer,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.amcinova_credit_complete(uuid),public.amcinova_credit_grant(uuid,text,integer,text,text,timestamptz) to service_role;
create function public.amcinova_credit_refund(p_request uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare g uuid;
begin
 update amcinova_ai_credit_usage set status='refunded' where request_id=p_request and status='reserved' returning grant_id into g;
 if g is null then return false; end if;
 update amcinova_ai_credit_grants set remaining=remaining+1 where id=g;
 return true;
end $$;
revoke all on function public.amcinova_credit_reserve(uuid,text,uuid),public.amcinova_credit_refund(uuid) from public,anon,authenticated;
grant execute on function public.amcinova_credit_reserve(uuid,text,uuid),public.amcinova_credit_refund(uuid) to service_role;
commit;
