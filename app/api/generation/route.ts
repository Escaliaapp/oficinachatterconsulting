import { z } from "zod";
import { ApiError, apiError, idempotencyKey, json, parseBody, rateLimit, requireRoomModerator, requireUser, verifyOrigin } from "../../../lib/supabase/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const context = await requireUser(request);
    const { proposalId } = await parseBody(request, z.object({ proposalId: z.string().uuid() }).strict());
    const proposal = await context.db.from("scene_proposals").select("room_id").eq("id", proposalId).single();
    if (proposal.error || !proposal.data) throw new ApiError(404, "proposal_missing", "No se encontró la propuesta.");
    await requireRoomModerator(request, proposal.data.room_id);
    rateLimit(`enqueue:${context.user.id}`, 10);
    const { data, error } = await context.db.rpc("enqueue_approved_generation", { p_proposal_id: proposalId, p_idempotency_key: `${context.user.id}:${idempotencyKey(request)}` });
    if (error) throw new ApiError(409, "not_eligible", "La propuesta debe estar seleccionada, aprobada y cumplir los turnos de programación.");
    return json({ jobId: data, state: "queued" }, 202);
  } catch (error) { return apiError(error); }
}
