begin;
create table if not exists public.amcinova_invoice_pdf_archive (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique check (length(invoice_number) between 1 and 60),
  filename text not null check (length(filename) between 5 and 180),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  pdf_base64 text not null check (length(pdf_base64) between 8 and 2796204),
  created_at timestamptz not null default now()
);
alter table public.amcinova_invoice_pdf_archive enable row level security;
revoke all on public.amcinova_invoice_pdf_archive from public, anon, authenticated;
grant select, insert on public.amcinova_invoice_pdf_archive to service_role;
commit;
