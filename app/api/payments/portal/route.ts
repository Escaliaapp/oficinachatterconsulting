import { stripeClient } from "../../../../lib/payments/stripe";
import { ApiError, apiError, appOrigin, json, rateLimit, requireUser, verifyOrigin } from "../../../../lib/supabase/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const { user, profile } = await requireUser(request);
    rateLimit(`portal:${user.id}`, 5);
    if (!profile.stripe_customer_id) throw new ApiError(409, "customer_missing", "Aún no tienes una cuenta de facturación.");
    const session = await stripeClient().billingPortal.sessions.create({ customer: profile.stripe_customer_id, return_url: appOrigin() });
    return json({ url: session.url, mode: "sandbox" });
  } catch (error) { return apiError(error); }
}
