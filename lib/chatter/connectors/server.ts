import 'server-only';
import { ApiError, serviceSupabase } from '@/lib/supabase/server';
import { CONNECTORS, type ConnectorId } from './catalog';
import { decryptCredentials, encryptCredentials } from './crypto';

export const encryptionReady = () => /^[a-fA-F0-9]{64}$/.test(process.env.CHATTER_CONNECTOR_ENCRYPTION_KEY ?? '');
export async function connectorConfig(id: ConnectorId) {
  const definition = CONNECTORS.find(item => item.id === id)!;
  const { data, error } = await serviceSupabase().from('chatter_connectors').select('*').eq('id', id).maybeSingle();
  // Older installations keep using existing environment credentials until the migration is applied.
  const missing = error?.code === 'PGRST205' || error?.code === '42P01';
  if (error && !missing) throw new ApiError(503, 'connectors_read_failed', 'No se pudo leer la configuración de herramientas.');
  let saved: Record<string, string> = {};
  if (data?.credentials) {
    try { saved = decryptCredentials(data.credentials, process.env.CHATTER_CONNECTOR_ENCRYPTION_KEY ?? '', id); }
    catch { throw new ApiError(503, 'connectors_key_missing', 'No se pudieron abrir las credenciales. Revisa la clave de cifrado del servidor.'); }
  }
  const credentials = Object.fromEntries(definition.fields.map(field => [field.key, saved[field.key] || process.env[field.key]?.trim() || '']));
  const configured = Object.values(credentials).every(value => Boolean(value) && !value.startsWith('PEGA_AQUI'));
  return { credentials, saved, storageReady: !missing, enabled: data?.enabled ?? configured, configured, testedAt: data?.tested_at ?? null, testOk: data?.test_ok ?? null, message: data?.test_message ?? null };
}
export async function connectorCredentials(id: ConnectorId) {
  const config = await connectorConfig(id);
  if (!config.enabled || !config.configured) throw new ApiError(409, 'connector_disabled', `Activa y configura ${CONNECTORS.find(item => item.id === id)!.name} en Conectores.`);
  return config.credentials;
}
export async function saveConnector(id: ConnectorId, enabled: boolean, fields: Record<string, string>) {
  const current = await connectorConfig(id);
  if (!current.storageReady) throw new ApiError(503, 'connectors_setup_required', 'Aplica la migración de Conectores en Supabase para guardar cambios.');
  const supplied = Object.fromEntries(Object.entries(fields).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]));
  const definition = CONNECTORS.find(item => item.id === id)!;
  if (Object.keys(supplied).some(key => !definition.fields.some(field => field.key === key))) throw new ApiError(400, 'invalid_field', 'Campo de conector no permitido.');
  if (enabled && definition.fields.some(field => !(supplied[field.key] || current.credentials[field.key]))) throw new ApiError(400, 'missing_credentials', 'Completa todos los campos para activar este conector.');
  const row: Record<string, unknown> = { id, enabled, updated_at: new Date().toISOString() };
  if (Object.keys(supplied).length) {
    if (!encryptionReady()) throw new ApiError(503, 'connectors_encryption_required', 'Configura CHATTER_CONNECTOR_ENCRYPTION_KEY en el servidor para guardar claves desde la oficina.');
    row.credentials = encryptCredentials({ ...current.saved, ...supplied }, process.env.CHATTER_CONNECTOR_ENCRYPTION_KEY!, id);
    row.tested_at = null; row.test_ok = null; row.test_message = null;
  }
  const { error } = await serviceSupabase().from('chatter_connectors').upsert(row);
  if (error) throw new ApiError(503, 'connectors_save_failed', 'No se pudo guardar el conector.');
}
