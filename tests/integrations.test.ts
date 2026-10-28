import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { DemoVideoProvider } from "../lib/providers/demo";
import { FAL_MODEL, falInput, FalVideoProvider, isTrustedFalMedia } from "../lib/providers/fal";
import { CircuitBreaker, ProviderError } from "../lib/providers/types";
import { moderatePolicy, moderateText } from "../lib/providers/moderation";
import { BILLING_OFFERS, isPaidCheckout, refundCredits } from "../lib/payments/catalog";
import { verifyStripeEvent } from "../lib/payments/webhook-verification";
import { SnapshotReconciler } from "../lib/realtime";

test("demo determinista recorre cola, generación, resultado y cancelación sin red", async () => {
  let now = 100;
  const provider = new DemoVideoProvider("/media/moon-garden.mp4", () => now);
  const handle = await provider.submit({ prompt: "Un jardín lunar" });
  assert.equal(handle.requestId, (await provider.submit({ prompt: "Un jardín lunar" })).requestId);
  assert.equal((await provider.status(handle)).stage, "queued");
  await assert.rejects(provider.result(handle), /todavía/);
  now = 1100; assert.equal((await provider.status(handle)).stage, "generating");
  now = 3500; assert.equal((await provider.result(handle)).estimatedCostUsd, 0);
  await provider.cancel(handle);
  assert.equal((await provider.status(handle)).stage, "cancelled");
});
test("fal fija seguridad, duración, resolución y formato verificados", () => {
  assert.equal(FAL_MODEL, "minimax/h3-max/text-to-video");
  assert.deepEqual(falInput({ prompt: "  Un jardín lunar  " }), { prompt: "Un jardín lunar", duration: 5, resolution: "768P", aspect_ratio: "16:9", prompt_expansion_mode: "disabled", enable_safety_checker: true });
  assert.throws(() => falInput({ prompt: " " }), ProviderError);
  assert.equal(isTrustedFalMedia("https://v3.fal.media/files/video.mp4"), true);
  for (const url of ["http://127.0.0.1/video", "https://fal.media.evil.test/video", "https://user:pass@fal.media/x", "https://fal.media:8080/video", "file:///etc/passwd"]) assert.equal(isTrustedFalMedia(url), false);
});
test("fal reintenta solo lecturas transitorias y usa owner/app en queue status", async () => {
  const urls: string[] = []; let tries = 0;
  const mock: typeof fetch = async (url) => { urls.push(String(url)); return ++tries < 3 ? new Response("", { status: 503 }) : Response.json({ status: "IN_PROGRESS" }); };
  const provider = new FalVideoProvider("unit-test-placeholder", 0.40, mock, new CircuitBreaker(), () => 1000, async () => {});
  const status = await provider.status({ requestId: "request-1", submittedAt: 0 });
  assert.equal(status.stage, "generating"); assert.equal(tries, 3);
  assert.equal(urls[0], "https://queue.fal.run/minimax/h3-max/requests/request-1/status");
});
test("fal envía al endpoint H3 Max exacto y conserva el request id", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const provider = new FalVideoProvider("unit-test-placeholder", 0.40, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ request_id: "h3-request-1" });
  }, new CircuitBreaker(), () => 1234);
  const handle = await provider.submit({ prompt: "Una ciudad suspendida sobre nubes violetas", seed: 42 });
  assert.deepEqual(handle, { requestId: "h3-request-1", submittedAt: 1234 });
  assert.equal(calls[0].url, "https://queue.fal.run/minimax/h3-max/text-to-video");
  assert.deepEqual(calls[0].body, { prompt: "Una ciudad suspendida sobre nubes violetas", duration: 5, resolution: "768P", aspect_ratio: "16:9", prompt_expansion_mode: "disabled", enable_safety_checker: true, seed: 42 });
});
test("fal no repite un submit ambiguo que podría haber sido cobrado", async () => {
  let calls = 0;
  const provider = new FalVideoProvider("unit-test-placeholder", 0.40, async () => { calls++; throw new Error("network timeout"); });
  await assert.rejects(provider.submit({ prompt: "Jardín lunar" }), (error: unknown) => error instanceof ProviderError && error.code === "submission_unknown");
  assert.equal(calls, 1);
});
test("fal no declara una cancelación en curso como confirmada", async () => {
  const provider = new FalVideoProvider("unit-test-placeholder", 0.40, async () => Response.json({ status: "CANCELLATION_REQUESTED" }, { status: 202 }));
  assert.equal((await provider.cancel({ requestId: "abc", submittedAt: 0 })).confirmed, false);
});
test("circuit breaker se abre y se recupera tras enfriamiento", () => {
  let now = 0; const breaker = new CircuitBreaker(2, 1000, () => now);
  breaker.failure(); breaker.failure(); assert.throws(() => breaker.assertAvailable(), /pausa temporal/);
  now = 1001; assert.doesNotThrow(() => breaker.assertAvailable()); breaker.success();
});
test("moderación rechaza política y falla cerrado sin servicio", async () => {
  assert.equal(moderatePolicy("un deepfake no autorizado", "proposal").approved, false);
  assert.equal(moderatePolicy("visita https://example.test", "link").approved, false);
  assert.equal(moderatePolicy("campaña electoral", "advertisement").approved, false);
  assert.equal(moderatePolicy("un jardín lunar", "advertisement").requiresHuman, true);
  assert.equal((await moderateText("un jardín lunar", "proposal")).approved, false);
  assert.equal((await moderateText("un jardín lunar", "proposal", "test", async () => { throw new Error("offline"); })).approved, false);
  assert.equal((await moderateText("un jardín lunar", "proposal", "test", async () => Response.json({ results: [{ flagged: true }] }))).approved, false);
});
test("solo el checkout completo pagado concede pack; allowance de subs va por invoice", () => {
  assert.equal(BILLING_OFFERS.credits.credits, 1000);
  assert.equal(isPaidCheckout({ status: "complete", mode: "payment", payment_status: "unpaid" }), false);
  assert.equal(isPaidCheckout({ status: "complete", mode: "subscription", payment_status: "paid" }), false);
  assert.equal(isPaidCheckout({ status: "complete", mode: "payment", payment_status: "paid" }), true);
  assert.equal(refundCredits(1000, 250, 1000), 250);
  assert.throws(() => refundCredits(1000, 1100, 1000));
});
test("webhook verifica firma sobre texto raw y rechaza alteración o eventos live", () => {
  const stripe = new Stripe("unit-test-placeholder");
  const secret = "unit-test-webhook-secret";
  const payload = JSON.stringify({ id: "evt_test", object: "event", type: "checkout.session.completed", livemode: false, data: { object: {} } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(verifyStripeEvent(payload, signature, secret, stripe).id, "evt_test");
  assert.throws(() => verifyStripeEvent(`${payload} `, signature, secret, stripe));
  assert.throws(() => verifyStripeEvent(payload, null, secret, stripe));
  const live = payload.replace('"livemode":false', '"livemode":true');
  assert.throws(() => verifyStripeEvent(live, stripe.webhooks.generateTestHeaderString({ payload: live, secret }), secret, stripe), /sandbox/);
});
test("reconexión descarta snapshot antiguo y no actualiza después de cerrar", async () => {
  const resolvers: ((n: number) => void)[] = []; const applied: number[] = [];
  const reconciler = new SnapshotReconciler(() => new Promise<number>((resolve) => resolvers.push(resolve)), (n) => applied.push(n));
  const first = reconciler.recover(); const second = reconciler.recover();
  resolvers[1](2); await second; resolvers[0](1); await first;
  assert.deepEqual(applied, [2]);
  const last = reconciler.recover(); reconciler.dispose(); resolvers[2](3); await last;
  assert.deepEqual(applied, [2]);
});
