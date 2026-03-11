import React, { createContext, useContext, useEffect, useMemo } from 'react'

type Ctx = {
  siteName: string
  baseUrl?: string
  titleTemplate?: (title: string) => string
}

const SEOContext = createContext<Ctx>({
  siteName: 'StockWise',
  baseUrl: 'https://stockwiseapp.com',
  titleTemplate: (title) => {
    if (!title) return 'StockWise'
    return title.includes('StockWise') ? title : `${title} | StockWise`
  },
})

export function SEOProvider({
  children,
  siteName = 'StockWise',
  baseUrl = 'https://stockwiseapp.com',
}: {
  children: React.ReactNode
  siteName?: string
  baseUrl?: string
}) {
  const value = useMemo<Ctx>(
    () => ({
      siteName,
      baseUrl,
      titleTemplate: (title: string) => {
        if (!title) return siteName
        return title.includes(siteName) ? title : `${title} | ${siteName}`
      },
    }),
    [siteName, baseUrl]
  )

  return <SEOContext.Provider value={value}>{children}</SEOContext.Provider>
}

function ensureMetaByName(name: string, content?: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!content) {
    if (el) el.remove()
    return
  }
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    el.setAttribute('data-managed', 'seo')
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function ensureMetaByProp(property: string, content?: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
  if (!content) {
    if (el) el.remove()
    return
  }
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    el.setAttribute('data-managed', 'seo')
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function ensureCanonical(href?: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!href) {
    if (el) el.remove()
    return
  }
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    el.setAttribute('data-managed', 'seo')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

function absolute(base: string | undefined, path?: string) {
  if (!path) return undefined
  if (/^https?:\/\//i.test(path)) return path
  if (!base) return path
  return new URL(path, base).toString()
}

export function SEO({
  title,
  description,
  image = '/og-cover.png',
  url,
  canonical,
  noindex,
}: {
  title?: string
  description?: string
  image?: string
  url?: string
  canonical?: string
  noindex?: boolean
}) {
  const { titleTemplate, baseUrl, siteName } = useContext(SEOContext)

  useEffect(() => {
    const fullTitle = titleTemplate?.(title ?? '') ?? title ?? siteName ?? 'App'
    document.title = fullTitle

    const absUrl =
      url ??
      (baseUrl
        ? new URL(window.location.pathname + window.location.search, baseUrl).toString()
        : undefined)
    const absImg = absolute(baseUrl, image)

    ensureMetaByName('description', description ?? undefined)
    ensureMetaByProp('og:type', 'website')
    ensureMetaByProp('og:site_name', siteName)
    ensureMetaByProp('og:title', fullTitle)
    ensureMetaByProp('og:description', description ?? undefined)
    ensureMetaByProp('og:url', absUrl)
    ensureMetaByProp('og:image', absImg)
    ensureMetaByName('twitter:card', 'summary_large_image')
    ensureMetaByName('twitter:title', fullTitle)
    ensureMetaByName('twitter:description', description ?? undefined)
    ensureMetaByName('twitter:image', absImg)
    ensureMetaByName('robots', noindex ? 'noindex, nofollow' : 'index, follow')
    ensureCanonical(canonical ?? absUrl)
  }, [title, description, image, url, canonical, noindex, titleTemplate, baseUrl, siteName])

  return null
}
