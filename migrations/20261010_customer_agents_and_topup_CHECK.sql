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
