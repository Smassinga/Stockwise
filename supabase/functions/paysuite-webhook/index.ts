import {
  adminClient, json, paymentId, verifyAndApply, type SubscriptionPayment,
} from "../_shared/paysuite.ts";

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function validSignature(body: string, signature: string | null, secret: string) {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  // Compare fixed-length digests without an early-returning string comparison.
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("PAYSUITE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Webhook unavailable" }, 503);
  if (Number(request.headers.get("content-length") ?? 0) > 32768) return json({ error: "Payload too large" }, 413);
  const raw = await request.text();
  if (raw.length > 32768 || !await validSignature(raw, request.headers.get("X-Signature"), secret)) {
    return json({ error: "Invalid signature" }, 401);
  }
  let event: { event?: string; data?: { id?: string; reference?: string } };
  try { event = JSON.parse(raw); } catch { return json({ error: "Invalid payload" }, 400); }
  if (!["payment.success", "payment.failed"].includes(event.event ?? "")) return json({ accepted: true });
  if (!paymentId(event.data?.id) || typeof event.data?.reference !== "string") {
    return json({ error: "Invalid payment identity" }, 400);
  }
  try {
    const admin = adminClient();
    const { data, error } = await admin.from("paysuite_subscription_payments")
      .select("*").eq("reference", event.data.reference).single();
    if (error || !data) return json({ error: "Unknown payment" }, 404);
    let payment = data as SubscriptionPayment;
    if (payment.provider_payment_id && payment.provider_payment_id !== event.data.id) {
      return json({ error: "Payment identity mismatch" }, 409);
    }
    if (!payment.provider_payment_id) {
      const { data: bound, error: bindError } = await admin.from("paysuite_subscription_payments")
        .update({ provider_payment_id: event.data.id })
        .eq("id", payment.id).is("provider_payment_id", null).select("*").single();
      if (bindError || !bound) return json({ error: "Payment binding unavailable" }, 503);
      payment = bound as SubscriptionPayment;
    }
    const result = await verifyAndApply(payment);
    if (event.event === "payment.success" && result?.state !== "paid" &&
      result?.state !== "requires_review") return json({ error: "Payment pending verification" }, 503);
    if (event.event === "payment.failed" && result?.provider_status === "failed") {
      await admin.from("paysuite_subscription_payments")
        .update({ state: "failed", provider_status: "failed" })
        .eq("id", payment.id).eq("state", "checkout_ready");
    }
    return json({ accepted: true });
  } catch (_error) {
    return json({ error: "Verification temporarily unavailable" }, 503);
  }
});
