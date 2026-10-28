import { z } from 'zod';
import { apiError, ApiError, json, parseBody, requireOfficeUser, serviceSupabase, verifyOrigin } from '@/lib/supabase/server';
import { connectorConfig } from '@/lib/chatter/connectors/server';
import { searchGooglePlaces } from '@/lib/chatter/operations/google-places';
import { createGoHighLevelContact } from '@/lib/chatter/operations/gohighlevel';
import { searchApolloPeople } from '@/lib/chatter/operations/apollo';
import { randomDiegoCity } from '@/lib/chatter/operations/diego-cities';

export const maxDuration = 300;
export async function POST(request: Request) { return execute(request, false); }
export async function GET(request: Request) { return execute(request, true); }

async function execute(request: Request, scheduled: boolean) {
  let jobId: string | undefined;
  let saved = 0;
  let stage = 'configuración';
  try {
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const isCron = [process.env.CRON_SECRET, process.env.CHATTER_CRON_SECRET].some(secret => Boolean(secret?.trim() && bearer === secret.trim()));
    if (scheduled && !isCron) throw new ApiError(401, 'invalid_cron', 'Ejecución programada no autorizada.');
    const db = isCron ? serviceSupabase() : (await requireOfficeUser(request)).db;
    if (!isCron) verifyOrigin(request);
    const input = request.headers.get('content-type')?.includes('application/json') ? await parseBody(request, z.object({ source: z.enum(['apollo','google']).optional() }).strict()) : {};
    const [apollo, google, crm] = await Promise.all([connectorConfig('apollo'), connectorConfig('google'), connectorConfig('gohighlevel')]);
    if (!apollo.storageReady) throw new ApiError(503, 'operations_setup_required', 'Aplica la migración de Conectores en Supabase para habilitar esta ejecución.');
    const source = input.source || (apollo.enabled && apollo.configured ? 'apollo' : 'google');
    const config = source === 'apollo' ? apollo : google;
    if (!config.enabled || !config.configured) throw new ApiError(409, 'source_disabled', 'Activa y configura la fuente seleccionada en Conectores.');
    if (scheduled) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
      const { error } = await db.from('chatter_jobs').upsert({ employee_id: 'diego', objective: `Busca 10 inmobiliarias en ${randomDiegoCity()}`, source: 'schedule', requested_by: 'system', idempotency_key: `diego-daily-${day}`, status: 'queued' }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      if (error) throw new ApiError(503, 'schedule_failed', 'No se pudo preparar la tarea diaria.');
    }
    const claim = await db.rpc('chatter_claim_diego_job');
    if (claim.error) throw new ApiError(503, 'claim_failed', 'No se pudo iniciar la tarea. Verifica la migración de Conectores.');
    const job = claim.data?.[0];
    if (!job) return json({ ok: true, message: 'No hay tareas en cola o Diego ya está ejecutando otra. Revisa Tareas.' });
    jobId = job.id;
    stage = 'límite diario';
    const dailyLimit = Math.min(10, Math.max(1, Number(process.env.DIEGO_DAILY_LIMIT) || 10));
    const recent = await db.from('chatter_leads').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString());
    if (recent.error) throw new ApiError(503, 'quota_read_failed', 'No se pudo verificar el límite diario.');
    const remaining = Math.max(0, dailyLimit - (recent.count ?? 0));
    let sent = 0;
    let duplicates = 0;
    let crmFailed = 0;
    if (remaining) {
      stage = source === 'apollo' ? 'Apollo API' : 'Google Places API';
      if (source === 'apollo') {
        const people = (await searchApolloPeople(job.objective)).slice(0, remaining);
        for (const person of people) {
          if (!person.id) continue;
          const record = await db.from('chatter_leads').insert({ job_id: job.id, apollo_person_id: person.id, name: [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Perfil Apollo', address: [person.title, person.organization?.name].filter(Boolean).join(' · '), source: 'apollo_icp', crm_status: 'pending' });
          if (record.error?.code === '23505') { duplicates++; continue; }
          if (record.error) throw new ApiError(503, 'lead_save_failed', 'No se pudo guardar el prospecto de Apollo.');
          saved++;
        }
      } else {
        const places = await searchGooglePlaces(job.objective, remaining);
        for (const lead of places.slice(0, remaining)) {
          const record = await db.from('chatter_leads').insert({ job_id: job.id, name: lead.name, address: lead.address, phone: lead.phone, website: lead.website, maps_url: lead.mapsUrl, place_id: lead.placeId, source: 'google_places', crm_status: 'pending' }).select('id').single();
          if (record.error?.code === '23505') { duplicates++; continue; }
          if (record.error) throw new ApiError(503, 'lead_save_failed', 'No se pudo guardar el prospecto de Google.');
          saved++;
          if (crm.enabled && crm.configured && (lead.phone || lead.website)) {
            stage = 'GoHighLevel API';
            let contactId: string | null = null;
            try {
              const result = await createGoHighLevelContact({ name: lead.name, companyName: lead.name, phone: lead.phone, website: lead.website, source: 'Diego · Google Places' });
              contactId = result.contact?.id ?? null;
            } catch { /* Preserve the local lead; do not retry external writes blindly. */ }
            const update = await db.from('chatter_leads').update({ crm_contact_id: contactId, crm_status: contactId ? 'sent' : 'failed' }).eq('id', record.data.id);
            if (update.error) throw new ApiError(503, 'crm_status_save_failed', 'El prospecto está guardado, pero no se pudo registrar el envío al CRM. Revisa el CRM antes de reintentar.');
            if (contactId) sent++; else crmFailed++;
          }
        }
      }
    }
    const summary = remaining ? `${source === 'apollo' ? 'Apollo API' : 'Google Places API'}: ${saved} prospectos guardados, ${duplicates} duplicados omitidos. CRM: ${sent} enviados, ${crmFailed} fallidos.${source === 'apollo' ? ' Sin enriquecimiento de correo/teléfono; perfiles pendientes de revisión.' : ''} Costo monetario: no medido.` : `Límite de ${dailyLimit} prospectos en 24 horas alcanzado; no se consultaron proveedores.`;
    const finish = await db.from('chatter_jobs').update({ status: 'completed', result_summary: summary, finished_at: new Date().toISOString() }).eq('id', job.id);
    if (finish.error) throw new ApiError(503, 'job_save_failed', 'No se pudo guardar el cierre de la tarea.');
    return json({ ok: true, jobId, found: saved, sentToGoHighLevel: sent, message: summary });
  } catch (error) {
    const safe = error instanceof ApiError ? error : new ApiError(503, 'execution_failed', `Falló la etapa ${stage}. Revisa la conexión y los permisos del servicio.`);
    if (jobId) {
      try { await serviceSupabase().from('chatter_jobs').update({ status: 'failed', error_code: safe.code, result_summary: `${safe.message} Prospectos guardados antes del error: ${saved}.`, finished_at: new Date().toISOString() }).eq('id', jobId); } catch { /* Keep original safe error. */ }
    }
    return apiError(safe);
  }
}
