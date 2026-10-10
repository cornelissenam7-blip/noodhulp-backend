-- Run AFTER migration as database owner. Test fixtures are rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); result jsonb; expiry timestamptz;
begin
 insert into auth.users(id,email) values(u,'TEST-trial-'||u||'@example.invalid'),(v,'TEST-existing-'||v||'@example.invalid');
 result:=public.amcinova_activate_test_access(u,'sitebuilder','tr_TEST123');
 if result->>'status'<>'trial' then raise exception 'Trial missing'; end if;
 select expires_at into expiry from public.amcinova_customer_access where user_id=u and product_code='sitebuilder';
 perform public.amcinova_activate_test_access(u,'sitebuilder','tr_TEST456');
 if (select count(*) from public.amcinova_ai_credit_grants where user_id=u)<>1 then raise exception 'Duplicate credit'; end if;
 if (select remaining from public.amcinova_ai_credit_grants where user_id=u)<>5 then raise exception 'Incorrect quota'; end if;
 if (select expires_at from public.amcinova_customer_access where user_id=u)<>expiry then raise exception 'Lease extended'; end if;
 insert into public.amcinova_customer_access(user_id,product_code,status,source) values(v,'sitebuilder','active','manual');
 perform public.amcinova_activate_test_access(v,'sitebuilder','tr_TEST789');
 if exists(select 1 from public.amcinova_ai_credit_grants where user_id=v) then raise exception 'Existing access changed'; end if;
 perform public.amcinova_revoke_test_access(u,'sitebuilder');
 if (select status from public.amcinova_customer_access where user_id=u)<>'revoked' then raise exception 'Revocation failed'; end if;
 if public.amcinova_credit_reserve(u,'sitebuilder',gen_random_uuid()) then raise exception 'Expired credit usable'; end if;
 perform public.amcinova_activate_test_access(u,'sitebuilder','tr_TEST999');
 if (select status from public.amcinova_customer_access where user_id=u)<>'revoked' then raise exception 'Replay revived trial'; end if;
 if has_function_privilege('authenticated','public.amcinova_activate_test_access(uuid,text,text)','execute') then raise exception 'Customer can activate'; end if;
 if has_function_privilege('anon','public.amcinova_revoke_test_access(uuid,text)','execute') then raise exception 'Anon can revoke'; end if;
end $$;
rollback;
