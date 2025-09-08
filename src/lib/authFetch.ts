// src/lib/authFetch.ts
import { supabase } from './supabase'

type PlainHeaders = Record<string, string>
type Jsonish = Record<string, unknown> | unknown[]

export type AuthFetchInit = Omit<RequestInit, 'headers' | 'body'> & {
  headers?: PlainHeaders
  /** If you pass an object/array, it will be JSON.stringified automatically */
  body?: BodyInit | Jsonish | null
}

const BASE =
  (import.meta as any)?.env?.VITE_SUPABASE_URL?.replace(/\/+$/, '') ??
  ''

const FUNCS_BASE = `${BASE}/functions/v1`

const ANON_KEY = (import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY ?? ''

const DEBUG =
  (typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG_AUTHFETCH') === '1') ||
  (import.meta as any)?.env?.DEV

function toUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const p = pathOrUrl.replace(/^\/+/, '')
  return `${FUNCS_BASE}/${p}`
}

function buildHeaders(token?: string, extra?: PlainHeaders): HeadersInit {
  const base: PlainHeaders = {
    'Content-Type': 'application/json',
    apikey: ANON_KEY,
  }
  if (token) base.Authorization = `Bearer ${token}`
  return { ...base, ...(extra || {}) }
}

async function parse<T = any>(res: Response): Promise<T> {
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // non-JSON response
    data = text
  }
  if (!res.ok) {
    // prefer function error shape
    const message =
      (data && typeof data === 'object' && 'error' in data && (data as any).error) ||
      res.statusText ||
      `HTTP ${res.status}`
    const err = new Error(String(message))
    ;(err as any).status = res.status
    ;(err as any).response = data
    throw err
  }
  return data as T
}

/**
 * authFetch('admin-users/sync', { method: 'POST' })
 * authFetch(`admin-users/?company_id=${id}`, { method: 'GET' })
 */
export async function authFetch<T = any>(pathOrUrl: string, init: AuthFetchInit = {}): Promise<T> {
  const url = toUrl(pathOrUrl)

  // Read current session (may auto-refresh in background, but we’ll still handle 401)
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  // Auto-JSON body if needed
  const needsJson = init.body && typeof init.body === 'object' && !(init.body instanceof FormData) && !(init.body instanceof Blob)
  const body = needsJson ? JSON.stringify(init.body) : (init.body as BodyInit | null | undefined)

  const firstReq: RequestInit = {
    ...init,
    headers: buildHeaders(token, init.headers),
    body,
  }

  if (DEBUG) {
    console.log('[authFetch] first', { url, hasToken: !!token, method: init.method ?? 'GET' })
  }

  let res = await fetch(url, firstReq)

  // If unauthorized, try a single refresh + retry
  if (res.status === 401) {
    if (DEBUG) console.warn('[authFetch] 401 -> refreshing session & retrying')
    try {
      await supabase.auth.refreshSession()
      const { data: { session: s2 } } = await supabase.auth.getSession()
      const token2 = s2?.access_token
      if (token2 && token2 !== token) {
        const retryReq: RequestInit = {
          ...init,
          headers: buildHeaders(token2, init.headers),
          body,
        }
        res = await fetch(url, retryReq)
      }
    } catch {
      // fall through to parse (will throw)
    }
  }

  if (DEBUG) {
    console.log('[authFetch] status', res.status, 'url:', url)
  }

  return parse<T>(res)
}
