begin;
create table if not exists public.amcinova_meta_reply_contexts (
 reply_key text primary key check(reply_key ~ '^[a-f0-9]{64}$'),
 tenant_id uuid not null references auth.users(id) on delete cascade,
 page_id text not null references public.amcinova_meta_connections(page_id) on delete cascade,
 context_cipher text not null,
 message_at timestamptz not null,
 expires_at timestamptz not null,
 check(expires_at = message_at + interval '24 hours')
);
create index if not exists amcinova_meta_reply_owner on public.amcinova_meta_reply_contexts(tenant_id,page_id,message_at desc);
create index if not exists amcinova_meta_reply_expiry on public.amcinova_meta_reply_contexts(expires_at);
alter table public.amcinova_meta_reply_contexts enable row level security;
revoke all on public.amcinova_meta_reply_contexts from public,anon,authenticated;
grant select,insert,delete on public.amcinova_meta_reply_contexts to service_role;
commit;
