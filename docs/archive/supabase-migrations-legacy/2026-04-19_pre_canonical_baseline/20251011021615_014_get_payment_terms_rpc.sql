-- Security-definer RPC to fetch payment terms for a company without requiring client-side claims
CREATE OR REPLACE FUNCTION public.get_payment_terms(p_company_id uuid)
RETURNS TABLE(id uuid, code text, name text, net_days integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public AS $$
  SELECT pt.id, pt.code, pt.name, pt.net_days
  FROM public.payment_terms pt
  WHERE pt.company_id = p_company_id
    AND ( public.is_member(p_company_id) OR p_company_id = public.current_company_id() )
  ORDER BY pt.net_days ASC, pt.code ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_payment_terms(uuid) TO anon, authenticated;
;
