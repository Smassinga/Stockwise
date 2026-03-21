begin;
-- Recreate suppliers_view to expose paymentTermsId (uuid) instead of paymentTerms (text)
-- and keep the shape expected by the front-end.
DROP VIEW IF EXISTS public.suppliers_view;
CREATE VIEW public.suppliers_view AS
SELECT
  s.id,
  s.company_id,
  s.code,
  s.name,
  s.contact_name  AS "contactName",
  s.email,
  s.phone,
  s.tax_id        AS "taxId",
  s.currency_code AS "currencyId",
  s.payment_terms_id AS "paymentTermsId",
  s.is_active     AS "isActive",
  s.notes,
  s.created_at    AS "createdAt",
  s.updated_at    AS "updatedAt"
FROM public.suppliers s;
COMMENT ON VIEW public.suppliers_view IS 'UI projection for suppliers page v2 (uuid payment_terms_id).';
commit;;
