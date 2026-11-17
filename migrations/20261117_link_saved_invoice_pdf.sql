begin;
alter table public.amcinova_invoice_pdf_archive
  add column if not exists document_id uuid references public.amcinova_customer_documents(id);
commit;
