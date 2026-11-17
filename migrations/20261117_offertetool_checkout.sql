begin;
create table public.amcinova_offertetool_orders (
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 mode text not null check (mode in ('test','live')),
 payment_id text unique check (payment_id ~ '^tr_[A-Za-z0-9]{1,80}$'),
 created_at timestamptz not null default now()
);
alter table public.amcinova_offertetool_orders enable row level security;
revoke all on public.amcinova_offertetool_orders from public, anon, authenticated;
grant select, insert, update on public.amcinova_offertetool_orders to service_role;

create function public.amcinova_activate_offertetool(p_order uuid, p_payment text)
returns uuid language plpgsql security definer set search_path = public as $$
declare owner_id uuid; purchase_id uuid; previous public.amcinova_customer_purchases%rowtype;
begin
 select user_id into strict owner_id from public.amcinova_offertetool_orders
 where id = p_order and mode = 'live' and payment_id = p_payment for update;
 select * into previous from public.amcinova_customer_purchases where provider_payment_id = p_payment;
 if found then
  if previous.user_id <> owner_id or previous.product_code <> 'offertetool'
   or previous.amount_cents <> 24079 or previous.currency <> 'EUR'
   or previous.status <> 'paid' or previous.verified_at is null then
   raise exception 'Inconsistent Offertetool purchase';
  end if;
  return previous.id;
 end if;
 insert into public.amcinova_customer_purchases(user_id, product_code, provider_payment_id, status, amount_cents, currency, verified_at)
 values (owner_id, 'offertetool', p_payment, 'paid', 24079, 'EUR', now()) returning id into purchase_id;
 insert into public.amcinova_customer_access(user_id, product_code, status, source, purchase_id, expires_at)
 values (owner_id, 'offertetool', 'active', 'purchase', purchase_id, null)
 on conflict (user_id, product_code) do update
 set status = 'active', source = 'purchase', purchase_id = excluded.purchase_id, expires_at = null;
 return purchase_id;
end $$;
revoke all on function public.amcinova_activate_offertetool(uuid,text) from public, anon, authenticated;
grant execute on function public.amcinova_activate_offertetool(uuid,text) to service_role;
commit;
