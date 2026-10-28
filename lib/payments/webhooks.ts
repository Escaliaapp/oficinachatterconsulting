import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, requiredEnv } from "../supabase/server";
import { BILLING_OFFERS, isPaidCheckout } from "./catalog";

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}
async function ownerOfCustomer(db: SupabaseClient, customer: unknown): Promise<{ userId: string; customerId: string }> {
  const customerId = objectId(customer);
  if (!customerId) throw new ApiError(503, "billing_owner_missing", "No se pudo identificar la cuenta de facturación.");
  const { data, error } = await db.from("profiles").select("id").eq("stripe_customer_id", customerId).single();
  if (error || !data) throw new ApiError(503, "billing_owner_missing", "La cuenta de facturación requiere reconciliación.");
  return { userId: data.id as string, customerId };
}
async function subscriptionPayload(stripe: Stripe, subscriptionId: string) {
  // Retrieve current state to survive Stripe's unordered event delivery.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const membership = BILLING_OFFERS.membership;
  const item = subscription.items.data.find((row) => row.price.id === requiredEnv(membership.priceVariable));
  if (!item) throw new ApiError(503, "subscription_price_unknown", "La suscripción requiere revisión del catálogo.");
  return { subscription_id: subscription.id, status: subscription.status, period_end: new Date(item.current_period_end * 1000).toISOString(), customer: subscription.customer, cancel_at_period_end: subscription.cancel_at_period_end };
}
export async function processStripeEvent(event: Stripe.Event, stripe: Stripe, db: SupabaseClient): Promise<{ processed: boolean }> {
  let payload: Record<string, unknown> | null = null;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const eventSession = event.data.object as Stripe.Checkout.Session;
    const session = await stripe.checkout.sessions.retrieve(eventSession.id, { expand: ["line_items"] });
    // Subscription allowance belongs exclusively to invoice.paid, including the first invoice.
    if (!isPaidCheckout(session)) return { processed: false };
    const offer = BILLING_OFFERS.credits;
    const lines = session.line_items?.data;
    if (session.line_items?.has_more || lines?.length !== 1 || lines[0].quantity !== 1 || lines[0].price?.id !== requiredEnv(offer.priceVariable) || session.currency !== offer.currency || session.amount_total !== offer.amountCents) throw new ApiError(503, "purchase_mismatch", "El pago requiere revisión del catálogo.");
    const owner = await ownerOfCustomer(db, session.customer);
    const paymentId = objectId(session.payment_intent);
    if (!paymentId) throw new ApiError(503, "payment_missing", "El pago requiere reconciliación.");
    // A second delivery with a different event id still shares this payment-level key.
    payload = { user_id: owner.userId, customer_id: owner.customerId, purchase_id: paymentId, credits: offer.credits, paid: true, amount_total: session.amount_total, currency: session.currency };
  } else if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const owner = await ownerOfCustomer(db, session.customer);
    payload = { user_id: owner.userId, customer_id: owner.customerId, purchase_id: objectId(session.payment_intent), paid: false, payment_status: "failed" };
  } else if (event.type.startsWith("customer.subscription.")) {
    const resource = event.data.object as Stripe.Subscription;
    const subscription = await subscriptionPayload(stripe, resource.id);
    const owner = await ownerOfCustomer(db, subscription.customer);
    payload = { ...subscription, user_id: owner.userId, customer_id: owner.customerId, credits: 0, paid: false };
    delete payload.customer;
  } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = await stripe.invoices.retrieve((event.data.object as Stripe.Invoice).id, { expand: ["lines.data"] });
    const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription);
    if (!subscriptionId) return { processed: false };
    const subscription = await subscriptionPayload(stripe, subscriptionId);
    const owner = await ownerOfCustomer(db, invoice.customer);
    const offer = BILLING_OFFERS.membership;
    const expectedPrice = requiredEnv(offer.priceVariable);
    const membershipLines = invoice.lines.data.filter((line) => line.pricing?.price_details?.price === expectedPrice && !line.parent?.subscription_item_details?.proration);
    const qualifies = event.type === "invoice.paid" && invoice.status === "paid" && invoice.amount_paid >= offer.amountCents && invoice.currency === offer.currency && membershipLines.length === 1 && membershipLines[0].quantity === 1 && (invoice.billing_reason === "subscription_create" || invoice.billing_reason === "subscription_cycle");
    payload = { ...subscription, user_id: owner.userId, customer_id: owner.customerId, purchase_id: invoice.id, credits: qualifies ? offer.credits : 0, paid: qualifies, payment_status: event.type === "invoice.payment_failed" ? "failed" : "paid" };
    delete payload.customer;
  } else if (event.type === "charge.refunded") {
    const charge = await stripe.charges.retrieve((event.data.object as Stripe.Charge).id);
    const paymentId = objectId(charge.payment_intent);
    if (!paymentId) return { processed: false };
    const owner = await ownerOfCustomer(db, charge.customer);
    payload = { user_id: owner.userId, customer_id: owner.customerId, purchase_id: paymentId, refund_amount: charge.amount_refunded, payment_amount: charge.amount, fully_refunded: charge.refunded };
  }
  if (!payload) return { processed: false };
  const { error } = await db.rpc("apply_stripe_event", { p_event_id: event.id, p_type: event.type, p_payload: payload });
  if (error) throw new ApiError(503, "webhook_transaction_failed", "El evento no pudo aplicarse; se reintentará.");
  return { processed: true };
}
