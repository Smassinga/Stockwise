import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const encoder = new TextEncoder();

export class InternalAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function safeEqualText(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildSignedJsonHeaders(
  secret: string,
  rawBody: string,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return {
    "Content-Type": "application/json",
    "x-ai-timestamp": timestamp,
    "x-ai-signature": signature,
    ...extraHeaders,
  };
}

export async function verifySignedRequest(
  req: Request,
  secret: string,
  options: { maxAgeSeconds?: number; maxBodyBytes?: number } = {},
): Promise<{ rawBody: string; timestamp: number }> {
  if (!secret) {
    throw new InternalAuthError(500, "missing_secret", "Internal secret is not configured");
  }

  const providedSignature = (req.headers.get("x-ai-signature") ?? "").trim().toLowerCase();
  const timestampRaw = (req.headers.get("x-ai-timestamp") ?? "").trim();
  if (!providedSignature || !timestampRaw) {
    throw new InternalAuthError(403, "forbidden", "Forbidden");
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestamp)) {
    throw new InternalAuthError(403, "invalid_timestamp", "Forbidden");
  }

  const now = Math.floor(Date.now() / 1000);
  const maxAgeSeconds = Math.max(30, options.maxAgeSeconds ?? 300);
  if (Math.abs(now - timestamp) > maxAgeSeconds) {
    throw new InternalAuthError(403, "stale_signature", "Forbidden");
  }

  const rawBody = await req.clone().text();
  if ((options.maxBodyBytes ?? 128 * 1024) < rawBody.length) {
    throw new InternalAuthError(413, "payload_too_large", "Payload is too large");
  }

  const expectedSignature = await hmacHex(secret, `${timestampRaw}.${rawBody}`);
  if (!safeEqualText(providedSignature, expectedSignature)) {
    throw new InternalAuthError(403, "forbidden", "Forbidden");
  }

  return { rawBody, timestamp };
}

export function parseJsonObject(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) return {};
  const parsed = JSON.parse(rawBody);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InternalAuthError(400, "invalid_json", "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof InternalAuthError) {
    return new Response(JSON.stringify({ ok: false, error: error.code }), {
      status: error.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}
