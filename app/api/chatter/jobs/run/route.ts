import { apiError, json, requiredEnv } from "@/lib/supabase/server";
import { requireOfficeUser } from "@/lib/supabase/server";
import { searchGooglePlaces } from "@/lib/chatter/operations/google-places";
import { createGoHighLevelContact } from "@/lib/chatter/operations/gohighlevel";

export async function POST(request: Request) {
  try {
    const { db } = await requireOfficeUser(request);
    const { data: jobs, error } = await db.from("chatter_jobs").select("id,employee_id,objective,status").eq("status", "queued").eq("employee_id", "diego").order("created_at", { ascending: true }).limit(1);
    if (error) throw new Error("jobs_read_failed");
    const job = jobs?.[0];
    if (!job) return json({ ok: true, message: "No hay tareas de Diego en cola." });
    await db.from("chatter_jobs").update({ status: "running" }).eq("id", job.id);
    const leads = await searchGooglePlaces(job.objective, 20);
    let sent = 0;
    for (const lead of leads) { if (lead.phone || lead.website) { await createGoHighLevelContact({ name: lead.name, phone: lead.phone, website: lead.website, companyName: lead.name, source: "Diego · Google Places" }); sent++; } }
    const summary = `Google Places encontró ${leads.length} prospectos; ${sent} enviados a GoHighLevel.`;
    await db.from("chatter_jobs").update({ status: "completed", result_summary: summary }).eq("id", job.id);
    return json({ ok: true, jobId: job.id, found: leads.length, sentToGoHighLevel: sent, leads });
  } catch (error) { return apiError(error); }
}
