import nodemailer from "npm:nodemailer@6.9.16";

export type MailProvider = "brevo_smtp";

export type MailConfig = {
  provider: MailProvider;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpLogin: string;
  smtpKey: string;
  defaultFromEmail: string;
  defaultFromName: string;
  defaultReplyToEmail: string;
  defaultReplyToName: string;
  publicSiteUrl: string;
};

export type TransactionalMail = {
  to: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string | null;
};

export type MailDispatchMeta = {
  notificationType?: string;
  jobId?: number | string | null;
  workerId?: string | null;
};

function envFirst(...names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  return "";
}

function normalizeEmails(values: string[] = []) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => /\S+@\S+\.\S+/.test(value))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function safeErr(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function parsePort(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

let cachedTransporterKey = "";
let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function transporterKey(config: MailConfig) {
  return [
    config.provider,
    config.smtpHost,
    config.smtpPort,
    config.smtpSecure ? "secure" : "starttls",
    config.smtpLogin,
    config.defaultFromEmail,
  ].join("|");
}

function getTransporter(config: MailConfig) {
  const key = transporterKey(config);
  if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpLogin,
      pass: config.smtpKey,
    },
  });
  cachedTransporterKey = key;
  return cachedTransporter;
}

export function getMailConfig(): MailConfig {
  const smtpPort = parsePort(envFirst("BREVO_SMTP_PORT"), 587);
  const defaultFromEmail =
    envFirst("BREVO_SENDER_EMAIL", "MAIL_FROM", "FROM_EMAIL") || "";
  const defaultFromName =
    envFirst("BREVO_SENDER_NAME", "MAIL_FROM_NAME", "BRAND_NAME") || "StockWise";
  const defaultReplyToEmail =
    envFirst("BREVO_REPLY_TO_EMAIL", "MAIL_REPLY_TO", "REPLY_TO_EMAIL") ||
    defaultFromEmail;
  const defaultReplyToName =
    envFirst("BREVO_REPLY_TO_NAME") || defaultFromName;

  return {
    provider: "brevo_smtp",
    smtpHost: envFirst("BREVO_SMTP_HOST") || "smtp-relay.brevo.com",
    smtpPort,
    smtpSecure:
      (envFirst("BREVO_SMTP_SECURE") || "").toLowerCase() === "true" ||
      smtpPort === 465,
    smtpLogin: envFirst("BREVO_SMTP_LOGIN"),
    smtpKey: envFirst("BREVO_SMTP_KEY"),
    defaultFromEmail,
    defaultFromName,
    defaultReplyToEmail,
    defaultReplyToName,
    publicSiteUrl: envFirst("PUBLIC_SITE_URL"),
  };
}

export function requireMailConfig(config = getMailConfig()) {
  if (!config.smtpHost) throw new Error("BREVO_SMTP_HOST not set");
  if (!config.smtpPort) throw new Error("BREVO_SMTP_PORT not set");
  if (!config.smtpLogin) throw new Error("BREVO_SMTP_LOGIN not set");
  if (!config.smtpKey) throw new Error("BREVO_SMTP_KEY not set");
  if (!config.defaultFromEmail) {
    throw new Error("BREVO_SENDER_EMAIL or MAIL_FROM not set");
  }
  return config;
}

export async function sendTransactionalEmail(
  message: TransactionalMail,
  config = getMailConfig(),
  meta: MailDispatchMeta = {},
) {
  const ready = requireMailConfig(config);
  const to = normalizeEmails(message.to);
  if (!to.length) throw new Error("No recipient emails provided");

  const bcc = normalizeEmails(message.bcc || []);
  const transporter = getTransporter(ready);
  const replyTo = (message.replyTo || ready.defaultReplyToEmail || "").trim();

  try {
    const info = await transporter.sendMail({
      from: {
        address: message.fromEmail || ready.defaultFromEmail,
        name: message.fromName || ready.defaultFromName,
      },
      to,
      ...(bcc.length ? { bcc } : {}),
      ...(replyTo
        ? {
            replyTo: {
              address: replyTo,
              name: ready.defaultReplyToName,
            },
          }
        : {}),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    console.log(
      JSON.stringify({
        event: "mail.sent",
        provider: ready.provider,
        notificationType: meta.notificationType || "transactional",
        workerId: meta.workerId ?? null,
        jobId: meta.jobId ?? null,
        recipients: to,
        bccCount: bcc.length,
        messageId: info.messageId ?? null,
      }),
    );

    return info;
  } catch (error) {
    const messageText = safeErr(error);
    console.error(
      JSON.stringify({
        event: "mail.failed",
        provider: ready.provider,
        notificationType: meta.notificationType || "transactional",
        workerId: meta.workerId ?? null,
        jobId: meta.jobId ?? null,
        recipients: to,
        bccCount: bcc.length,
        error: messageText,
      }),
    );
    throw new Error(`brevo_smtp_failed: ${messageText}`);
  }
}
