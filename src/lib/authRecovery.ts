const PASSWORD_RECOVERY_KEY = 'stockwise.auth.passwordRecoveryPending'

function sessionStore(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.sessionStorage
}

export function markPasswordRecoveryPending() {
  sessionStore()?.setItem(PASSWORD_RECOVERY_KEY, '1')
}

export function clearPasswordRecoveryPending() {
  sessionStore()?.removeItem(PASSWORD_RECOVERY_KEY)
}

export function hasPasswordRecoveryPending() {
  return sessionStore()?.getItem(PASSWORD_RECOVERY_KEY) === '1'
}

export function isPasswordRecoveryUrl(rawUrl = typeof window !== 'undefined' ? window.location.href : '') {
  if (!rawUrl) return false

  try {
    const url = new URL(rawUrl)
    if (url.searchParams.get('type') === 'recovery') return true

    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
    return hash.get('type') === 'recovery'
  } catch {
    return false
  }
}
