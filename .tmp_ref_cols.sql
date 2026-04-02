select c.relname as table_name, a.attname as column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('cash_transactions','bank_transactions')
  and a.attname in ('ref_type','ref_id')
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attname;
