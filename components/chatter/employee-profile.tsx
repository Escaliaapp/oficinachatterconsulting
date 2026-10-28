'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BriefcaseBusiness, Cake, Check, Coffee, Gamepad2, GraduationCap, MapPin, MessageSquare, Pencil, Save, ShieldCheck, Sofa, Sparkles, Users, Wrench, X } from 'lucide-react';
import type { AgentCommand, Employee, EmployeeRuntime, OfficeEvent } from '@/lib/chatter/types';
import { STATE_COLORS, STATE_LABELS } from '@/lib/chatter/types';
import Avatar from './avatar';
import styles from './employee-profile.module.css';

export interface EmployeeProfileProps {
  employee: Employee;
  agent: EmployeeRuntime;
  events: OfficeEvent[];
  onClose: () => void;
  onCommand: (action: AgentCommand) => void;
  onSave: (employee: Employee) => void;
  onChat: () => void;
  onToggleEnabled?: () => void;
}

const commands: { action: AgentCommand; label: string; icon: typeof Coffee }[] = [
  { action: 'work', label: 'A trabajar', icon: BriefcaseBusiness },
  { action: 'coffee', label: 'Un café', icon: Coffee },
  { action: 'meeting', label: 'Con Hermes', icon: Users },
  { action: 'talk', label: 'Conversar', icon: MessageSquare },
  { action: 'relax', label: 'Descansar', icon: Sofa },
  { action: 'game', label: 'Futbolito', icon: Gamepad2 },
];

