-- PREPARED ONLY. Do not apply until launch policy, billing lifecycle and checkout are approved.
-- Only a verified server-side live payment may call this function.
-- SQL cannot contact Mollie; caller must re-fetch provider payment and verify owner/amount/mode.
begin;
create or replace function public.amcinova_activate_verified_purchase(
 p_user uuid,p_product text,p_payment text,p_amount integer,p_units integer,p_policy text
) returns uuid language plpgsql security definer set search_path=public as $$
declare purchase_id uuid; previous public.amcinova_customer_purchases%rowtype;
begin
 if p_product not in ('sitebuilder','offertetool') or p_units<>case when p_product='sitebuilder' then 20 else 50 end
 or p_policy<>'draft-20261010' or p_amount<=0 or p_payment!~'^tr_[A-Za-z0-9]+$' then
  raise exception 'Invalid verified purchase policy';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_payment,0));
 select * into previous from public.amcinova_customer_purchases where provider_payment_id=p_payment;
 if found then
  if previous.user_id<>p_user or previous.product_code<>p_product or previous.amount_cents<>p_amount or previous.currency<>'EUR'
   or previous.status<>'paid' or previous.verified_at is null then raise exception 'Payment already bound or not paid'; end if;
  return previous.id; -- Already completed atomically: no access/credit resets on replay.
 end if;
 insert into public.amcinova_customer_purchases(user_id,product_code,provider_payment_id,status,amount_cents,currency,verified_at)
 values(p_user,p_product,p_payment,'paid',p_amount,'EUR',now()) returning id into purchase_id;
 insert into public.amcinova_customer_access(user_id,product_code,status,source,purchase_id,expires_at)
 values(p_user,p_product,'active','purchase',purchase_id,null)
 on conflict(user_id,product_code) do update set status='active',source='purchase',purchase_id=excluded.purchase_id,expires_at=null;
 perform public.amcinova_credit_grant(p_user,p_product,p_units,'included','purchase:'||p_payment,now()+interval '365 days');
 return purchase_id;
end $$;
revoke all on function public.amcinova_activate_verified_purchase(uuid,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.amcinova_activate_verified_purchase(uuid,text,text,integer,integer,text) to service_role;
commit;
