ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS ref_type text;

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS ref_id uuid;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_ref_type_ref_id
  ON public.bank_transactions (ref_type, ref_id);
