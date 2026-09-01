import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${path}: expected source marker not found`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: source marker is not unique`)
  await writeFile(path, source.replace(before, after))
}

await replaceOnce(
  'src/pages/Customers.tsx',
  "import { useEffect, useMemo, useState } from 'react'",
  "import { useCallback, useEffect, useMemo, useState } from 'react'"
)

await replaceOnce(
  'src/pages/Customers.tsx',
  `  const { t } = useI18n()\n  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>\n    withI18nFallback(t, key, fallback, vars)`,
  `  const { t } = useI18n()\n  const tt = useCallback(\n    (key: string, fallback: string, vars?: Record<string, string | number>) =>\n      withI18nFallback(t, key, fallback, vars),\n    [t]\n  )`
)

await replaceOnce(
  'src/pages/Customers.tsx',
  `  useEffect(() => {\n    ;(async () => {\n      try {\n        setLoading(true)\n\n        const resCur = await supabase.from('currencies').select('code,name').order('code', { ascending: true })\n        if (resCur.error) throw resCur.error\n        setCurrencies((resCur.data || []) as Currency[])\n\n        if (companyId) {\n          const { data: paymentTerms, error: paymentTermsError } = await supabase.rpc('get_payment_terms', {\n            p_company_id: companyId,\n          })\n          if (paymentTermsError) throw paymentTermsError\n          setPaymentTermsList((paymentTerms || []) as PaymentTerm[])\n        } else {\n          setPaymentTermsList([])\n        }\n\n        await reloadCustomers()\n      } catch (e: any) {\n        console.error(e)\n        toast.error(tt('customers.toast.loadFailed', 'Failed to load customers'))\n      } finally {\n        setLoading(false)\n      }\n    })()\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [companyId])\n\n  async function reloadCustomers() {\n    if (!companyId) {\n      setCustomers([])\n      return\n    }\n\n    const res = await supabase\n      .from('customers')\n      .select(\n        'id,code,name,email,phone,tax_id,billing_address,shipping_address,currency_code,payment_terms_id,payment_terms,notes,created_at,updated_at'\n      )\n      .eq('company_id', companyId)\n      .order('name', { ascending: true })\n\n    if (res.error) {\n      console.error(res.error)\n      toast.error(tt('customers.toast.loadFailed', 'Failed to load customers'))\n      return\n    }\n\n    setCustomers((res.data || []).map(mapRow))\n  }`,
  `  const reloadCustomers = useCallback(async () => {\n    if (!companyId) {\n      setCustomers([])\n      return\n    }\n\n    const res = await supabase\n      .from('customers')\n      .select(\n        'id,code,name,email,phone,tax_id,billing_address,shipping_address,currency_code,payment_terms_id,payment_terms,notes,created_at,updated_at'\n      )\n      .eq('company_id', companyId)\n      .order('name', { ascending: true })\n\n    if (res.error) {\n      console.error(res.error)\n      toast.error(tt('customers.toast.loadFailed', 'Failed to load customers'))\n      return\n    }\n\n    setCustomers((res.data || []).map(mapRow))\n  }, [companyId, tt])\n\n  useEffect(() => {\n    ;(async () => {\n      try {\n        setLoading(true)\n\n        const resCur = await supabase.from('currencies').select('code,name').order('code', { ascending: true })\n        if (resCur.error) throw resCur.error\n        setCurrencies((resCur.data || []) as Currency[])\n\n        if (companyId) {\n          const { data: paymentTerms, error: paymentTermsError } = await supabase.rpc('get_payment_terms', {\n            p_company_id: companyId,\n          })\n          if (paymentTermsError) throw paymentTermsError\n          setPaymentTermsList((paymentTerms || []) as PaymentTerm[])\n        } else {\n          setPaymentTermsList([])\n        }\n\n        await reloadCustomers()\n      } catch (e: any) {\n        console.error(e)\n        toast.error(tt('customers.toast.loadFailed', 'Failed to load customers'))\n      } finally {\n        setLoading(false)\n      }\n    })()\n  }, [companyId, reloadCustomers, tt])`
)

await replaceOnce(
  'src/pages/Suppliers.tsx',
  "import { useEffect, useMemo, useState } from 'react'",
  "import { useCallback, useEffect, useMemo, useState } from 'react'"
)

