import { readFile, writeFile } from 'node:fs/promises'

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`${label}: expected marker not found`)
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: marker is not unique`)
  return source.replace(before, after)
}

async function refactorCurrency() {
  const path = 'src/pages/Currency.tsx'
  let source = await readFile(path, 'utf8')

  source = replaceOnce(
    source,
    "import { useEffect, useMemo, useState } from 'react'",
    "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'",
    'Currency import',
  )

  source = replaceOnce(
    source,
    `  const { t } = useI18n()\n  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>\n    withI18nFallback(t, key, fallback, vars)`,
    `  const { t } = useI18n()\n  const tt = useCallback(\n    (key: string, fallback: string, vars?: Record<string, string | number>) =>\n      withI18nFallback(t, key, fallback, vars),\n    [t]\n  )\n  const translationRef = useRef({ t, tt })\n\n  useEffect(() => {\n    translationRef.current = { t, tt }\n  }, [t, tt])`,
    'Currency translation helper',
  )

  source = replaceOnce(
    source,
    `        if (!allowedArr.includes(from)) setFrom(fallback)\n        if (!allowedArr.includes(to)) setTo(fallback)`,
    `        setFrom((current) => (allowedArr.includes(current) ? current : fallback))\n        setTo((current) => (allowedArr.includes(current) ? current : fallback))`,
    'Currency selector stabilization',
  )

  source = replaceOnce(
    source,
    `        toast.error(e?.message || tt('currency.toast.loadFailed', 'Failed to load currency data'))`,
    `        toast.error(e?.message || translationRef.current.tt('currency.toast.loadFailed', 'Failed to load currency data'))`,
    'Currency load error translation',
  )

  source = replaceOnce(
    source,
    `    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [companyId])`,
    `  }, [authorityMode, companyId])`,
    'Currency effect dependencies',
  )

  await writeFile(path, source)
}

async function refactorWarehouses() {
  const path = 'src/pages/Warehouses.tsx'
  let source = await readFile(path, 'utf8')

  source = replaceOnce(
    source,
    "import { useEffect, useState } from 'react'",
    "import { useCallback, useEffect, useRef, useState } from 'react'",
    'Warehouses import',
  )

  source = replaceOnce(
    source,
    `  const { t } = useI18n()\n  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>\n    withI18nFallback(t, key, fallback, vars)`,
    `  const { t } = useI18n()\n  const tt = useCallback(\n    (key: string, fallback: string, vars?: Record<string, string | number>) =>\n      withI18nFallback(t, key, fallback, vars),\n    [t]\n  )\n  const translationRef = useRef({ t, tt })\n\n  useEffect(() => {\n    translationRef.current = { t, tt }\n  }, [t, tt])`,
    'Warehouses translation helper',
  )

  const effectStartMarker = `  useEffect(() => {\n    if (!companyId) {`
  const loadStartMarker = `  async function loadAll(activeCompanyId = companyId, isCancelled: () => boolean = () => false) {`
  const resetStartMarker = `  function resetForm() {`
  const addStartMarker = `  async function addWarehouse() {`

  const effectStart = source.indexOf(effectStartMarker)
  const loadStart = source.indexOf(loadStartMarker, effectStart)
  const resetStart = source.indexOf(resetStartMarker, loadStart)
  const addStart = source.indexOf(addStartMarker, resetStart)
  if (effectStart < 0 || loadStart < 0 || resetStart < 0 || addStart < 0) {
    throw new Error('Warehouses: could not isolate load/effect/reset blocks')
  }

  let effectBlock = source.slice(effectStart, loadStart)
  let loadBlock = source.slice(loadStart, resetStart)
  const resetBlock = source.slice(resetStart, addStart)

  effectBlock = replaceOnce(
    effectBlock,
    `      resetForm()\n      resetBinForm()`,
    `      setForm({ code: '', name: '', address: '', status: 'active' })\n      setEditing(null)\n      setBinForm({ code: '', name: '', warehouseId: '', status: 'active' })`,
    'Warehouses no-company resets',
  )
  effectBlock = replaceOnce(
    effectBlock,
    `        if (!cancelled) setError(e?.message || t('errors.title'))`,
    `        if (!cancelled) setError(e?.message || translationRef.current.t('errors.title'))`,
    'Warehouses load error translation',
  )
  effectBlock = replaceOnce(
    effectBlock,
    `    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [companyId])`,
    `  }, [companyId, loadAll])`,
    'Warehouses effect dependencies',
  )

  loadBlock = replaceOnce(
    loadBlock,
    loadStartMarker,
    `  const loadAll = useCallback(async (activeCompanyId = companyId, isCancelled: () => boolean = () => false) => {`,
    'Warehouses load callback start',
  )
  loadBlock = loadBlock.replace(
    `toast.error(bnErr.message || tt('warehouses.toast.binLoadFailed', 'Failed to load bins'))`,
    `toast.error(bnErr.message || translationRef.current.tt('warehouses.toast.binLoadFailed', 'Failed to load bins'))`,
  )
  const loadClosing = `\n  }\n\n`
  if (!loadBlock.endsWith(loadClosing)) throw new Error('Warehouses: load callback closing marker not found')
  loadBlock = `${loadBlock.slice(0, -loadClosing.length)}\n  }, [companyId])\n\n`

  source = `${source.slice(0, effectStart)}${loadBlock}${effectBlock}${resetBlock}${source.slice(addStart)}`

  await writeFile(path, source)
}

await refactorCurrency()
await refactorWarehouses()
console.log('Refactored Currency and Warehouses hook dependencies.')
