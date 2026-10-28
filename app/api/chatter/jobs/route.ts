import { apiError, json } from "@/lib/supabase/server";
import { requireOfficeUser } from "@/lib/supabase/server";
import { parseBody, verifyOrigin } from '@/lib/supabase/server';
import { enqueueJob } from '@/lib/chatter/operations/jobs';
import { z } from 'zod';

export async function POST(request: Request) {
  try {
    const { db, user } = await requireOfficeUser(request);
    verifyOrigin(request);
    const input = await parseBody(request, z.object({ objective: z.string().trim().min(3).max(2000), idempotencyKey: z.string().uuid() }).strict());
    const job = await enqueueJob(db, { employeeId: 'diego', objective: input.objective, source: 'office', requestedBy: user.id, idempotencyKey: input.idempotencyKey });
    return json({ job }, 201);
  } catch(error) { return apiError(error); }
}

export async function GET(request: Request) {
  try {
    const { db } = await requireOfficeUser(request);
    const result = await db.from("chatter_jobs").select("id,employee_id,objective,status,result_summary,created_at").order("created_at", { ascending: false }).limit(100);
    if (result.error) throw new Error("jobs_read_failed");
    return json({ jobs: result.data ?? [] });
  } catch (error) { return apiError(error); }
}
