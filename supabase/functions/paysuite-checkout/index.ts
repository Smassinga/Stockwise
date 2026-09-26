import {
  adminClient, json, paySuiteRequest, supabaseUrl, userClient,
  verifyAndApply, type SubscriptionPayment,
} from "../_shared/paysuite.ts";

const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://stockwiseapp.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "authorization,apikey,content-type",
    } });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, true);
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in required" }, 401, true);

  try {
    const userApi = userClient(token);
    const { data: { user }, error: authError } = await userApi.auth.getUser(token);
    if (authError || !user) return json({ error: "Sign in required" }, 401, true);
    const input = await request.json();
    if (input?.action === "status") {
      if (typeof input.paymentId !== "string" || !uuid.test(input.paymentId)) {
        return json({ error: "Invalid payment" }, 400, true);
      }
      const { data, error } = await userApi.from("paysuite_subscription_payments")
        .select("*").eq("id", input.paymentId).single();
      if (error || !data) return json({ error: "Payment unavailable" }, 404, true);
      const payment = data as SubscriptionPayment;
      if (payment.state === "paid" || payment.state === "requires_review") {
        return json({ state: payment.state }, 200, true);
      }
      if (!payment.provider_payment_id) return json({ state: payment.state }, 200, true);
      const result = await verifyAndApply(payment);
      if (result?.provider_status === "failed" && payment.state === "checkout_ready") {
        await adminClient().from("paysuite_subscription_payments")
          .update({ state: "failed", provider_status: "failed" })
          .eq("id", payment.id).eq("state", "checkout_ready");
        return json({ state: "failed" }, 200, true);
      }
      return json(result, 200, true);
    }
    if (input?.action !== "create" || typeof input.companyId !== "string" ||
      !uuid.test(input.companyId) || typeof input.requestKey !== "string" ||
      !uuid.test(input.requestKey) || typeof input.planCode !== "string" ||
      !/^[a-z0-9_]{1,64}$/.test(input.planCode) ||
      !["monthly", "six_month", "annual"].includes(input.period)) {
      return json({ error: "Invalid checkout request" }, 400, true);
    }
    const { data, error } = await userApi.rpc("create_paysuite_subscription_intent", {
      p_company_id: input.companyId,
      p_plan_code: input.planCode,
      p_period: input.period,
      p_request_key: input.requestKey,
    });
    if (error || !data) return json({ error: error?.message ?? "Checkout unavailable" }, 400, true);
    const payment = data as SubscriptionPayment;
    if (payment.state === "checkout_ready" && payment.checkout_url) {
      return json({ id: payment.id, checkoutUrl: payment.checkout_url }, 200, true);
    }
    if (payment.state !== "initiating") return json({ state: payment.state }, 409, true);
    const admin = adminClient();
    const { data: claimed, error: claimError } = await admin.from("paysuite_subscription_payments")
      .update({ checkout_started_at: new Date().toISOString() })
      .eq("id", payment.id).eq("state", "initiating").is("checkout_started_at", null)
      .select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return json({ state: "initiating" }, 409, true);
    try {
      if (!supabaseUrl) throw new Error("StockWise server configuration missing");
      const provider = await paySuiteRequest("payments", "POST", {
        amount: Number(payment.gross_amount),
        reference: payment.reference,
        description: `StockWise ${payment.plan_code} ${payment.billing_period}`,
        return_url: `${siteUrl}/activation?payment=${payment.id}`,
        webhook_url: `${supabaseUrl}/functions/v1/paysuite-webhook`,
      });
      const checkoutAddress = new URL(provider.checkout_url ?? "");
      if (provider.reference !== payment.reference ||
        Math.round(provider.amount * 100) !== Math.round(Number(payment.gross_amount) * 100) ||
        checkoutAddress.protocol !== "https:" ||
        !(checkoutAddress.hostname === "paysuite.tech" ||
          checkoutAddress.hostname.endsWith(".paysuite.tech"))) {
        throw new Error("PaySuite checkout response mismatch");
      }
      const { data: updated, error: updateError } = await admin.from("paysuite_subscription_payments")
        .update({
          provider_payment_id: provider.id, checkout_url: provider.checkout_url,
          provider_status: provider.status, state: "checkout_ready", updated_at: new Date().toISOString(),
        }).eq("id", payment.id).eq("state", "initiating").select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!updated) {
        const { data: recovered } = await admin.from("paysuite_subscription_payments")
          .select("state").eq("id", payment.id).single();
        if (recovered?.state !== "paid") throw new Error("Checkout state changed");
      }
      return json({ id: payment.id, checkoutUrl: provider.checkout_url }, 200, true);
    } catch (_error) {
      // A timeout could mean the provider created a payment. Retain its unique
      // reference for investigation and never issue a second charge blindly.
      await admin.from("paysuite_subscription_payments")
        .update({ state: "requires_review", review_reason: "checkout_creation_uncertain" })
        .eq("id", payment.id).eq("state", "initiating");
      return json({ id: payment.id, error: "Checkout could not be confirmed. Contact support." }, 502, true);
    }
  } catch (_error) {
    return json({ error: "Payment service temporarily unavailable" }, 503, true);
  }
});
