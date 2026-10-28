import type Stripe from "stripe";

/** Raw bytes must reach constructEvent unchanged; never JSON.parse before verification. */
export function verifyStripeEvent(raw: string, signature: string | null, secret: string, stripe: Stripe): Stripe.Event {
  if (!signature || !secret || raw.length > 1_048_576) throw new Error("Invalid webhook envelope");
  const event = stripe.webhooks.constructEvent(raw, signature, secret, 300);
  if (event.livemode) throw new Error("This MVP accepts sandbox events only");
  return event;
}
