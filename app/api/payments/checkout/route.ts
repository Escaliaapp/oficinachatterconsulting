import { createHash } from "node:crypto";
import { z } from "zod";
import { BILLING_OFFERS } from "../../../../lib/payments/catalog";
import { customerForUser, stripeClient } from "../../../../lib/payments/stripe";
import { ApiError, apiError, appOrigin, idempotencyKey, json, parseBody, rateLimit, requiredEnv, requireUser, verifyOrigin } from "../../../../lib/supabase/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const context = await requireUser(request);
    rateLimit(`checkout:${context.user.id}`, 5);
    const body = await parseBody(request, z.object({ offer: z.enum(["membership", "credits"]) }).strict());
    const key = idempotencyKey(request);
    const offer = BILLING_OFFERS[body.offer];
    const stripe = stripeClient();
    const priceId = requiredEnv(offer.priceVariable);
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.unit_amount !== offer.amountCents || price.currency !== offer.currency || (offer.kind === "subscription" ? price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 : price.recurring !== null)) throw new ApiError(503, "price_mismatch", "El catálogo de facturación necesita revisión.");
    if (body.offer === "membership") {
      const current = await context.db.from("subscriptions").select("id").eq("user_id", context.user.id).in("status", ["active", "trialing", "past_due"]).limit(1);
      if (current.error) throw new ApiError(503, "subscription_check_failed", "No se pudo verificar tu suscripción.");
      if (current.data?.length) throw new ApiError(409, "subscription_exists", "Ya tienes una suscripción. Adminístrala desde el portal.");
    }
    const customer = await customerForUser(stripe, context.db, context.user, context.profile.stripe_customer_id);
    // Stable for retries of this random client idempotency key (Stripe requires identical parameters).
    const suffix = Array.from(createHash("sha256").update(`${context.user.id}:${key}`).digest().subarray(0, 8), (byte) => String.fromCharCode(97 + byte % 26)).join("");
    const session = await stripe.checkout.sessions.create({
      mode: offer.kind, customer, line_items: [{ price: priceId, quantity: 1 }],
      integration_identifier: `talktoad-${suffix}`,
      success_url: `${appOrigin()}/?billing=processing`, cancel_url: `${appOrigin()}/?billing=cancelled`,
      // Dynamic payment methods are managed by Stripe. Never grant credits here.
    }, { idempotencyKey: `checkout-${context.user.id}-${body.offer}-${key}` });
    if (!session.url) throw new ApiError(503, "checkout_unavailable", "No se pudo abrir el pago.");
    return json({ url: session.url, mode: "sandbox" });
  } catch (error) { return apiError(error); }
}
