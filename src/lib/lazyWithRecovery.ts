import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { importWithRecovery } from './lazyRecoveryCore'

type LazyModule<T extends ComponentType<any>> = { default: T }

const releaseIdentity = (
  import.meta.env.VITE_SENTRY_RELEASE
  || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA
  || 'current'
).trim()

export function lazyWithRecovery<T extends ComponentType<any>>(
  moduleKey: string,
  importer: () => Promise<LazyModule<T>>,
): LazyExoticComponent<T> {
  return lazy(() => importWithRecovery(moduleKey, importer, {
    pathname: window.location.pathname,
    storage: window.sessionStorage,
    reload: () => window.location.reload(),
    now: () => Date.now(),
    release: releaseIdentity,
  }))
}
