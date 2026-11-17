begin;
create or replace function public.amcinova_delete_test_invoice(p_archive_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  target public.amcinova_customer_documents%rowtype;
  affected integer;
begin
  select d.* into target
  from public.amcinova_invoice_pdf_archive a
  join public.amcinova_customer_documents d on d.id = a.document_id
  where a.id = p_archive_id
    and a.invoice_number ~ '^TEST-FACTUUR-[0-9]{8}-[0-9]{2,}$'
    and a.invoice_number = d.payload #>> '{values,quoteNumber}'
    and d.product_code = 'offertetool'
    and (d.payload #>> '{values,quoteDocumentType}' = 'invoice'
      or coalesce(d.payload #>> '{values,drawingCorners}', '') ~ '"type"[[:space:]]*:[[:space:]]*"invoice"')
    and d.name ~ '^TEST .+ — niet versturen$'
    and a.filename = d.name || '.pdf'
    and not exists (
      select 1 from public.amcinova_customer_documents other
      where other.user_id = d.user_id and other.product_code = d.product_code
        and other.project_id = d.project_id and other.id <> d.id
    )
  for update of a,d;
  if not found then return false; end if;
  delete from public.amcinova_invoice_pdf_archive where id=p_archive_id and document_id=target.id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Test-PDF kon niet veilig worden verwijderd'; end if;
  delete from public.amcinova_customer_documents where id=target.id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Testfactuur kon niet veilig worden verwijderd'; end if;
  return true;
end $$;
revoke all on function public.amcinova_delete_test_invoice(uuid) from public, anon, authenticated;
grant execute on function public.amcinova_delete_test_invoice(uuid) to service_role;
commit;
