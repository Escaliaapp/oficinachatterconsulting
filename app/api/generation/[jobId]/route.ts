import { z } from "zod";
import { moderatePolicy, moderateText } from "../../../../lib/providers/moderation";
import { estimatedClipCost, videoProvider } from "../../../../lib/providers/server";
import { ProviderError } from "../../../../lib/providers/types";
import { ApiError, apiError, idempotencyKey, json, parseBody, rateLimit, requireRoomModerator, requireUser, verifyOrigin } from "../../../../lib/supabase/server";
import { outputPath, savePrivateClip, signedClipUrl } from "../../../../lib/supabase/storage";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ jobId: string }> };
interface Job { id: string; room_id: string; proposal_id: string; status: string; provider_request_id: string | null; started_at: string | null; created_at: string; estimated_cost: number; error: string | null }
async function authorizedJob(request: Request, route: RouteContext) {
  const { jobId } = await route.params;
  if (!z.string().uuid().safeParse(jobId).success) throw new ApiError(404, "job_missing", "No se encontró la generación.");
  const context = await requireUser(request);
  const { data, error } = await context.db.from("generation_jobs").select("*").eq("id", jobId).single();
  if (error || !data) throw new ApiError(404, "job_missing", "No se encontró la generación.");
  const job = data as Job;
  await requireRoomModerator(request, job.room_id);
  return { ...context, job };
}
export async function GET(request: Request, route: RouteContext) {
  try {
    const { db, job } = await authorizedJob(request, route);
    return json({ id: job.id, state: job.status, estimatedCostUsd: job.estimated_cost, error: job.error, ...(job.status === "processing_output" || job.status === "ready" ? { preview: await signedClipUrl(db, outputPath(job.room_id, job.id)) } : {}) });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, route: RouteContext) {
  try {
    verifyOrigin(request);
    const { db, job, user } = await authorizedJob(request, route);
    const { action, reason } = await parseBody(request, z.object({ action: z.enum(["start", "poll", "cancel", "approve", "reject"]), reason: z.string().trim().min(8).max(500).optional() }).strict());
    rateLimit(`generation:${user.id}`, 60);
    const key = idempotencyKey(request);
    const update = async (status: string, message: string | null = null) => {
      const { error } = await db.rpc("update_generation_job", { p_job_id: job.id, p_status: status, p_error: message });
      if (error) throw new ApiError(409, "job_state_changed", "El estado de generación cambió. Actualiza la sala.");
    };
    if (action === "start") {
      const provider = videoProvider(); // configuration is verified before any claim
      const proposal = await db.from("scene_proposals").select("prompt,kind").eq("id", job.proposal_id).single();
      if (proposal.error || !proposal.data) throw new ApiError(409, "proposal_missing", "No se encontró la propuesta original.");
      const text = proposal.data.prompt as string;
      const local = moderatePolicy(text, proposal.data.kind === "sponsored" ? "advertisement" : "proposal");
      if (!local.approved) throw new ApiError(422, "moderation_rejected", local.reason);
      if (process.env.OPENAI_API_KEY) {
        const verdict = await moderateText(text, "proposal", process.env.OPENAI_API_KEY);
        if (!verdict.approved) throw new ApiError(422, "moderation_held", verdict.reason);
      } else {
        const review = await db.from("moderation_decisions").select("id").eq("target_type", "proposal").eq("target_id", job.proposal_id).eq("decision", "approved").not("reviewer_id", "is", null).limit(1);
        if (review.error || !review.data?.length) throw new ApiError(409, "human_review_required", "Se requiere aprobación humana del texto cuando OpenAI no está configurado.");
      }
      const claim = await db.rpc("claim_generation_job", { p_job_id: job.id, p_estimated_cost: estimatedClipCost() });
      if (claim.error) throw new ApiError(409, "job_unavailable", "La generación ya está en curso, la sala está pausada o se alcanzó su presupuesto.");
      try {
        const handle = await provider.submit({ prompt: text });
        const { error } = await db.rpc("record_generation_submission", { p_job_id: job.id, p_request_id: handle.requestId });
        if (error) {
          // Provider accepted it but DB could not record it: best-effort cancel; never resubmit.
          await provider.cancel(handle).catch(() => undefined);
          await update("failed", "submission_persistence_unknown");
          throw new ApiError(503, "reconciliation_required", "El envío necesita reconciliación manual antes de reintentarse.");
        }
        return json({ id: job.id, state: "submitted", estimatedCostUsd: estimatedClipCost() }, 202);
      } catch (error) {
        if (error instanceof ProviderError) { await update("failed", error.code); throw new ApiError(503, error.code, error.message); }
        throw error;
      }
    }
    if (action === "approve" || action === "reject") {
      if (!reason) throw new ApiError(400, "reason_required", "Registra el motivo de la revisión audiovisual.");
      if (job.status === "ready" && action === "approve") return json({ id: job.id, state: "ready" });
      if (job.status !== "processing_output") throw new ApiError(409, "output_not_ready", "El video debe terminar de procesarse antes de su revisión.");
      // Verifies that only the server's deterministic private object can be published.
      await signedClipUrl(db, outputPath(job.room_id, job.id));
      const decision = await db.from("moderation_decisions").insert({ room_id: job.room_id, target_type: "video", target_id: job.id, reviewer_id: user.id, decision: action === "approve" ? "approved" : "rejected", reason });
      if (decision.error) throw new ApiError(503, "review_persistence_failed", "No se pudo guardar la revisión.");
      if (action === "reject") { await update("rejected", reason); return json({ id: job.id, state: "rejected" }); }
      const result = await db.rpc("finish_generation_job", { p_job_id: job.id, p_storage_path: outputPath(job.room_id, job.id), p_duration_seconds: 5, p_idempotency_key: `${user.id}:${key}` });
      if (result.error) throw new ApiError(409, "publish_failed", "No se pudo incorporar el clip a la cola.");
      return json({ id: job.id, state: "ready", clipId: result.data });
    }
    if (["ready", "rejected", "failed", "cancelled"].includes(job.status)) return json({ id: job.id, state: job.status });
    if (!job.provider_request_id) throw new ApiError(409, "submission_unconfirmed", "La generación todavía no tiene un envío confirmado.");
    const provider = videoProvider();
    const handle = { requestId: job.provider_request_id, submittedAt: new Date(job.started_at ?? job.created_at).getTime() };
    if (action === "cancel") {
      const cancellation = await provider.cancel(handle);
      // Cancellation locally prevents publication even if an in-flight provider request finishes.
      await update("cancelled", cancellation.confirmed ? "cancelled_before_processing" : "cancellation_requested_provider_may_finish");
      return json({ id: job.id, state: "cancelled", providerCancellationConfirmed: cancellation.confirmed, costMayApply: !cancellation.confirmed });
    }
    const status = await provider.status(handle);
    if (status.stage === "processing_output") {
      const result = await provider.result(handle);
      await savePrivateClip(db, result.url, outputPath(job.room_id, job.id));
      await update("processing_output");
      return json({ id: job.id, state: "processing_output", requiresHumanReview: true, latencyMs: result.latencyMs, preview: await signedClipUrl(db, outputPath(job.room_id, job.id)) });
    }
    if (Date.now() - handle.submittedAt > 120_000) {
      await provider.cancel(handle).catch(() => undefined);
      await update("failed", "generation_deadline_manual_reconciliation");
      return json({ id: job.id, state: "failed", error: "Se superó el tiempo máximo. No se reenvió la solicitud; requiere revisión.", costMayApply: true }, 504);
    }
    if (status.stage === "generating" && job.status !== "generating") await update("generating");
    return json({ id: job.id, state: status.stage === "queued" ? "submitted" : status.stage, latencyMs: status.latencyMs, queuePosition: status.queuePosition });
  } catch (error) { return error instanceof ProviderError ? apiError(new ApiError(503, error.code, error.message)) : apiError(error); }
}
