'use client';
import { useState } from 'react';
import { authorizedFetch } from '@/lib/supabase/browser';

export default function DiegoControls({ onConnectors }: { onConnectors: () => void }) {
  const [objective, setObjective] = useState('Busca 10 inmobiliarias en Ciudad de México');
  const [source, setSource] = useState('apollo');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function act(create: boolean) {
    setBusy(true); setMessage('');
    try {
      const response = await authorizedFetch(create ? '/api/chatter/jobs' : '/api/chatter/jobs/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(create ? { objective, idempotencyKey: crypto.randomUUID() } : { source }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
      setMessage(create ? 'Tarea en cola. Revisa la fuente y pulsa Ejecutar siguiente tarea.' : data.message || 'Ejecución terminada.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }
  return <div className="diego-controls">
    <form onSubmit={event => { event.preventDefault(); void act(true); }}><label>Nueva tarea de prospección<input value={objective} onChange={event => setObjective(event.target.value)} minLength={3} maxLength={2000} required /></label><button type="submit" className="hq-secondary" disabled={busy}>Crear tarea</button></form>
    <div className="connector-actions"><label>Fuente para la siguiente tarea<select value={source} onChange={event => setSource(event.target.value)} disabled={busy}><option value="apollo">Apollo · Responsables B2B</option><option value="google">Google Places · Negocios locales</option></select></label><button className="hq-primary" disabled={busy} onClick={() => void act(false)}>{busy ? 'Procesando…' : 'Ejecutar siguiente tarea'}</button><button className="hq-secondary" onClick={onConnectors}>Conectores</button></div>
    <p>{source === 'apollo' ? 'Usa Apollo API: hasta 10 perfiles según el límite disponible. No revela correos ni teléfonos y no los envía al CRM.' : 'Usa Google Places API y puede generar cargos de Google. Si GoHighLevel está ON, enviará los negocios con teléfono o sitio web al CRM.'}</p>
    <small>Ejecuta la tarea más antigua de Diego en cola. Máximo 10 prospectos guardados en 24 horas. Costo monetario aún no medido.</small>
    {message && <p className="connector-notice" role="status">{message}</p>}
  </div>;
}