await replaceOnce(
  'src/pages/Suppliers.tsx',
  `  const { t } = useI18n()\n  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>\n    withI18nFallback(t, key, fallback, vars)`,
  `  const { t } = useI18n()\n  const tt = useCallback(\n    (key: string, fallback: string, vars?: Record<string, string | number>) =>\n      withI18nFallback(t, key, fallback, vars),\n    [t]\n  )`
)

await replaceOnce(
  'src/pages/Suppliers.tsx',
  `  useEffect(() => {\n    ;(async () => {\n      if (!user) return\n      try {\n        setLoading(true)\n\n        const cur = await supabase.from('currencies').select('code,name').order('code', { ascending: true })\n        if (cur.error) throw cur.error\n        setCurrencies((cur.data || []).map((row: any) => ({ id: row.code, code: row.code, name: row.name })))\n\n        if (companyId) {\n          const { data: paymentTerms, error: paymentTermsError } = await supabase.rpc('get_payment_terms', {\n            p_company_id: companyId,\n          })\n          if (paymentTermsError) throw paymentTermsError\n          setPaymentTermsList((paymentTerms || []) as PaymentTerm[])\n        } else {\n          setPaymentTermsList([])\n        }\n\n        await reloadSuppliers()\n      } catch (e: any) {\n        console.error(e)\n        toast.error(tt('suppliers.toast.loadFailed', 'Failed to load suppliers'))\n      } finally {\n        setLoading(false)\n      }\n    })()\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [user, companyId])\n\n  async function reloadSuppliers() {\n    if (!companyId) {\n      setSuppliers([])\n      return\n    }\n\n    const result = await supabase\n      .from('suppliers')\n      .select(\n        'id,code,name,contact_name,email,phone,tax_id,currency_code,payment_terms_id,payment_terms,is_active,notes,created_at,updated_at'\n      )\n      .eq('company_id', companyId)\n      .order('name', { ascending: true })\n\n    if (result.error) {\n      console.error(result.error)\n      toast.error(tt('suppliers.toast.loadFailed', 'Failed to load suppliers'))\n      setSuppliers([])\n      return\n    }\n\n    setSuppliers((result.data || []).map(mapSupplierRow))\n  }`,
  `  const reloadSuppliers = useCallback(async () => {\n    if (!companyId) {\n      setSuppliers([])\n      return\n    }\n\n    const result = await supabase\n      .from('suppliers')\n      .select(\n        'id,code,name,contact_name,email,phone,tax_id,currency_code,payment_terms_id,payment_terms,is_active,notes,created_at,updated_at'\n      )\n      .eq('company_id', companyId)\n      .order('name', { ascending: true })\n\n    if (result.error) {\n      console.error(result.error)\n      toast.error(tt('suppliers.toast.loadFailed', 'Failed to load suppliers'))\n      setSuppliers([])\n      return\n    }\n\n    setSuppliers((result.data || []).map(mapSupplierRow))\n  }, [companyId, tt])\n\n  useEffect(() => {\n    ;(async () => {\n      if (!user) return\n      try {\n        setLoading(true)\n\n        const cur = await supabase.from('currencies').select('code,name').order('code', { ascending: true })\n        if (cur.error) throw cur.error\n        setCurrencies((cur.data || []).map((row: any) => ({ id: row.code, code: row.code, name: row.name })))\n\n        if (companyId) {\n          const { data: paymentTerms, error: paymentTermsError } = await supabase.rpc('get_payment_terms', {\n            p_company_id: companyId,\n          })\n          if (paymentTermsError) throw paymentTermsError\n          setPaymentTermsList((paymentTerms || []) as PaymentTerm[])\n        } else {\n          setPaymentTermsList([])\n        }\n\n        await reloadSuppliers()\n      } catch (e: any) {\n        console.error(e)\n        toast.error(tt('suppliers.toast.loadFailed', 'Failed to load suppliers'))\n      } finally {\n        setLoading(false)\n      }\n    })()\n  }, [user, companyId, reloadSuppliers, tt])`
)

console.log('Refactored Customers and Suppliers hook dependencies.')
