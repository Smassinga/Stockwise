-- Controlled retained QA data for the existing Leny Doçuras tenant only.
-- Fresh canonical replay is a no-op because it contains no auth/company business data.
-- The target is resolved by natural identity, never by a generated company id.
do $$
declare
  v_company uuid;
  v_company_count integer;
  v_owner_email text := 'edilene.costamz@gmail.com';
  v_actor uuid;
  v_net30 uuid;
  v_net15 uuid;
  v_net7 uuid;
  v_cod uuid;
  v_wh_casa uuid;
  v_wh_loja uuid;
  v_product uuid;
  v_bom uuid;
begin
  select count(*), min(c.id)
    into v_company_count, v_company
  from public.companies c
  join auth.users u on u.id = c.owner_user_id
  where c.name = 'Leny Doçuras'
    and lower(u.email) = v_owner_email;

  if v_company_count = 0 then
    raise notice 'Leny Doçuras QA tenant not present; retained-data seed skipped.';
    return;
  end if;
  if v_company_count <> 1 then
    raise exception 'Leny Doçuras QA tenant is ambiguous; seed aborted.';
  end if;

  select cm.user_id into v_actor
  from public.company_members cm
  join auth.users u on u.id = cm.user_id
  where cm.company_id = v_company
    and lower(u.email) = 'massingasamuel@hotmail.com'
    and cm.status = 'active'
  order by case cm.role when 'OWNER' then 1 when 'ADMIN' then 2 else 3 end
  limit 1;

  if v_actor is null then
    raise exception 'Authorised Leny QA operator is not an active member; seed aborted.';
  end if;

  select id into v_net30 from public.payment_terms where company_id=v_company and code='NET30';
  select id into v_net15 from public.payment_terms where company_id=v_company and code='NET15';
  select id into v_net7  from public.payment_terms where company_id=v_company and code='NET7';
  select id into v_cod   from public.payment_terms where company_id=v_company and code='COD';

  if v_net30 is null or v_net15 is null or v_net7 is null or v_cod is null then
    raise exception 'Leny payment-term prerequisites are incomplete; seed aborted.';
  end if;

  insert into public.customers
    (company_id,code,name,email,billing_address,shipping_address,currency_code,payment_terms,payment_terms_id,notes,created_at,updated_at)
  values
    (v_company,'CUS001','Samuel Massinga Eventos','massingasamuel@hotmail.com','Beira, Sofala, Mozambique','Beira, Sofala, Mozambique','MZN','Net 30 days',v_net30,'Cliente corporativo para encomendas e validação controlada de lembretes',timestamptz '2026-05-26 08:00:00+02',timestamptz '2026-05-26 08:00:00+02'),
    (v_company,'CUS002','Café Macuti',null,'Macuti, Beira, Sofala','Macuti, Beira, Sofala','MZN','Net 15 days',v_net15,'Café e revenda local',timestamptz '2026-05-26 08:05:00+02',timestamptz '2026-05-26 08:05:00+02'),
    (v_company,'CUS003','Hotel Beira Sol',null,'Ponta-Gêa, Beira, Sofala','Ponta-Gêa, Beira, Sofala','MZN','Net 30 days',v_net30,'Hotelaria e eventos',timestamptz '2026-05-26 08:10:00+02',timestamptz '2026-05-26 08:10:00+02'),
    (v_company,'CUS004','Escola Horizonte',null,'Manga, Beira, Sofala','Manga, Beira, Sofala','MZN','Net 30 days',v_net30,'Encomendas para reuniões e eventos escolares',timestamptz '2026-05-26 08:15:00+02',timestamptz '2026-05-26 08:15:00+02'),
    (v_company,'CUS005','Clínica Ponta-Gêa',null,'Ponta-Gêa, Beira, Sofala','Ponta-Gêa, Beira, Sofala','MZN','Net 30 days',v_net30,'Encomendas institucionais',timestamptz '2026-05-26 08:20:00+02',timestamptz '2026-05-26 08:20:00+02'),
    (v_company,'CUS006','Eventos Sofala',null,'Munhava, Beira, Sofala','Munhava, Beira, Sofala','MZN','Net 15 days',v_net15,'Eventos e catering',timestamptz '2026-05-26 08:25:00+02',timestamptz '2026-05-26 08:25:00+02')
  on conflict (company_id,code) do update set
    name=excluded.name,
    email=excluded.email,
    billing_address=excluded.billing_address,
    shipping_address=excluded.shipping_address,
    currency_code=excluded.currency_code,
    payment_terms_id=excluded.payment_terms_id,
    notes=excluded.notes,
    updated_at=excluded.updated_at;

  insert into public.suppliers
    (company_id,code,name,contact_name,email,currency_code,payment_terms,payment_terms_id,is_active,notes,created_at,updated_at)
  values
    (v_company,'SUP001','VIP SPAR Mozambique','Compras',null,'MZN','COD',v_cod,true,'Mercearia e lacticínios',timestamptz '2026-05-26 09:00:00+02',timestamptz '2026-05-26 09:00:00+02'),
    (v_company,'SUP002','Cestinho MZ','Confeitaria',null,'MZN','COD',v_cod,true,'Artigos e ingredientes de confeitaria',timestamptz '2026-05-26 09:05:00+02',timestamptz '2026-05-26 09:05:00+02'),
    (v_company,'SUP003','Mercado do Maquinino','Compras',null,'MZN','COD',v_cod,true,'Compras locais de frescos',timestamptz '2026-05-26 09:10:00+02',timestamptz '2026-05-26 09:10:00+02'),
    (v_company,'SUP004','Distribuidora Beira Alimentos','Vendas',null,'MZN','Net 15 days',v_net15,true,'Ingredientes secos e bebidas',timestamptz '2026-05-26 09:15:00+02',timestamptz '2026-05-26 09:15:00+02'),
    (v_company,'SUP005','Embalagens Sofala','Vendas',null,'MZN','Net 30 days',v_net30,true,'Caixas e consumíveis de embalagem',timestamptz '2026-05-26 09:20:00+02',timestamptz '2026-05-26 09:20:00+02'),
    (v_company,'SUP006','Frescos da Beira','Compras',null,'MZN','Net 7 days',v_net7,true,'Ovos e lacticínios',timestamptz '2026-05-26 09:25:00+02',timestamptz '2026-05-26 09:25:00+02'),
    (v_company,'SUP007','Global Baking Ingredients','Accounts','massingasamuel@gmail.com','USD','Net 30 days',v_net30,true,'Fornecedor de ingredientes importados para validação controlada de AP e câmbio',timestamptz '2026-05-26 09:30:00+02',timestamptz '2026-05-26 09:30:00+02'),
    (v_company,'SUP008','Beira Decor & Festas','Vendas',null,'MZN','Net 15 days',v_net15,true,'Consumíveis de decoração e eventos',timestamptz '2026-05-26 09:35:00+02',timestamptz '2026-05-26 09:35:00+02')
  on conflict (company_id,code) do update set
    name=excluded.name,
    contact_name=excluded.contact_name,
    email=excluded.email,
    currency_code=excluded.currency_code,
    payment_terms_id=excluded.payment_terms_id,
    is_active=true,
    notes=excluded.notes,
    updated_at=excluded.updated_at;

  insert into public.items
    (company_id,sku,name,uom,base_uom_id,unit_price,min_stock,primary_role,track_inventory,can_buy,can_sell,is_assembled,created_at,updated_at)
  select * from (values
    (v_company,'ING-OIL','Óleo vegetal','litre','uom_lt',null::numeric,3::numeric,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:00:00+02',timestamptz '2026-05-26 10:00:00+02'),
    (v_company,'ING-SALT','Sal fino','kilogram','uom_kg',null,1,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:02:00+02',timestamptz '2026-05-26 10:02:00+02'),
    (v_company,'ING-VANILLA','Essência de baunilha','litre','uom_lt',null,.25,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:04:00+02',timestamptz '2026-05-26 10:04:00+02'),
    (v_company,'ING-CORN','Amido de milho','kilogram','uom_kg',null,2,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:06:00+02',timestamptz '2026-05-26 10:06:00+02'),
    (v_company,'ING-COCOA','Cacau em pó','kilogram','uom_kg',null,1,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:08:00+02',timestamptz '2026-05-26 10:08:00+02'),
    (v_company,'ING-CHOC','Chocolate culinário','kilogram','uom_kg',null,1,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:10:00+02',timestamptz '2026-05-26 10:10:00+02'),
    (v_company,'ING-CREAM','Natas para bater','litre','uom_lt',null,1,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:12:00+02',timestamptz '2026-05-26 10:12:00+02'),
    (v_company,'ING-YEAST','Fermento biológico','gram','uom_g',null,250,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:13:00+02',timestamptz '2026-05-26 10:13:00+02'),
    (v_company,'PACK-CAKE','Caixa para bolo','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',null,20,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:14:00+02',timestamptz '2026-05-26 10:14:00+02'),
    (v_company,'PACK-CUP','Caixa para cupcakes','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',null,15,'raw_material',true,true,false,false,timestamptz '2026-05-26 10:16:00+02',timestamptz '2026-05-26 10:16:00+02'),
    (v_company,'RES-WATER','Água mineral 500ml','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',35,24,'resale',true,true,true,false,timestamptz '2026-05-26 10:18:00+02',timestamptz '2026-05-26 10:18:00+02'),
    (v_company,'RES-JUICE','Sumo 1L','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',160,12,'resale',true,true,true,false,timestamptz '2026-05-26 10:20:00+02',timestamptz '2026-05-26 10:20:00+02'),
    (v_company,'RES-SODA','Refrigerante 2L','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',150,12,'resale',true,true,true,false,timestamptz '2026-05-26 10:22:00+02',timestamptz '2026-05-26 10:22:00+02'),
    (v_company,'RES-CANDLE','Velas de aniversário','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',75,10,'resale',true,true,true,false,timestamptz '2026-05-26 10:24:00+02',timestamptz '2026-05-26 10:24:00+02'),
    (v_company,'SVC-DECOR','Decoração personalizada','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',500,0,'service',false,false,true,false,timestamptz '2026-05-26 10:26:00+02',timestamptz '2026-05-26 10:26:00+02'),
    (v_company,'SVC-DELIV','Entrega local','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',250,0,'service',false,false,true,false,timestamptz '2026-05-26 10:28:00+02',timestamptz '2026-05-26 10:28:00+02'),
    (v_company,'SVC-EVENT','Montagem de mesa de sobremesas','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',1500,0,'service',false,false,true,false,timestamptz '2026-05-26 10:30:00+02',timestamptz '2026-05-26 10:30:00+02'),
    (v_company,'FG-BREAD','Pão caseiro','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',70,10,'assembled_product',true,false,true,true,timestamptz '2026-05-26 10:32:00+02',timestamptz '2026-05-26 10:32:00+02'),
    (v_company,'FG-VANILLA','Bolo de baunilha','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',1200,2,'assembled_product',true,false,true,true,timestamptz '2026-05-26 10:34:00+02',timestamptz '2026-05-26 10:34:00+02'),
    (v_company,'FG-CHOC','Bolo de chocolate','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',1600,2,'assembled_product',true,false,true,true,timestamptz '2026-05-26 10:36:00+02',timestamptz '2026-05-26 10:36:00+02'),
    (v_company,'FG-CUP','Cupcake de baunilha','each','6ae319cf-9b68-4224-abfb-cd762dd9caa9',80,24,'assembled_product',true,false,true,true,timestamptz '2026-05-26 10:38:00+02',timestamptz '2026-05-26 10:38:00+02')
  ) as x(company_id,sku,name,uom,base_uom_id,unit_price,min_stock,primary_role,track_inventory,can_buy,can_sell,is_assembled,created_at,updated_at)
  where not exists (
    select 1 from public.items i where i.company_id=x.company_id and i.sku=x.sku
  );

  select id into v_wh_casa from public.warehouses where company_id=v_company and code='WH001' limit 1;
  select id into v_wh_loja from public.warehouses where company_id=v_company and code='CS001' limit 1;
  if v_wh_casa is null or v_wh_loja is null then
    raise exception 'Leny warehouse prerequisites are incomplete; seed aborted.';
  end if;

  insert into public.bins (id,"warehouseId",code,name,status,"createdAt",created_at,company_id)
  select * from (values
    ('leny_raw_materials',v_wh_casa,'MP001','Matérias-primas','active',timestamptz '2026-05-26 11:00:00+02',timestamptz '2026-05-26 11:00:00+02',v_company),
    ('leny_finished_goods',v_wh_casa,'PF001','Produtos acabados','active',timestamptz '2026-05-26 11:05:00+02',timestamptz '2026-05-26 11:05:00+02',v_company),
    ('leny_shop',v_wh_loja,'LOJ001','Loja','active',timestamptz '2026-05-26 11:10:00+02',timestamptz '2026-05-26 11:10:00+02',v_company)
  ) as x(id,warehouse_id,code,name,status,createdAt,created_at,company_id)
  where not exists (
    select 1 from public.bins b where b.company_id=x.company_id and b.code=x.code
  );

  insert into public.bank_accounts (company_id,name,bank_name,account_number,currency_code,account_kind,created_at)
  select * from (values
    (v_company,'Standard Bank Operacional','Standard Bank Moçambique','10000000001','MZN','bank',timestamptz '2026-05-26 12:00:00+02'),
    (v_company,'M-Pesa Loja','Vodacom M-Pesa','841000001','MZN','mobile_wallet',timestamptz '2026-05-26 12:05:00+02'),
    (v_company,'e-Mola Loja','Movitel e-Mola','861000001','MZN','mobile_wallet',timestamptz '2026-05-26 12:10:00+02'),
    (v_company,'mKesh Loja','Tmcel mKesh','821000001','MZN','mobile_wallet',timestamptz '2026-05-26 12:15:00+02')
  ) as x(company_id,name,bank_name,account_number,currency_code,account_kind,created_at)
  where not exists (
    select 1 from public.bank_accounts b where b.company_id=x.company_id and b.name=x.name
  );

  -- Common bakery recipes. Quantities are stored in each component's base UOM.
  -- Vanilla cake is adapted from King Arthur's quick/easy vanilla cake proportions.
  select id into v_product from public.items where company_id=v_company and sku='FG-VANILLA' limit 1;
  insert into public.boms (company_id,product_id,name,version,is_active,assembly_time_per_unit_minutes,setup_time_per_batch_minutes,created_at)
  values (v_company,v_product,'Bolo de baunilha','v1',true,40,15,timestamptz '2026-05-26 13:00:00+02')
  on conflict (company_id,product_id,version) do nothing;
  select id into v_bom from public.boms where company_id=v_company and product_id=v_product and version='v1';
  if not exists (select 1 from public.bom_components where bom_id=v_bom) then
    insert into public.bom_components (bom_id,component_item_id,qty_per,scrap_pct,created_at)
    select v_bom,i.id,x.qty,0,timestamptz '2026-05-26 13:05:00+02'
    from (values
      ('TG001',0.180::numeric),('AR007',0.198),('OV002',1),('LT005',0.227),('MG003',0.057),('ING-CORN',0.028),('FM009',6),('ING-VANILLA',0.010),('PACK-CAKE',1)
    ) x(sku,qty)
    join public.items i on i.company_id=v_company and i.sku=x.sku;
  end if;

  select id into v_product from public.items where company_id=v_company and sku='FG-CHOC' limit 1;
  insert into public.boms (company_id,product_id,name,version,is_active,assembly_time_per_unit_minutes,setup_time_per_batch_minutes,created_at)
  values (v_company,v_product,'Bolo de chocolate','v1',true,45,15,timestamptz '2026-05-26 13:10:00+02')
  on conflict (company_id,product_id,version) do nothing;
  select id into v_bom from public.boms where company_id=v_company and product_id=v_product and version='v1';
  if not exists (select 1 from public.bom_components where bom_id=v_bom) then
    insert into public.bom_components (bom_id,component_item_id,qty_per,scrap_pct,created_at)
    select v_bom,i.id,x.qty,0,timestamptz '2026-05-26 13:15:00+02'
    from (values
      ('TG001',0.200::numeric),('AR007',0.220),('OV002',2),('LT005',0.200),('MG003',0.080),('ING-COCOA',0.050),('FM009',6),('PACK-CAKE',1)
    ) x(sku,qty)
    join public.items i on i.company_id=v_company and i.sku=x.sku;
  end if;

  -- 24-cupcake batch proportions normalised to one cupcake.
  select id into v_product from public.items where company_id=v_company and sku='FG-CUP' limit 1;
  insert into public.boms (company_id,product_id,name,version,is_active,assembly_time_per_unit_minutes,setup_time_per_batch_minutes,created_at)
  values (v_company,v_product,'Cupcake de baunilha','v1',true,3,20,timestamptz '2026-05-26 13:20:00+02')
  on conflict (company_id,product_id,version) do nothing;
  select id into v_bom from public.boms where company_id=v_company and product_id=v_product and version='v1';
  if not exists (select 1 from public.bom_components where bom_id=v_bom) then
    insert into public.bom_components (bom_id,component_item_id,qty_per,scrap_pct,created_at)
    select v_bom,i.id,x.qty,0,timestamptz '2026-05-26 13:25:00+02'
    from (values
      ('TG001',0.01625::numeric),('AR007',0.01655),('OV002',0.166667),('LT005',0.01417),('MG003',0.00708),('FM009',0.5),('ING-VANILLA',0.0006),('PACK-CUP',0.083333)
    ) x(sku,qty)
    join public.items i on i.company_id=v_company and i.sku=x.sku;
  end if;

  -- Two-loaf bread recipe normalised to one loaf; biological yeast is separate from cake baking powder.
  select id into v_product from public.items where company_id=v_company and sku='FG-BREAD' limit 1;
  insert into public.boms (company_id,product_id,name,version,is_active,assembly_time_per_unit_minutes,setup_time_per_batch_minutes,created_at)
  values (v_company,v_product,'Pão caseiro','v1',true,8,30,timestamptz '2026-05-26 13:30:00+02')
  on conflict (company_id,product_id,version) do nothing;
  select id into v_bom from public.boms where company_id=v_company and product_id=v_product and version='v1';
  if not exists (select 1 from public.bom_components where bom_id=v_bom) then
    insert into public.bom_components (bom_id,component_item_id,qty_per,scrap_pct,created_at)
    select v_bom,i.id,x.qty,0,timestamptz '2026-05-26 13:35:00+02'
    from (values
      ('TG001',0.285::numeric),('AR007',0.006),('ING-SALT',0.0075),('ING-YEAST',5.5),('ING-OIL',0.015)
    ) x(sku,qty)
    join public.items i on i.company_id=v_company and i.sku=x.sku;
  end if;

  raise notice 'Leny Doçuras busy-company master data prepared.';
end $$;
