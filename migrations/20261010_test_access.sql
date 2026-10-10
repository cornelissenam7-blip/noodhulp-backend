-- Temporary test access only. Execute before enabling the backend allowlist.
begin;
create table public.amcinova_test_access_activations (
 user_id uuid not null references auth.users(id),
 product_code text not null references public.amcinova_products(code),
 payment_id text not null,
 expires_at timestamptz not null,
 grant_id uuid not null references public.amcinova_ai_credit_grants(id),
 primary key(user_id,product_code)
);
alter table public.amcinova_test_access_activations enable row level security;
revoke all on public.amcinova_test_access_activations from public,anon,authenticated;
grant all on public.amcinova_test_access_activations to service_role;
create function public.amcinova_activate_test_access(p_user uuid,p_product text,p_payment text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.amcinova_test_access_activations; expiry timestamptz; credit uuid;
begin
 if p_product not in ('sitebuilder','offertetool') or p_payment !~ '^tr_[A-Za-z0-9]+$' then raise exception 'Invalid test activation'; end if;
 perform pg_advisory_xact_lock(hashtextextended('test-access:'||p_user::text||':'||p_product,0));
 select * into existing from public.amcinova_test_access_activations where user_id=p_user and product_code=p_product;
 if found then return jsonb_build_object('status','already-created','expiresAt',existing.expires_at); end if;
 -- Never replace any existing access, including expired or revoked access.
 if exists(select 1 from public.amcinova_customer_access where user_id=p_user and product_code=p_product) then
  return jsonb_build_object('status','existing-access-preserved');
 end if;
 expiry:=now()+interval '7 days';
 credit:=public.amcinova_credit_grant(p_user,p_product,5,'test','TEST-access:'||p_user::text||':'||p_product,expiry);
 insert into public.amcinova_customer_access(user_id,product_code,status,source,expires_at) values(p_user,p_product,'active','trial',expiry);
 insert into public.amcinova_test_access_activations values(p_user,p_product,p_payment,expiry,credit);
 return jsonb_build_object('status','trial','expiresAt',expiry,'credits',5);
end $$;
revoke all on function public.amcinova_activate_test_access(uuid,text,text) from public,anon,authenticated;
grant execute on function public.amcinova_activate_test_access(uuid,text,text) to service_role;
create function public.amcinova_revoke_test_access(p_user uuid,p_product text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare trial public.amcinova_test_access_activations;
begin
 perform pg_advisory_xact_lock(hashtextextended('test-access:'||p_user::text||':'||p_product,0));
 select * into trial from public.amcinova_test_access_activations where user_id=p_user and product_code=p_product;
 if not found then return false; end if;
 -- Match this lease; later manual or purchased access is preserved.
 update public.amcinova_customer_access set status='revoked' where user_id=p_user and product_code=p_product and source='trial' and expires_at=trial.expires_at;
 update public.amcinova_ai_credit_grants set expires_at=least(expires_at,now()) where id=trial.grant_id and source='test';
 return true;
end $$;
revoke all on function public.amcinova_revoke_test_access(uuid,text) from public,anon,authenticated;
grant execute on function public.amcinova_revoke_test_access(uuid,text) to service_role;
commit;
