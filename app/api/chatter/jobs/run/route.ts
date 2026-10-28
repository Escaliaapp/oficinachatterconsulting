import { apiError, json, requiredEnv, requireOfficeUser, serviceSupabase } from "@/lib/supabase/server";
import { searchGooglePlaces } from "@/lib/chatter/operations/google-places";
import { createGoHighLevelContact } from "@/lib/chatter/operations/gohighlevel";

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CHATTER_CRON_SECRET?.trim();
    const cronAuth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const db = cronSecret && cronAuth === cronSecret ? serviceSupabase() : (await requireOfficeUser(request)).db;
    const { data: jobs, error } = await db.from("chatter_jobs").select("id,employee_id,objective,status").eq("status", "queued").eq("employee_id", "diego").order("created_at", { ascending: true }).limit(1);
    if (error) throw new Error("jobs_read_failed");
    const job = jobs?.[0];
    if (!job) return json({ ok: true, message: "No hay tareas de Diego en cola." });
    await db.from("chatter_jobs").update({ status: "running" }).eq("id", job.id);
    const leads = await searchGooglePlaces(job.objective, 20);
    let sent = 0;
    for (const lead of leads) {
      const existing = lead.placeId ? await db.from("chatter_leads").select("id").eq("place_id", lead.placeId).maybeSingle() : { data: null };
      if (existing.data) { await db.from("chatter_leads").insert({ job_id: job.id, name: lead.name, address: lead.address, phone: lead.phone, website: lead.website, maps_url: lead.mapsUrl, place_id: lead.placeId, crm_status: "duplicate" }); continue; }
      let crmStatus = "pending"; let crmContactId: string | null = null;
      if (lead.phone || lead.website) { const created = await createGoHighLevelContact({ name: lead.name, phone: lead.phone, website: lead.website, companyName: lead.name, source: "Diego · Google Places" }); crmContactId = created.contact?.id ?? null; crmStatus = "sent"; sent++; }
      await db.from("chatter_leads").insert({ job_id: job.id, name: lead.name, address: lead.address, phone: lead.phone, website: lead.website, maps_url: lead.mapsUrl, place_id: lead.placeId, crm_contact_id: crmContactId, crm_status: crmStatus });
    }
    const summary = `Google Places encontró ${leads.length} prospectos; ${sent} enviados a GoHighLevel.`;
    await db.from("chatter_jobs").update({ status: "completed", result_summary: summary }).eq("id", job.id);
    return json({ ok: true, jobId: job.id, found: leads.length, sentToGoHighLevel: sent, leads });
  } catch (error) { return apiError(error); }
}
