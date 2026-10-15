begin;
create table public.amcinova_meta_states (
 state_hash text primary key, binding_hash text,
 tenant_id uuid not null references auth.users(id) on delete cascade,
 product text not null check(product in ('campaign','admaker','promotie')),
 expires_at timestamptz not null
);
create index on public.amcinova_meta_states(expires_at);
create table public.amcinova_meta_grants (
 tenant_id uuid primary key references auth.users(id) on delete cascade,
 token_cipher text not null, expires_at timestamptz not null
);
create table public.amcinova_meta_connections (
 page_id text primary key check(page_id ~ '^[0-9]{1,40}$'),
 tenant_id uuid not null references auth.users(id) on delete cascade,
 page_name text not null, token_cipher text not null, attempt text not null,
 status text not null check(status in ('pending','connected','disconnected'))
);
create index on public.amcinova_meta_connections(tenant_id);
alter table public.amcinova_meta_states enable row level security;
alter table public.amcinova_meta_grants enable row level security;
alter table public.amcinova_meta_connections enable row level security;
revoke all on public.amcinova_meta_states,public.amcinova_meta_grants,public.amcinova_meta_connections from public,anon,authenticated;
grant select,insert,update,delete on public.amcinova_meta_states,public.amcinova_meta_grants,public.amcinova_meta_connections to service_role;
commit;
