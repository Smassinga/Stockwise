export const PUBLIC_CONTACT_EMAIL = 'hello@stockwiseapp.com'

export function buildPublicMailto(subject: string) {
  const encodedSubject = encodeURIComponent(subject)
  return `mailto:${PUBLIC_CONTACT_EMAIL}?subject=${encodedSubject}`
}
