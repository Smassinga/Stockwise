import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

export type PaySuitePayment = {
  id: string;
  amount: number;
  reference: string;
  status: string;
  checkout_url?: string;
  transaction?: { status?: string; transaction_id?: string; paid_at?: string };
};

export type SubscriptionPayment = {
  id: string;
  company_id: string;
  created_by: string;
  reference: string;
  gross_amount: number;
  currency_code: string;
  state: string;
  provider_payment_id: string | null;
  checkout_url: string | null;
  checkout_started_at: string | null;
  plan_code: string;
  billing_period: string;
};

export const supabaseUrl = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("SB_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const paySuiteToken = Deno.env.get("PAYSUITE_API_TOKEN");

export function adminClient() {
  if (!supabaseUrl || !serviceKey) throw new Error("StockWise server configuration missing");
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export function userClient(jwt: string) {
  if (!supabaseUrl || !anonKey) throw new Error("StockWise auth configuration missing");
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

export function paymentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{15,80}$/.test(value);
}

export function validProviderPayment(value: unknown): value is PaySuitePayment {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return paymentId(p.id) && typeof p.reference === "string" &&
    typeof p.amount === "number" && Number.isFinite(p.amount) &&
    typeof p.status === "string";
}

export async function paySuiteRequest(path: string, method = "GET", body?: unknown) {
  if (!paySuiteToken) throw new Error("PaySuite credential missing");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://paysuite.tech/api/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${paySuiteToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.status !== "success") {
      throw new Error(`PaySuite request failed (${response.status})`);
    }
    if (!validProviderPayment(result.data)) throw new Error("Invalid PaySuite payment response");
    return result.data as PaySuitePayment;
  } finally {
    clearTimeout(timeout);
  }
}

export function samePayment(provider: PaySuitePayment, local: SubscriptionPayment) {
  return provider.id === local.provider_payment_id &&
    provider.reference === local.reference &&
    Math.round(provider.amount * 100) === Math.round(Number(local.gross_amount) * 100) &&
    local.currency_code === "MZN";
}

export async function verifyAndApply(local: SubscriptionPayment) {
  if (!paymentId(local.provider_payment_id)) throw new Error("Provider ID unavailable");
  const provider = await paySuiteRequest(`payments/${encodeURIComponent(local.provider_payment_id)}`);
  if (!samePayment(provider, local)) throw new Error("Provider payment mismatch");
  if (provider.status !== "paid") return { state: local.state, provider_status: provider.status };
  if (provider.transaction?.status && provider.transaction.status !== "completed") {
    return { state: local.state, provider_status: provider.status };
  }
  const admin = adminClient();
  const { data, error } = await admin.rpc("apply_verified_paysuite_payment", {
    p_payment_id: local.id,
    p_provider_id: provider.id,
    p_reference: provider.reference,
    p_amount: provider.amount,
    p_currency: "MZN",
    p_provider_status: provider.status,
  });
  if (error) throw error;
  return data;
}

export function json(body: unknown, status = 200, cors = false) {
  return Response.json(body, {
    status,
    headers: cors
      ? { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type" }
      : {},
  });
}
