export type MailConfig = {
  apiKey: string
  defaultFromEmail: string
  defaultFromName: string
  defaultReplyTo: string
  publicSiteUrl: string
}

export type SendGridMail = {
  to: string[]
  bcc?: string[]
  subject: string
  html: string
  text: string
  fromEmail?: string
  fromName?: string
  replyTo?: string | null
}

function envFirst(...names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim()
    if (value) return value
  }
  return ''
}

function normalizeEmails(values: string[] = []) {
  const seen = new Set<string>()
  return values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /\S+@\S+\.\S+/.test(value))
    .filter((value) => {
      if (seen.has(value)) return false
      seen.add(value)
      return true
    })
}

export function getMailConfig(): MailConfig {
  const defaultFromEmail = envFirst('MAIL_FROM', 'FROM_EMAIL')
  return {
    apiKey: envFirst('SENDGRID_API_KEY', 'SG_API_KEY'),
    defaultFromEmail,
    defaultFromName: envFirst('MAIL_FROM_NAME', 'BRAND_NAME') || 'StockWise',
    defaultReplyTo: envFirst('MAIL_REPLY_TO', 'REPLY_TO_EMAIL') || defaultFromEmail,
    publicSiteUrl: envFirst('PUBLIC_SITE_URL'),
  }
}

export function requireMailConfig(config = getMailConfig()) {
  if (!config.apiKey) throw new Error('SENDGRID_API_KEY not set')
  if (!config.defaultFromEmail) throw new Error('MAIL_FROM or FROM_EMAIL not set')
  return config
}

export async function sendMailViaSendGrid(message: SendGridMail, config = getMailConfig()) {
  const ready = requireMailConfig(config)
  const to = normalizeEmails(message.to)
  if (!to.length) throw new Error('No recipient emails provided')

  const bcc = normalizeEmails(message.bcc || [])
  const body: Record<string, unknown> = {
    personalizations: [
      {
        to: to.map((email) => ({ email })),
        ...(bcc.length ? { bcc: bcc.map((email) => ({ email })) } : {}),
      },
    ],
    from: {
      email: message.fromEmail || ready.defaultFromEmail,
      name: message.fromName || ready.defaultFromName,
    },
    subject: message.subject,
    content: [
      { type: 'text/plain', value: message.text },
      { type: 'text/html', value: message.html },
    ],
  }

  const replyTo = (message.replyTo || ready.defaultReplyTo || '').trim()
  if (replyTo) {
    body.reply_to = { email: replyTo }
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ready.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (response.status !== 202) {
    const details = await response.text().catch(() => '')
    throw new Error(`SendGrid error: ${response.status} ${details}`)
  }
}
