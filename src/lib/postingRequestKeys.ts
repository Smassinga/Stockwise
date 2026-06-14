export type PostingRequestKeyRef = {
  key: string
  fingerprint: string
} | null

function normalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForFingerprint(entry)]),
    )
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Number(value.toFixed(12))
  }
  return value ?? null
}

export function stablePostingFingerprint(value: unknown) {
  return JSON.stringify(normalizeForFingerprint(value))
}

export function createPostingRequestKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export function getPostingRequestKeyForFingerprint(
  ref: { current: PostingRequestKeyRef },
  fingerprint: string,
) {
  if (!ref.current || ref.current.fingerprint !== fingerprint) {
    ref.current = {
      key: createPostingRequestKey(),
      fingerprint,
    }
  }
  return ref.current.key
}

export function clearPostingRequestKey(ref: { current: PostingRequestKeyRef }) {
  ref.current = null
}
