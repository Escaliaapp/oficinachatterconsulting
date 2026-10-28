import { apiError, json, requiredEnv, requireOfficeUser, serviceSupabase } from "@/lib/supabase/server";
import { searchGooglePlaces } from "@/lib/chatter/operations/google-places";
import { createGoHighLevelContact } from "@/lib/chatter/operations/gohighlevel";
import { searchApolloPeople } from "@/lib/chatter/operations/apollo";
import { randomDiegoCity } from "@/lib/chatter/operations/diego-cities";

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CHATTER_CRON_SECRET?.trim();
    const cronAuth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const db = cronSecret && cronAuth === cronSecret ? serviceSupabase() : (await requireOfficeUser(request)).db;
    const { data: jobs, error } = await db.from("chatter_jobs").select("id,employee_id,objective,status").eq("status", "queued").eq("employee_id", "diego").order("created_at", { ascending: true }).limit(1);
    if (error) throw new Error("jobs_read_failed");
    let job = jobs?.[0];
    if (!job && cronSecret && cronAuth === cronSecret) {
      const city = randomDiegoCity();
      const key = `diego-daily-${new Date().toISOString().slice(0,10)}`;
      const created = await db.from("chatter_jobs").upsert({ employee_id: "diego", objective: `Busca 10 inmobiliarias en ${city}`, source: "schedule", requested_by: "system", idempotency_key: key, status: "queued" }, { onConflict: "idempotency_key" }).select("id,employee_id,objective,status").single();
      if (created.error) throw new Error("daily_job_create_failed");
      job = created.data;
    }
    if (!job) return json({ ok: true, message: "No hay tareas de Diego en cola." });
    const dailyLimit = Math.max(1, Number(process.env.DIEGO_DAILY_LIMIT || 10));
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await db.from("chatter_leads").select("id", { count: "exact", head: true }).gte("created_at", since);
    const remaining = Math.max(0, dailyLimit - (recent.count ?? 0));
    if (!remaining) { await db.from("chatter_jobs").update({ status: "completed", result_summary: `No se ejecutó: límite de ${dailyLimit} prospectos alcanzado en las últimas 24 horas.` }).eq("id", job.id); return json({ ok: true, jobId: job.id, message: `Límite de ${dailyLimit} prospectos alcanzado en las últimas 24 horas.` }); }
    await db.from("chatter_jobs").update({ status: "running" }).eq("id", job.id);
    const leads = (await searchGooglePlaces(job.objective, Math.min(20, remaining))).slice(0, remaining);
    const people = process.env.APOLLO_API_KEY?.trim() ? (await searchApolloPeople(job.objective)).slice(0, Math.max(0, remaining - leads.length)) : [];
    let sent = 0;
    for (const lead of leads) {
      const existing = lead.placeId ? await db.from("chatter_leads").select("id").eq("place_id", lead.placeId).maybeSingle() : { data: null };
      if (existing.data) { await db.from("chatter_leads").insert({ job_id: job.id, name: lead.name, address: lead.address, phone: lead.phone, website: lead.website, maps_url: lead.mapsUrl, place_id: lead.placeId, crm_status: "duplicate" }); continue; }
      let crmStatus = "pending"; let crmContactId: string | null = null;
      if (lead.phone || lead.website) { const created = await createGoHighLevelContact({ name: lead.name, phone: lead.phone, website: lead.website, companyName: lead.name, source: "Diego · Google Places" }); crmContactId = created.contact?.id ?? null; crmStatus = "sent"; sent++; }
      await db.from("chatter_leads").insert({ job_id: job.id, name: lead.name, address: lead.address, phone: lead.phone, website: lead.website, maps_url: lead.mapsUrl, place_id: lead.placeId, crm_contact_id: crmContactId, crm_status: crmStatus });
    }
    for (const person of people) {
      const name = [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Contacto Apollo';
      await db.from("chatter_leads").insert({ job_id: job.id, name, source: "apollo", crm_status: "pending" });
    }
    const summary = `Google Places encontró ${leads.length} empresas; Apollo encontró ${people.length} responsables; ${sent} enviados a GoHighLevel.`;
    await db.from("chatter_jobs").update({ status: "completed", result_summary: summary }).eq("id", job.id);
    return json({ ok: true, jobId: job.id, found: leads.length, sentToGoHighLevel: sent, leads });
  } catch (error) { return apiError(error); }
}
