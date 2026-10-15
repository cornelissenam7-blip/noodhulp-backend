-- Apply separately only after approval. No message text, attachments or sender IDs.
create table public.amcinova_social_dm_receipts (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references auth.users(id),
 platform text not null check (platform in ('facebook','instagram')),
 account_id text not null check (account_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 message_id text not null check (octet_length(message_id) between 1 and 1024 and length(btrim(message_id)) > 0 and message_id !~ '[[:cntrl:]]'),
 conversation_key text not null check (conversation_key ~ '^[a-f0-9]{64}$'),
 message_at timestamptz not null,
 received_at timestamptz not null default now(),
 kind text not null default 'inbound_dm' check (kind = 'inbound_dm'),
 qualified_lead boolean not null default false check (qualified_lead = false),
 post_id text check (post_id is null),
 post_evidence text not null default 'unknown' check (post_evidence = 'unknown'),
 unique (tenant_id,platform,account_id,message_id)
);
alter table public.amcinova_social_dm_receipts enable row level security;
revoke all on public.amcinova_social_dm_receipts from public,anon,authenticated;
grant select,insert,delete on public.amcinova_social_dm_receipts to service_role;
