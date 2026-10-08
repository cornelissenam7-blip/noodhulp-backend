-- Execute as database owner AFTER migration. Everything is rolled back.
-- This verifies SQL semantics/RLS, not simultaneous requests on separate connections.
begin;
select set_config('amcinova.test_alice',gen_random_uuid()::text,true);
select set_config('amcinova.test_bob',gen_random_uuid()::text,true);
insert into auth.users(id,email) values
 (current_setting('amcinova.test_alice')::uuid,'TEST-ai-alice-'||current_setting('amcinova.test_alice')||'@example.invalid'),
 (current_setting('amcinova.test_bob')::uuid,'TEST-ai-bob-'||current_setting('amcinova.test_bob')||'@example.invalid');
do $$
declare a uuid:=current_setting('amcinova.test_alice')::uuid;
 b uuid:=current_setting('amcinova.test_bob')::uuid;
 r uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); g uuid; remaining_units integer;
begin
 g:=amcinova_credit_grant(a,'sitebuilder',1,'test','TEST-once-'||a,null);
 if amcinova_credit_grant(a,'sitebuilder',1,'test','TEST-once-'||a,null)<>g then raise exception 'Duplicate grant'; end if;
 if not amcinova_credit_reserve(a,'sitebuilder',r) then raise exception 'Reservation failed'; end if;
 if amcinova_credit_reserve(a,'sitebuilder',gen_random_uuid()) then raise exception 'Overspend'; end if;
 if not amcinova_credit_complete(r) or not amcinova_credit_complete(r) then raise exception 'Completion not idempotent'; end if;
 if amcinova_credit_refund(r) then raise exception 'Consumed request was refunded'; end if;
 perform amcinova_credit_grant(a,'sitebuilder',1,'test','TEST-refund-'||a,null);
 if not amcinova_credit_reserve(a,'sitebuilder',f) then raise exception 'Refund reservation failed'; end if;
 if not amcinova_credit_refund(f) or amcinova_credit_refund(f) then raise exception 'Refund not exact once'; end if;
 perform amcinova_credit_grant(b,'sitebuilder',100,'test','TEST-other-'||b,null);
 perform amcinova_credit_grant(a,'offertetool',100,'test','TEST-expired-'||a,now()-interval '1 day');
 if amcinova_credit_reserve(a,'offertetool',gen_random_uuid()) then raise exception 'Expired grant spent'; end if;
 if has_function_privilege('authenticated','public.amcinova_credit_grant(uuid,text,integer,text,text,timestamp with time zone)','execute') then raise exception 'Customer can grant'; end if;
 if has_function_privilege('anon','public.amcinova_credit_reserve(uuid,text,uuid)','execute') then raise exception 'Anonymous can reserve'; end if;
 select sum(remaining) into remaining_units from amcinova_ai_credit_grants where user_id=a and product_code='sitebuilder';
 if remaining_units<>1 then raise exception 'Incorrect balance'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('amcinova.test_alice'),true);
set local role authenticated;
do $$
begin
 if exists(select 1 from public.amcinova_ai_credit_grants where user_id<>current_setting('amcinova.test_alice')::uuid) then raise exception 'RLS leaked grants'; end if;
 if (select count(*) from public.amcinova_ai_credit_grants)<>3 then raise exception 'Own grants missing'; end if;
 if exists(select 1 from public.amcinova_ai_credit_usage where user_id<>current_setting('amcinova.test_alice')::uuid) then raise exception 'RLS leaked usage'; end if;
end $$;
reset role;
rollback;
