import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createJobSchema, type CreateJob } from "./types";

export async function enqueueJob(db: SupabaseClient, input: CreateJob) {
  const job = createJobSchema.parse(input);
  const { data, error } = await db.from("chatter_jobs").upsert({
    employee_id: job.employeeId, objective: job.objective, source: job.source,
    requested_by: job.requestedBy, conversation_id: job.conversationId ?? null,
    idempotency_key: job.idempotencyKey, status: "queued",
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id,employee_id,status,objective").maybeSingle();
  if (error) throw new Error("job_enqueue_failed");
  if (data) return data;
  const existing = await db.from("chatter_jobs").select("id,employee_id,status,objective").eq("idempotency_key", job.idempotencyKey).single();
  if (existing.error || !existing.data) throw new Error("job_lookup_failed");
  return existing.data;
}

