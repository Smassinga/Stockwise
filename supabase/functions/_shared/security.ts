import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const firstForwarded = forwarded.split(",").map((part) => part.trim()).find(Boolean);
  return (
    firstForwarded ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    null
  );
}

export async function readJsonBody(
  req: Request,
  maxBytes = 16 * 1024,
): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, "payload_too_large", "Request body is too large");
  }

  const text = await req.text();
  if (!text.trim()) return {};
  if (text.length > maxBytes) {
    throw new HttpError(413, "payload_too_large", "Request body is too large");
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}

export function requireText(
  value: unknown,
  label: string,
  maxLength: number,
  minLength = 1,
): string {
  const text = String(value ?? "").trim();
  if (text.length < minLength) {
    throw new HttpError(400, `${label}_required`, `${label} is required`);
  }
  if (text.length > maxLength) {
    throw new HttpError(400, `${label}_too_long`, `${label} is too long`);
  }
  return text;
}

export function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (text.length > maxLength) {
    throw new HttpError(400, "field_too_long", "One of the fields is too long");
  }
  return text;
}

export function requireEmail(value: unknown, label = "email"): string {
  const email = requireText(value, label, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, `${label}_invalid`, `${label} is invalid`);
  }
  return email;
}

export async function enforceRateLimit(
  admin: SupabaseClient,
  input: {
    scope: string;
    subject: string;
    windowSeconds: number;
    maxHits: number;
  },
) {
  const { data, error } = await admin.rpc("consume_security_rate_limit", {
    p_scope: input.scope,
    p_subject: input.subject,
    p_window_seconds: input.windowSeconds,
    p_max_hits: input.maxHits,
  });

  if (error) {
    throw new HttpError(500, "rate_limit_backend_failed", error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) {
    throw new HttpError(429, "rate_limited", "Too many requests", {
      retry_after_seconds: Number(row?.retry_after_seconds ?? 0),
    });
  }

  return row;
}
