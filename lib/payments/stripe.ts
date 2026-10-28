import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, requiredEnv } from "../supabase/server";

export function stripeClient(): Stripe {
  const key = requiredEnv("STRIPE_SECRET_KEY");
  // This MVP is intentionally sandbox-only. Enabling live funds requires an explicit rollout.
  if (!/^[sr]k_test_/.test(key)) throw new ApiError(503, "sandbox_required", "Configura una clave de Stripe Sandbox para esta versión.");
  return new Stripe(key, { apiVersion: "2026-08-26.dahlia", maxNetworkRetries: 2, timeout: 15_000 });
}
export async function customerForUser(stripe: Stripe, db: SupabaseClient, user: { id: string; email?: string }, existing: string | null): Promise<string> {
  if (existing) return existing;
  const customer = await stripe.customers.create({ ...(user.email ? { email: user.email } : {}) }, { idempotencyKey: `customer-${user.id}` });
  const { error } = await db.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", user.id).is("stripe_customer_id", null);
  if (error) throw new ApiError(503, "customer_persistence_failed", "No se pudo guardar tu cuenta de facturación.");
  const profile = await db.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
  if (profile.error || profile.data?.stripe_customer_id !== customer.id) throw new ApiError(409, "customer_conflict", "Reintenta la operación de facturación.");
  return customer.id;
}
