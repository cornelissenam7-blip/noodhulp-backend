begin;
create or replace function public.amcinova_delete_online_quote(p_latest_id uuid)
returns integer
language sql
set search_path = ''
as $$
  with selected as (
    select d.user_id, d.project_id, d.revision
    from public.amcinova_customer_documents d
    where d.id = p_latest_id and d.product_code = 'offertetool'
      and not (d.payload ?| array['numberReservation','tracking','publication','materialLibrary'])
  ), deleted as (
    delete from public.amcinova_customer_documents d
    using selected s
    where d.user_id = s.user_id and d.project_id = s.project_id
      and d.product_code = 'offertetool' and d.revision <= s.revision
      and not (d.payload ?| array['numberReservation','tracking','publication','materialLibrary'])
      and not exists (
        select 1 from public.amcinova_customer_documents invoice
        where invoice.user_id = s.user_id and invoice.project_id = s.project_id
          and invoice.product_code = 'offertetool'
          and (invoice.payload #>> '{values,quoteDocumentType}' = 'invoice'
            or coalesce(invoice.payload #>> '{values,drawingCorners}', '') ~ '"type"[[:space:]]*:[[:space:]]*"invoice"')
      )
      and not exists (
        select 1 from public.amcinova_customer_documents newer
        where newer.user_id = s.user_id and newer.project_id = s.project_id
          and newer.product_code = 'offertetool' and newer.revision > s.revision
          and not (newer.payload ?| array['numberReservation','tracking','publication','materialLibrary'])
      )
    returning d.id
  )
  select count(*)::integer from deleted;
$$;
revoke all on function public.amcinova_delete_online_quote(uuid) from public, anon, authenticated;
grant execute on function public.amcinova_delete_online_quote(uuid) to service_role;
commit;
