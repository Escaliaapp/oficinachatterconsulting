import { stripeClient } from "../../../../lib/payments/stripe";
import { verifyStripeEvent } from "../../../../lib/payments/webhook-verification";
import { processStripeEvent } from "../../../../lib/payments/webhooks";
import { apiError, json, readLimitedText, requiredEnv, serviceSupabase } from "../../../../lib/supabase/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const db = serviceSupabase();
    const stripe = stripeClient();
    const raw = await readLimitedText(request, 1_048_576);
    let event;
    try { event = verifyStripeEvent(raw, request.headers.get("stripe-signature"), requiredEnv("STRIPE_WEBHOOK_SECRET"), stripe); }
    catch { return json({ error: "Firma de webhook no válida.", code: "invalid_signature" }, 400); }
    const result = await processStripeEvent(event, stripe, db);
    return json({ received: true, ...result });
  } catch (error) { return apiError(error); }
}
