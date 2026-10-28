'use client';
import { useCallback, useEffect, useState } from 'react';
import { CONNECTORS, type ConnectorId, type ConnectorStatus } from '@/lib/chatter/connectors/catalog';
import { authorizedFetch } from '@/lib/supabase/browser';

type Snapshot = { storageReady: boolean; encryptionReady: boolean; connectors: ConnectorStatus[] };
export default function ConnectorsPanel({ production }: { production: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [expanded, setExpanded] = useState<ConnectorId | null>(null);
  const [busy, setBusy] = useState<ConnectorId | null>(null);
  const [notice, setNotice] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const load = useCallback(async () => {
    const response = await authorizedFetch('/api/chatter/connectors', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los conectores.');
    setSnapshot(data);
  }, []);
  useEffect(() => {
    if (!production) return;
    let cancelled = false;
    authorizedFetch('/api/chatter/connectors', { cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los conectores.');
      if (!cancelled) setSnapshot(data);
    }).catch(error => { if (!cancelled) setNotice(error.message); });
    return () => { cancelled = true; };
  }, [production]);
  async function change(id: ConnectorId, action: 'save' | 'test', enabled?: boolean, fields?: Record<string, string>) {
    setBusy(id); setNotice('');
    try {
      const response = await authorizedFetch('/api/chatter/connectors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action, enabled, fields }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar.');
      setNotice(data.message);
      if (action === 'save') setExpanded(null);
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo completar la operación.'); }
    finally { setBusy(null); }
  }
  return <section className="hq-section-view connector-panel">
    <div className="hq-view-title"><h2>Conectores</h2><span className="hq-outline-pill">TÚ CONTROLAS LAS HERRAMIENTAS</span></div>
    <p>Un cerebro para Hermes y herramientas opcionales para tu equipo. Activa solo lo que vayas a usar.</p>
    <div className="connector-summary"><strong>{snapshot?.connectors.filter(item => item.enabled && item.configured).length ?? '—'} activos</strong><span>API directa · Activa solo lo necesario</span></div>
    {!production && <p className="connector-notice">Vista local. Abre la oficina publicada e inicia sesión para configurar servicios reales.</p>}
    {snapshot && !snapshot.storageReady && <p className="connector-notice">Preparación pendiente: aplica la migración de Conectores en Supabase. Hasta entonces se muestran las claves configuradas en el servidor, pero no se pueden cambiar los interruptores.</p>}
    {snapshot?.storageReady && !snapshot.encryptionReady && <p className="connector-notice">Puedes activar o desactivar las claves existentes. Para guardar nuevas claves aquí, falta configurar CHATTER_CONNECTOR_ENCRYPTION_KEY una sola vez en el servidor.</p>}
    {notice && <p className="connector-notice" role="status">{notice}</p>}
    {production && !snapshot && <button className="hq-secondary" onClick={() => load().catch(error => setNotice(error.message))}>Cargar conectores</button>}
    <div className="connector-grid">{CONNECTORS.map(item => {
      const status = snapshot?.connectors.find(value => value.id === item.id);
      const on = Boolean(status?.enabled && status.configured);
      const label = !status ? 'Sin comprobar' : !status.configured ? 'Necesita configuración' : !status.enabled ? 'Desactivado' : status.testOk === false ? 'Revisar acceso' : status.testOk ? 'Acceso verificado' : 'Activo · Sin verificar';
      return <article className="connector-card" key={item.id}>
        <div className="connector-card-title"><div><small>{item.agent}</small><h3>{item.name}</h3></div><button role="switch" aria-checked={on} aria-label={`Activar ${item.name}`} disabled={!snapshot?.storageReady || busy !== null} className={`hq-switch ${on ? 'active' : ''}`} onClick={() => on ? void change(item.id, 'save', false) : status?.configured ? void change(item.id, 'save', true) : setExpanded(item.id)}><i/></button></div>
        <p>{item.description}</p><span className={`connector-badge ${on ? 'on' : ''}`}>{label}</span>
        <p className="connector-cost">{item.cost}</p>
        <div className="connector-actions"><button className="hq-secondary" aria-expanded={expanded === item.id} disabled={busy !== null} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>Configurar</button>{item.test && <button className="hq-secondary" disabled={!status?.configured || busy !== null} onClick={() => void change(item.id, 'test')}>Probar acceso</button>}</div>
        {status?.testedAt && <small>Última prueba: {new Date(status.testedAt).toLocaleString('es-MX')}. {status.message}</small>}
        {!item.test && <small>La operación se verifica al ejecutar una tarea; no se generan búsquedas ni contactos de prueba.</small>}
        {expanded === item.id && <form className="connector-form" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const fields = Object.fromEntries(item.fields.map(field => [field.key, String(data.get(field.key) || '')]));
          form.reset();
          void change(item.id, 'save', true, fields);
        }}>
          <a href={item.docs} target="_blank" rel="noreferrer">Dónde obtener las credenciales ↗</a>
          {item.fields.map(field => <label key={field.key}>{field.label}<input name={field.key} type={field.secret ? 'password' : 'text'} autoComplete="off" maxLength={4096} placeholder={status?.configured ? 'Guardado · deja vacío para conservar' : field.label} required={!status?.configured} /></label>)}
          <small>Las claves guardadas no se muestran ni se almacenan en este navegador.</small>
          <button className="hq-primary" type="submit" disabled={!snapshot?.storageReady || !snapshot.encryptionReady || busy !== null}>{busy === item.id ? 'Guardando…' : 'Guardar y activar'}</button>
        </form>}
      </article>;
    })}</div>
    <div className="connector-notice"><strong>Servicios de la oficina</strong><p>Telegram conecta tu conversación con Hermes. Supabase conserva tareas y datos. Su configuración base se administra en el servidor; no necesitas una cuenta diferente para cada agente.</p><p>OFF detiene nuevas llamadas; no cancela solicitudes ya enviadas ni la suscripción con el proveedor.</p></div>
    <button className="hq-secondary" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? 'Ocultar complementos' : 'Ver complementos futuros'}</button>
    {advanced && <div className="connector-grid">{['Higgsfield · Valentina','Gmail · Hermes','Meta Ads · Mateo','Google Ads · Lucía','MCP · Herramientas adicionales'].map(name => <article className="connector-card" key={name}><h3>{name}</h3><span className="connector-badge">Integración pendiente</span><p>Se habilitará cuando exista una conexión operativa. No requiere contratarla ahora.</p></article>)}</div>}
  </section>;
}
