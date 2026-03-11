export function buildAuthCallbackUrl(): string {
  const env = (import.meta as any)?.env?.VITE_SITE_URL as string | undefined
  const base = (env && env.trim()) || window.location.origin
  return `${base.replace(/\/$/, '')}/auth/callback`
}
