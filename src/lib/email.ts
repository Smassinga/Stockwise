// src/lib/email.ts
import sgMail from '@sendgrid/mail';

const API_KEY = process.env.SENDGRID_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'no-reply@stockwiseapp.com';
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@stockwiseapp.com';

// Fail fast if the key is missing (only on server, e.g., Vercel functions)
if (!API_KEY) {
  // Don't throw on the client bundle; this module must only be imported in server code.
  // If you import this in a Vercel/Node API route or script, it's safe to throw:
  if (typeof window === 'undefined') {
    throw new Error('SENDGRID_API_KEY is not set in environment variables.');
  }
}

if (API_KEY) {
  sgMail.setApiKey(API_KEY);
}

export type SendEmailParams = {
  to: string | { email: string; name?: string } | Array<string | { email: string; name?: string }>;
  subject: string;
  html: string;
  text?: string;
  fromName?: string; // defaults to "StockWise"
};

/**
 * Send an email via SendGrid using domain-authenticated From and Reply-To.
 * NOTE: Import and call this ONLY from server-side code (e.g., Vercel API route,
 * cron job, CLI script). Do NOT import in the browser bundle.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  fromName = 'StockWise',
}: SendEmailParams) {
  if (!API_KEY) {
    throw new Error('SENDGRID_API_KEY is missing at runtime.');
  }

  const msg = {
    to,
    from: { email: EMAIL_FROM, name: fromName },
    replyTo: EMAIL_REPLY_TO,
    subject,
    html,
    ...(text ? { text } : {}),
    mailSettings: {
      sandboxMode: { enable: false },
    },
  };

  const [res] = await sgMail.send(msg);
  return { status: res.statusCode };
}
