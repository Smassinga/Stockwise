alter table public.cash_transactions
  drop constraint if exists cash_transactions_ref_type_check;

alter table public.cash_transactions
  add constraint cash_transactions_ref_type_check
  check (
    ref_type = any (
      array[
        'SO'::text,
        'PO'::text,
        'SI'::text,
        'VB'::text,
        'ADJ'::text
      ]
    )
  );
