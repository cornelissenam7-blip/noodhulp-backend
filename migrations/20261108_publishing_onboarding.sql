begin;
alter table public.amcinova_meta_connections add column if not exists publishing_token_cipher text;
alter table public.amcinova_meta_connections drop constraint if exists amcinova_meta_connections_status_check;
alter table public.amcinova_meta_connections add constraint amcinova_meta_connections_status_check check(status in ('pending','connected','disconnected','publishing'));
comment on column public.amcinova_meta_connections.publishing_token_cipher is 'Encrypted publication token, separate from existing Messenger token. publishing status does not enable message routing.';
commit;
