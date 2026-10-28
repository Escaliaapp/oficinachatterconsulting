import { z } from 'zod';
import { apiError, ApiError, json, parseBody, requireOfficeUser, verifyOrigin, rateLimit } from '@/lib/supabase/server';
import { CONNECTORS } from '@/lib/chatter/connectors/catalog';
import { connectorConfig, encryptionReady, saveConnector } from '@/lib/chatter/connectors/server';

export async function GET(request: Request) {
  try {
    await requireOfficeUser(request);
    const configs = await Promise.all(CONNECTORS.map(async ({ id }) => ({ id, ...await connectorConfig(id) })));
    return json({ storageReady: configs.every(item => item.storageReady), encryptionReady: encryptionReady(), connectors: configs.map(({ id, enabled, configured, testedAt, testOk, message }) => ({ id, enabled, configured, testedAt, testOk, message })) });
  } catch (error) { return apiError(error); }
}
const schema = z.object({ id: z.enum(['openrouter','apollo','google','gohighlevel']), action: z.enum(['save','test']), enabled: z.boolean().optional(), fields: z.record(z.string(), z.string().max(4096)).default({}) }).strict();
export async function POST(request: Request) {
  try {
    const { db, user } = await requireOfficeUser(request);
    verifyOrigin(request);
    rateLimit(`connectors:${user.id}`, 20);
    const input = await parseBody(request, schema);
    if (input.action === 'save') {
      if (input.enabled === undefined) throw new ApiError(400, 'enabled_required', 'Indique si desea activar el conector.');
      await saveConnector(input.id, input.enabled, input.fields);
      return json({ message: input.enabled ? 'Conector activado.' : 'Conector desactivado. No se iniciarán nuevas llamadas con él.' });
    }
    const config = await connectorConfig(input.id);
    if (!config.configured) throw new ApiError(400, 'missing_credentials', 'Guarda primero las credenciales.');
    if (!['apollo','openrouter'].includes(input.id)) return json({ message: 'La conexión se verifica al ejecutar una tarea. Esta prueba no realiza búsquedas ni crea contactos.' });
    let ok = false;
    try {
      const response = await fetch(input.id === 'apollo' ? 'https://api.apollo.io/api/v1/auth/health' : 'https://openrouter.ai/api/v1/key', {
        headers: input.id === 'apollo' ? { 'x-api-key': config.credentials.APOLLO_API_KEY } : { Authorization: `Bearer ${config.credentials.OPENROUTER_API_KEY}` },
        cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      ok = response.ok && (input.id !== 'apollo' || (result.healthy === true && result.is_logged_in === true));
    } catch { /* Return a safe message, never a provider payload or credential. */ }
    const message = ok ? 'Autenticación verificada. Los permisos de cada operación se comprueban al ejecutarla.' : 'No se pudo verificar el acceso. Revisa la clave, los permisos o la disponibilidad del proveedor.';
    if (config.storageReady) {
      const { error } = await db.from('chatter_connectors').upsert({ id: input.id, enabled: config.enabled, tested_at: new Date().toISOString(), test_ok: ok, test_message: message });
      if (error) throw new ApiError(503, 'test_save_failed', 'La prueba terminó, pero no se pudo guardar su estado.');
    }
    return json({ ok, message });
  } catch (error) { return apiError(error); }
}