function ProfileContent({ employee, agent, events, onClose, onCommand, onSave, onChat, onToggleEnabled }: EmployeeProfileProps) {
  const [tab, setTab] = useState('Perfil');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(employee);
  const [saved, setSaved] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const employeeEvents = events.filter((event) => event.employeeId === employee.id).slice(0, 18);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.role.trim() || !draft.bio.trim()) return;
    onSave({ ...employee, name: draft.name.trim(), lastName: draft.lastName.trim(), role: draft.role.trim(), bio: draft.bio.trim() });
    setEditing(false);
    setSaved(true);
  }

  return (
    <aside className={styles.drawer} role="dialog" aria-modal="false" aria-label={`Perfil de ${employee.name}`}>
      <div className={styles.top}>
        <span className={styles.eyebrow}><Users size={12} /> Conoce a tu equipo</span>
        <button ref={closeRef} className={styles.iconButton} onClick={onClose} aria-label="Cerrar perfil"><X size={17} /></button>
      </div>
      <div className={styles.scroll}>
        <div className={styles.identity}>
          <div className={styles.portrait}><Avatar employee={employee} size={76}/><span className={styles.statusDot} style={{ background: STATE_COLORS[agent.state] }}/></div>
          <div><h2>{employee.name} <span>{employee.lastName}</span></h2><p>{employee.role}</p><span className={styles.number}>CHATTER TEAM / {employee.id.toUpperCase()}</span></div>
        </div>
        <div className={styles.fiction}><Sparkles size={11}/> Personaje ficticio · Identidad persistente</div>
        <div className={styles.stateCard}>
          <div className={styles.stateHeading} style={{ color: STATE_COLORS[agent.state] }}><span/>{STATE_LABELS[agent.state]}<small>SIMULADO</small></div>
          <p>{agent.activity}</p>
        </div>
        <div className={styles.metrics}>
          <div><strong>{employee.credits} <small>CC</small></strong><span>Créditos verificados</span></div>
          <div><strong>{employee.age} <small>años</small></strong><span>Edad del personaje</span></div>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Información del empleado">
          {['Perfil', 'Actividad', 'Capacidades'].map((name) => <button key={name} id={`profile-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls="employee-tab-panel" onClick={() => setTab(name)}>{name}</button>)}
        </div>
        <div role="tabpanel" id="employee-tab-panel" aria-labelledby={`profile-tab-${tab}`}>
          {tab === 'Perfil' && <>
            <section className={styles.section}>
              <div className={styles.sectionTitle}><h3>Detrás del avatar</h3><button className={styles.iconButton} aria-label="Editar perfil" onClick={() => { setDraft(employee); setEditing(!editing); setSaved(false); }}><Pencil size={13}/></button></div>
              {editing ? <form className={styles.editForm} onSubmit={save}>
                <label>Nombre<input required maxLength={40} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
                <label>Apellido<input maxLength={60} value={draft.lastName} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })}/></label>
                <label>Puesto<input required maxLength={100} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}/></label>
                <label>Historia<textarea required maxLength={1500} rows={5} value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })}/></label>
                <div className={styles.formActions}><button type="submit" className={styles.primary}><Save size={12}/>Guardar perfil</button><button type="button" className={styles.secondary} onClick={() => setEditing(false)}>Cancelar</button></div>
              </form> : <p>{employee.bio}</p>}
              {saved && <div className={styles.saved} role="status"><Check size={12}/>Perfil actualizado en esta oficina.</div>}
            </section>
            <div className={styles.details}>
              <div className={styles.detail}><MapPin size={14}/><span>{employee.city}<small>Ciudad de origen ficticia</small></span></div>
              <div className={styles.detail}><Cake size={14}/><span>{new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${employee.birthDate}T12:00:00Z`))}<small>Fecha de nacimiento ficticia</small></span></div>
              <div className={styles.detail}><GraduationCap size={14}/><span>{employee.education}</span></div>
              <div className={styles.detail}><BriefcaseBusiness size={14}/><span>{employee.experience}</span></div>
            </div>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Personalidad y comunicación</h3></div><p>{employee.personality}</p></section>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Fuera del escritorio</h3></div><div className={styles.tags}>{employee.interests.map((interest) => <span key={interest} className={styles.tag}>{interest}</span>)}</div></section>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Conexiones en el equipo</h3></div><p>{employee.relationships}</p></section>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Un día en Chatter</h3></div><p className={styles.routine}>{employee.routine}</p></section>
          </>}
          {tab === 'Actividad' && <>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Lo que está pasando</h3><span className={styles.number}>SIMULACIÓN LOCAL</span></div></section>
            {employeeEvents.length ? employeeEvents.map((event) => <div key={event.id} className={styles.event}><span className={styles.eventMarker}/><div><p>{event.message}</p><time>{new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Mazatlan'}).format(event.time)} · hora simulada</time></div></div>) : <div className={styles.empty}>Sus próximas actividades aparecerán aquí.<br/>Invítale a tomar un café para comenzar.</div>}
            <div className={styles.note}>Las actividades de esta oficina son simuladas. No ejecutan herramientas, consumen tokens ni generan Chatter Credits.</div>
          </>}
          {tab === 'Capacidades' && <>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Especialización</h3></div><p>{employee.specialization}</p></section>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Sus fortalezas</h3></div><div className={styles.tags}>{employee.strengths.map((strength) => <span className={styles.tag} key={strength}>{strength}</span>)}</div></section>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Áreas de crecimiento</h3></div><div className={styles.tags}>{employee.weaknesses.map((weakness) => <span className={`${styles.tag} ${styles.softTag}`} key={weakness}>{weakness}</span>)}</div><p style={{ marginTop: 12 }}>{employee.growth}</p></section>
            <section className={styles.section}><div className={styles.sectionTitle}><h3>Herramientas previstas</h3></div>{employee.tools.map((tool) => <div className={styles.tool} key={tool}><Wrench size={13}/>{tool}<span>Fase 3</span></div>)}</section>
            <div className={styles.note}><ShieldCheck size={12} style={{ verticalAlign: 'middle', marginRight: 5 }}/>Las herramientas externas aún no están conectadas. Los permisos y las aprobaciones se configurarán antes de habilitar su ejecución.</div>
          </>}
        </div>
        <div className={styles.actionsTitle}>Dale vida a su día</div>
        <div className={styles.commands}>{commands.map(({ action, label, icon: Icon }) => <button className={styles.command} key={action} disabled={agent.state==='offline'} onClick={() => onCommand(action)}><Icon size={17}/>{label}</button>)}</div>
        {onToggleEnabled&&<button className={styles.enableButton} onClick={onToggleEnabled}>{agent.state==='offline'?'Reactivar empleado':'Pausar este empleado'}</button>}
      </div>
      <div className={styles.footer}><button className={styles.primary} onClick={onChat}><MessageSquare size={15}/>Conversar con {employee.name}<ArrowUpRight size={14}/></button><p>Conversación de demostración · Sin conexión a un modelo</p></div>
    </aside>
  );
}

export default function EmployeeProfile(props: EmployeeProfileProps) {
  return <ProfileContent key={props.employee.id} {...props}/>;
}
