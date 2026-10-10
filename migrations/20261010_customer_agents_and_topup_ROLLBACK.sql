-- REVIEW BEFORE APPLYING. Test access only, never a commercial purchase.
-- Backend must verify fresh Mollie TEST payment, owner, purpose and exact amount.
begin;
create or replace function public.amcinova_activate_test_access(p_user uuid,p_product text,p_payment text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.amcinova_test_access_activations; expiry timestamptz; credit uuid;
begin
 if p_product not in ('sitebuilder','offertetool','planner','shophulp','campaign','admaker','promotie') or p_payment !~ '^tr_[A-Za-z0-9]+$' then raise exception 'Invalid test activation'; end if;
 perform pg_advisory_xact_lock(hashtextextended('test-access:'||p_user::text||':'||p_product,0));
 select * into existing from public.amcinova_test_access_activations where user_id=p_user and product_code=p_product;
 if found then return jsonb_build_object('status','already-created','expiresAt',existing.expires_at); end if;
 if exists(select 1 from public.amcinova_customer_access where user_id=p_user and product_code=p_product) then return jsonb_build_object('status','existing-access-preserved'); end if;
 expiry:=now()+interval '7 days';
 credit:=public.amcinova_credit_grant(p_user,p_product,5,'test','TEST-access:'||p_user::text||':'||p_product,expiry);
 insert into public.amcinova_customer_access(user_id,product_code,status,source,expires_at) values(p_user,p_product,'active','trial',expiry);
 insert into public.amcinova_test_access_activations values(p_user,p_product,p_payment,expiry,credit);
 return jsonb_build_object('status','trial','expiresAt',expiry,'credits',5);
end $$;
revoke all on function public.amcinova_activate_test_access(uuid,text,text) from public,anon,authenticated;
grant execute on function public.amcinova_activate_test_access(uuid,text,text) to service_role;

create table public.amcinova_test_credit_payments(
 id uuid primary key,user_id uuid not null references auth.users(id),
 product_code text not null references public.amcinova_products(code),
 units integer not null check(units in(25,100)),
 amount_cents integer not null check(amount_cents=case units when 25 then 1089 when 100 then 3509 end),
 currency text not null check(currency='EUR'),policy text not null check(policy='test-topup-20261010'),
 status text not null check(status='TEST'),payment_id text unique check(payment_id ~ '^tr_[A-Za-z0-9]+$'),
 grant_id uuid unique references public.amcinova_ai_credit_grants(id),created_at timestamptz not null default now()
);
alter table public.amcinova_test_credit_payments enable row level security;
revoke all on public.amcinova_test_credit_payments from public,anon,authenticated;
grant select on public.amcinova_test_credit_payments to authenticated;
grant all on public.amcinova_test_credit_payments to service_role;
create policy own_test_credit_payments on public.amcinova_test_credit_payments for select to authenticated using(user_id=auth.uid());

create function public.amcinova_create_test_topup(p_user uuid,p_id uuid,p_product text,p_units integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare invoice public.amcinova_test_credit_payments; lease public.amcinova_customer_access; used integer;
begin
 if p_units not in(25,100) then raise exception 'Invalid test pack'; end if;
 perform pg_advisory_xact_lock(hashtextextended('test-access:'||p_user::text||':'||p_product,0));
 select * into invoice from public.amcinova_test_credit_payments where id=p_id;
 if found then
  if invoice.user_id<>p_user or invoice.product_code<>p_product or invoice.units<>p_units then raise exception 'Request already bound'; end if;
  return to_jsonb(invoice);
 end if;
 select * into lease from public.amcinova_customer_access where user_id=p_user and product_code=p_product;
 if not found or lease.source<>'trial' or lease.status<>'active' or lease.expires_at is null or lease.expires_at<=now() then raise exception 'No active test lease'; end if;
 select coalesce(sum(units),0) into used from public.amcinova_test_credit_payments where user_id=p_user and product_code=p_product;
 if used+p_units>100 then raise exception 'Test request cap reached'; end if;
 insert into public.amcinova_test_credit_payments(id,user_id,product_code,units,amount_cents,currency,policy,status)
 values(p_id,p_user,p_product,p_units,case p_units when 25 then 1089 else 3509 end,'EUR','test-topup-20261010','TEST') returning * into invoice;
 return to_jsonb(invoice);
end $$;
revoke all on function public.amcinova_create_test_topup(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.amcinova_create_test_topup(uuid,uuid,text,integer) to service_role;

create function public.amcinova_complete_test_topup(p_user uuid,p_id uuid,p_payment text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invoice public.amcinova_test_credit_payments; lease public.amcinova_customer_access; credit uuid; used integer;
begin
 select * into invoice from public.amcinova_test_credit_payments where id=p_id and user_id=p_user for update;
 if not found or invoice.payment_id is distinct from p_payment then raise exception 'Test payment mismatch'; end if;
 -- Replay never replenishes a consumed grant or extends its lifetime.
 if invoice.grant_id is not null then return invoice.grant_id; end if;
 perform pg_advisory_xact_lock(hashtextextended('test-access:'||p_user::text||':'||invoice.product_code,0));
 select * into lease from public.amcinova_customer_access where user_id=p_user and product_code=invoice.product_code for update;
 if not found or lease.source<>'trial' or lease.status<>'active' or lease.expires_at is null or lease.expires_at<=now() then raise exception 'No active test lease'; end if;
 select coalesce(sum(units),0) into used from public.amcinova_test_credit_payments where user_id=p_user and product_code=invoice.product_code and grant_id is not null;
 if used+invoice.units>100 then raise exception 'Test topup cap reached'; end if;
 credit:=public.amcinova_credit_grant(p_user,invoice.product_code,invoice.units,'test','TEST-topup:'||p_payment,lease.expires_at);
 update public.amcinova_test_credit_payments set grant_id=credit where id=p_id;
 return credit;
end $$;
revoke all on function public.amcinova_complete_test_topup(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.amcinova_complete_test_topup(uuid,uuid,text) to service_role;

-- End a trial without deleting customer documents or altering paid/manual access.
create function public.amcinova_cancel_own_trial(p_user uuid,p_product text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare lease public.amcinova_customer_access;
begin
 perform pg_advisory_xact_lock(hashtextextended('test-access:'||p_user::text||':'||p_product,0));
 select * into lease from public.amcinova_customer_access where user_id=p_user and product_code=p_product for update;
 if not found or lease.source<>'trial' then raise exception 'Only a test trial may be canceled'; end if;
 update public.amcinova_customer_access set status='revoked' where user_id=p_user and product_code=p_product and source='trial';
 update public.amcinova_ai_credit_grants set expires_at=least(coalesce(expires_at,now()),now()) where user_id=p_user and product_code=p_product and source='test';
 return jsonb_build_object('status','canceled','mode','test','documentsPreserved',true,'automaticDebit',false);
end $$;
revoke all on function public.amcinova_cancel_own_trial(uuid,text) from public,anon,authenticated;
grant execute on function public.amcinova_cancel_own_trial(uuid,text) to service_role;

create table public.amcinova_test_services(
 user_id uuid not null references auth.users(id),product_code text not null references public.amcinova_products(code),
 period_end timestamptz not null,cancel_at_period_end boolean not null default false,
 canceled_at timestamptz,mode text not null default 'test' check(mode='test'),
 primary key(user_id,product_code)
);
alter table public.amcinova_test_services enable row level security;
revoke all on public.amcinova_test_services from public,anon,authenticated;
grant select on public.amcinova_test_services to authenticated;
grant all on public.amcinova_test_services to service_role;
create policy own_test_services on public.amcinova_test_services for select to authenticated using(user_id=auth.uid());
create function public.amcinova_test_service(p_user uuid,p_product text,p_cancel boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare lease public.amcinova_customer_access; service public.amcinova_test_services;
begin
 perform pg_advisory_xact_lock(hashtextextended('test-access:'||p_user::text||':'||p_product,0));
 select * into service from public.amcinova_test_services where user_id=p_user and product_code=p_product for update;
 if not found then
  select * into lease from public.amcinova_customer_access where user_id=p_user and product_code=p_product;
  if not found or lease.source<>'trial' or lease.status<>'active' or lease.expires_at<=now() or lease.expires_at is null then raise exception 'No active test lease'; end if;
  insert into public.amcinova_test_services(user_id,product_code,period_end) values(p_user,p_product,lease.expires_at) returning * into service;
 end if;
 if p_cancel and not service.cancel_at_period_end then
  update public.amcinova_test_services set cancel_at_period_end=true,canceled_at=now() where user_id=p_user and product_code=p_product returning * into service;
 end if;
 -- No renewal, mandate, real contract, or access changes; period_end is immutable.
 return to_jsonb(service)||jsonb_build_object('automaticDebit',false,'commercialSubscription',false);
end $$;
revoke all on function public.amcinova_test_service(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.amcinova_test_service(uuid,text,boolean) to service_role;
-- Append inside the migration transaction, replacing its COMMIT with this check.
-- Every schema change and every fictitious record is rolled back.
select set_config('amcinova.check_user',gen_random_uuid()::text,true);
select set_config('amcinova.check_other',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('amcinova.check_user')::uuid,'TEST-completion-'||current_setting('amcinova.check_user')||'@example.invalid');
insert into auth.users(id,email) values(current_setting('amcinova.check_other')::uuid,'TEST-other-'||current_setting('amcinova.check_other')||'@example.invalid');
insert into public.amcinova_test_credit_payments(id,user_id,product_code,units,amount_cents,currency,policy,status)
values(gen_random_uuid(),current_setting('amcinova.check_other')::uuid,'campaign',25,1089,'EUR','test-topup-20261010','TEST');
insert into public.amcinova_test_services(user_id,product_code,period_end)
values(current_setting('amcinova.check_other')::uuid,'campaign',now()+interval '7 days');
do $$
declare u uuid:=current_setting('amcinova.check_user')::uuid; p text; g uuid; i uuid:=gen_random_uuid(); e timestamptz; result jsonb;
begin
 foreach p in array array['sitebuilder','offertetool','planner','shophulp','campaign','admaker','promotie'] loop
  result:=public.amcinova_activate_test_access(u,p,'tr_TESTComplete');
  if result->>'status'<>'trial' or (result->>'credits')::integer<>5 then raise exception 'Missing bounded trial'; end if;
  e:=(result->>'expiresAt')::timestamptz;
  result:=public.amcinova_activate_test_access(u,p,'tr_TESTReplay');
  if result->>'status'<>'already-created' or (result->>'expiresAt')::timestamptz<>e then raise exception 'Trial replay reset'; end if;
 end loop;
 result:=public.amcinova_create_test_topup(u,i,'admaker',25);
 if (result->>'amount_cents')::integer<>1089 then raise exception 'Invoice price mismatch'; end if;
 result:=public.amcinova_create_test_topup(u,i,'admaker',25);
 begin
  perform public.amcinova_create_test_topup(u,gen_random_uuid(),'admaker',100);raise exception 'FAIL invoice cap accepted';
 exception when others then if sqlerrm<>'Test request cap reached' then raise; end if; end;
 begin
  perform public.amcinova_create_test_topup(current_setting('amcinova.check_other')::uuid,i,'admaker',25);raise exception 'FAIL invoice owner accepted';
 exception when others then if sqlerrm<>'Request already bound' then raise; end if; end;
 i:=gen_random_uuid();
 insert into public.amcinova_test_credit_payments(id,user_id,product_code,units,amount_cents,currency,policy,status,payment_id)
 values(i,u,'campaign',100,3509,'EUR','test-topup-20261010','TEST','tr_TESTTopup');
 g:=public.amcinova_complete_test_topup(u,i,'tr_TESTTopup');
 if public.amcinova_complete_test_topup(u,i,'tr_TESTTopup')<>g then raise exception 'Topup replay duplicated'; end if;
 if (select sum(units) from public.amcinova_ai_credit_grants where user_id=u and product_code='campaign')<>105 then raise exception 'Wrong topup balance'; end if;
 begin
  perform public.amcinova_complete_test_topup(u,i,'tr_OTHER');raise exception 'FAIL wrong payment accepted';
 exception when others then if sqlerrm<>'Test payment mismatch' then raise; end if; end;
 i:=gen_random_uuid();
 insert into public.amcinova_test_credit_payments(id,user_id,product_code,units,amount_cents,currency,policy,status,payment_id)
 values(i,u,'campaign',25,1089,'EUR','test-topup-20261010','TEST','tr_TESTCap');
 begin
  perform public.amcinova_complete_test_topup(u,i,'tr_TESTCap');raise exception 'FAIL cap accepted';
 exception when others then if sqlerrm<>'Test topup cap reached' then raise; end if; end;
 select expires_at into e from public.amcinova_customer_access where user_id=u and product_code='promotie';
 result:=public.amcinova_test_service(u,'promotie',false);
 result:=public.amcinova_test_service(u,'promotie',true);
 if not (result->>'cancel_at_period_end')::boolean or (result->>'period_end')::timestamptz<>e then raise exception 'Cancellation changed period'; end if;
 result:=public.amcinova_test_service(u,'promotie',false);
 if not (result->>'cancel_at_period_end')::boolean then raise exception 'Replay undid cancellation'; end if;
 if (select status from public.amcinova_customer_access where user_id=u and product_code='promotie')<>'active' then raise exception 'Period cancellation removed access early'; end if;
 perform public.amcinova_cancel_own_trial(u,'campaign');
 if exists(select 1 from public.amcinova_ai_credit_grants where user_id=u and product_code='campaign' and expires_at>now()) then raise exception 'Canceled trial has usable credits'; end if;
 if has_function_privilege('authenticated','public.amcinova_complete_test_topup(uuid,uuid,text)','execute') or has_function_privilege('anon','public.amcinova_test_service(uuid,text,boolean)','execute') then raise exception 'Customer can grant service/credits'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('amcinova.check_user'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.amcinova_test_credit_payments where user_id<>current_setting('amcinova.check_user')::uuid) then raise exception 'Topup RLS leaks'; end if;
 if (select count(*) from public.amcinova_test_credit_payments)<>3 then raise exception 'Own topup hidden or another owner exposed'; end if;
 if (select count(*) from public.amcinova_test_services)<>1 then raise exception 'Service RLS broken'; end if;
end $$;
reset role;
rollback;
select 'Geslaagd: toegang, bijkoop, opzeggen en accountscheiding' as controle,
 to_regclass('public.amcinova_test_credit_payments') is null and to_regclass('public.amcinova_test_services') is null as volledig_teruggedraaid;
