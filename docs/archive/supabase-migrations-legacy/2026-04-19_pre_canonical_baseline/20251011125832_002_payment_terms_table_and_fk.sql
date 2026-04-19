-- Create payment_terms (per-company)
CREATE TABLE IF NOT EXISTS public.payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  name text NOT NULL,
  net_days integer NOT NULL CHECK (net_days >= 0),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

ALTER TABLE public.payment_terms ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  BEGIN
    CREATE POLICY payment_terms_select ON public.payment_terms
      FOR SELECT USING (company_id = current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY payment_terms_insert ON public.payment_terms
      FOR INSERT WITH CHECK (company_id = current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY payment_terms_update ON public.payment_terms
      FOR UPDATE USING (company_id = current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Add FK columns referencing payment_terms, but keep existing text columns for backward compatibility
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_terms_id uuid REFERENCES public.payment_terms(id);
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS payment_terms_id uuid REFERENCES public.payment_terms(id);
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS payment_terms_id uuid REFERENCES public.payment_terms(id);
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS payment_terms_id uuid REFERENCES public.payment_terms(id);

-- New due_date on sales_orders (header-level)
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS due_date date;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS sales_orders_company_due_idx ON public.sales_orders (company_id, due_date);
CREATE INDEX IF NOT EXISTS payment_terms_company_code_idx ON public.payment_terms (company_id, code);;
