const CHUNK_FAILURE_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /ChunkLoadError/i,
  /Loading chunk\s+.+\s+failed/i,
]

const RECOVERY_TTL_MS = 5 * 60 * 1000
const RECOVERY_PREFIX = 'stockwise:lazy-recovery:'

type LazyRuntime = {
  pathname: string
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  reload: () => void
  now: () => number
  release: string
}

type RecoveryMarker = { attemptedAt: number }

export class StaleChunkError extends Error {
  readonly moduleKey: string

  constructor(moduleKey: string) {
    super('StockWise could not load the current application page.')
    this.name = 'StaleChunkError'
    this.moduleKey = moduleKey
  }
}

export function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')
  return CHUNK_FAILURE_PATTERNS.some((pattern) => pattern.test(message))
}

export function lazyRecoveryMarkerKey(moduleKey: string, pathname: string, release: string): string {
  return `${RECOVERY_PREFIX}${encodeURIComponent(release)}:${encodeURIComponent(moduleKey)}:${encodeURIComponent(pathname)}`
}

function readMarker(runtime: LazyRuntime, key: string): RecoveryMarker | null {
  try {
    const value = JSON.parse(runtime.storage.getItem(key) || 'null') as RecoveryMarker | null
    if (!value || typeof value.attemptedAt !== 'number') return null
    if (runtime.now() - value.attemptedAt > RECOVERY_TTL_MS) {
      runtime.storage.removeItem(key)
      return null
    }
    return value
  } catch {
    return null
  }
}

export async function importWithRecovery<T>(
  moduleKey: string,
  importer: () => Promise<T>,
  runtime: LazyRuntime,
): Promise<T> {
  const markerKey = lazyRecoveryMarkerKey(moduleKey, runtime.pathname, runtime.release)
  try {
    const loaded = await importer()
    try { runtime.storage.removeItem(markerKey) } catch { /* Storage can be unavailable without breaking navigation. */ }
    return loaded
  } catch (error) {
    if (!isChunkLoadFailure(error)) throw error
    if (readMarker(runtime, markerKey)) throw new StaleChunkError(moduleKey)

    try {
      runtime.storage.setItem(markerKey, JSON.stringify({ attemptedAt: runtime.now() }))
    } catch {
      throw new StaleChunkError(moduleKey)
    }
    runtime.reload()
    // Keep React.lazy pending while the browser preserves and reloads this URL.
    return await new Promise<T>(() => undefined)
  }
}
