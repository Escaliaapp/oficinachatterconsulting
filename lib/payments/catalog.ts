export const BILLING_OFFERS = {
  membership: { kind: "subscription", credits: 600, amountCents: 1200, currency: "usd", priceVariable: "STRIPE_SUBSCRIPTION_PRICE_ID" },
  credits: { kind: "payment", credits: 1000, amountCents: 1000, currency: "usd", priceVariable: "STRIPE_CREDITS_PRICE_ID" },
} as const;
export type BillingOffer = keyof typeof BILLING_OFFERS;
export function isPaidCheckout(session: { payment_status?: string | null; status?: string | null; mode?: string | null }) {
  return session.payment_status === "paid" && session.status === "complete" && session.mode === "payment";
}
export function refundCredits(totalCredits: number, refundedCents: number, paidCents: number) {
  if (![totalCredits, refundedCents, paidCents].every(Number.isSafeInteger) || totalCredits < 0 || refundedCents < 0 || paidCents <= 0 || refundedCents > paidCents) throw new Error("Invalid refund amounts");
  return Math.min(totalCredits, Math.ceil(totalCredits * refundedCents / paidCents));
}
