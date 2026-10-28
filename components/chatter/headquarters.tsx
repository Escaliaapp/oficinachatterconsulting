'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Activity, ArrowRight, ArrowUpRight, Bell, Bot, Building2, Check, ChevronDown, ChevronRight, CircleHelp, Coffee, Cpu, Download, Expand, Eye, Focus, Globe2, Hash, Lightbulb, MessageCircle, MessageSquare, Minus, MousePointer2, Network, Pause, Play, Plus, Radio, RotateCcw, Search, Send, Settings2, ShieldCheck, Sparkles, Target, Users, X, Zap, ChartNoAxesCombined, ListTodo } from 'lucide-react';
import { Avatar } from './avatar';
import EmployeeProfile from './employee-profile';
import { DEPARTMENTS } from '@/lib/chatter/employees';
import { STATE_LABELS, STATE_COLORS } from '@/lib/chatter/types';
import type { Employee, OfficeEvent } from '@/lib/chatter/types';
import { useOffice } from '@/lib/chatter/use-office-store';
import { SIMULATION_EPOCH } from '@/lib/chatter/simulation';
import { browserSupabase, signInWithEmail, authorizedFetch } from '@/lib/supabase/browser';

const OfficeScene = dynamic(() => import('./office-scene'), { ssr: false, loading: () => <div className="hq-scene-loading"><Building2 size={34} /><span>Abriendo las puertas de Chatter…</span><i /></div> });
const NAV = [{id:'office',label:'Oficina',icon:Building2},{id:'chat',label:'Chat',icon:MessageSquare},{id:'tasks',label:'Tareas',icon:ListTodo},{id:'ideas',label:'Ideas',icon:Lightbulb},{id:'reports',label:'Reportes',icon:ChartNoAxesCombined},{id:'employees',label:'Empleados',icon:Users}];
const CHANNELS = ['general','dirección','marketing','creatividad','prospección','automatizaciones','analítica','ideas','cafetería'];
type Action = 'work'|'coffee'|'meeting'|'relax'|'talk'|'game';
type Message = {id:string;author:string;channel:string;text:string;time:string};
type Idea = {id:string;text:string;votes:number};
type IntegrationStatus = {telegram:boolean;database:boolean;mode:'local'|'production'};

function Brand({small=false}:{small?:boolean}) {
  return <div className={`hq-brand ${small?'small':''}`}><svg viewBox="0 0 42 42" fill="none" aria-hidden="true"><path d="M32 10 23 5a5 5 0 0 0-5 0L8 11a5 5 0 0 0-2.5 4.3v11.4A5 5 0 0 0 8 31l10 6a5 5 0 0 0 5 0l9-5" stroke="currentColor" strokeWidth="3.3" strokeLinecap="round"/><path d="m29 16-8-4-9 5v9l9 5 8-5-8-5" stroke="currentColor" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round"/></svg>{!small&&<div>chatter<span>CONSULTING</span></div>}</div>;
}

export default function Headquarters() {
  const {state,ready,storageError,select,command,togglePause,setSpeed,saveEmployee,enableAgent,reset} = useOffice();
  const [view,setView] = useState('office');
  const [department,setDepartment] = useState('all');
  const [filter,setFilter] = useState('all');
  const [labels,setLabels] = useState(true);
  const [camera,setCamera] = useState<{type:'zoom-in'|'zoom-out'|'reset'|'rotate';nonce:number}|null>(null);
  const [modal,setModal] = useState<'help'|'settings'|'activity'|'meeting'|null>(null);
  const [query,setQuery] = useState('');
  const [searching,setSearching] = useState(false);
  const [toast,setToast] = useState('');
  const [time,setTime] = useState('09:41');
  const [date,setDate] = useState('Lunes, 26 de octubre');
  const [channel,setChannel] = useState('dm:hermes');
  const [integrationStatus,setIntegrationStatus] = useState<IntegrationStatus>({telegram:false,database:false,mode:'local'});
  const [ownerAccess,setOwnerAccess] = useState<'unknown'|'signed_in'|'signed_out'>('unknown');
  const [ownerEmail,setOwnerEmail] = useState('chattercontenidos@gmail.com');
  const [loginSent,setLoginSent] = useState(false);
  const [messages,setMessages] = useState<Message[]>([]);
  const [ideas,setIdeas] = useState<Idea[]>([]);
  const [workspaceReady,setWorkspaceReady] = useState(false);
  const [showActivity,setShowActivity] = useState(true);
  const [meetingIds,setMeetingIds] = useState<string[]>(['hermes','ana','diego']);
  const [fullScreen,setFullScreen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const update=()=>{const now=new Date();setTime(new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Mazatlan'}).format(now));setDate(new Intl.DateTimeFormat('es-MX',{weekday:'long',day:'numeric',month:'long',timeZone:'America/Mazatlan'}).format(now));};
    const hydrate=window.setTimeout(()=>{
      update();
      try {const data=JSON.parse(localStorage.getItem('chatter.workspace.v1')||'{}');if(Array.isArray(data.messages))setMessages(data.messages.filter((m:Message)=>m&&typeof m.id==='string'&&typeof m.text==='string'&&typeof m.author==='string'&&typeof m.channel==='string'&&typeof m.time==='string').slice(-200));if(Array.isArray(data.ideas))setIdeas(data.ideas.filter((i:Idea)=>i&&typeof i.id==='string'&&typeof i.text==='string'&&Number.isFinite(i.votes)).slice(-50));if(typeof data.labels==='boolean')setLabels(data.labels);}catch{}
      setWorkspaceReady(true);
    },0);
    const interval=window.setInterval(update,30000);
    const shortcut=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();setSearching(s=>!s);}if(e.key==='Escape'){setModal(null);setSearching(false);select(null);}};
    window.addEventListener('keydown',shortcut);
    const fs=()=>setFullScreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',fs);
    return()=>{clearTimeout(hydrate);clearInterval(interval);window.removeEventListener('keydown',shortcut);document.removeEventListener('fullscreenchange',fs);};
  },[select]);
  useEffect(()=>{if(!ready||!workspaceReady)return;try{localStorage.setItem('chatter.workspace.v1',JSON.stringify({messages,ideas,labels}));}catch{}},[messages,ideas,labels,ready,workspaceReady]);
  useEffect(()=>{fetch('/api/chatter/status',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(status=>{if(status)setIntegrationStatus(status);}).catch(()=>{});},[]);
  useEffect(()=>{if(integrationStatus.mode!=='production'){setOwnerAccess('signed_in');return;}const db=browserSupabase();if(!db){setOwnerAccess('signed_out');return;}db.auth.getSession().then(({data})=>setOwnerAccess(data.session?'signed_in':'signed_out'));const {data:{subscription}}=db.auth.onAuthStateChange((_event,session)=>setOwnerAccess(session?'signed_in':'signed_out'));return()=>subscription.unsubscribe();},[integrationStatus.mode]);
  useEffect(()=>{if(!integrationStatus.database||ownerAccess!=='signed_in')return;let cancelled=false;const sync=()=>{const request=integrationStatus.mode==='production'?authorizedFetch('/api/chatter/messages',{cache:'no-store'}):fetch('/api/chatter/messages',{cache:'no-store'});request.then(response=>response.ok?response.json():null).then(data=>{if(cancelled||!Array.isArray(data?.messages))return;const remote:Message[]=data.messages.map((message:{id:string;author_type:string;body:string;created_at:string})=>({id:message.id,author:message.author_type==='owner'?'ceo':'hermes',channel:'dm:hermes',text:message.body,time:new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Mazatlan'}).format(new Date(message.created_at))}));setMessages(previous=>[...previous.filter(message=>message.channel!=='dm:hermes'),...remote].slice(-200));}).catch(()=>{});};sync();const interval=window.setInterval(sync,5000);return()=>{cancelled=true;clearInterval(interval);};},[integrationStatus.database,integrationStatus.mode,ownerAccess]);
  useEffect(()=>{if(!toast)return;const timeout=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(timeout);},[toast]);
  useEffect(()=>{
    if(!modal&&!searching)return;
    const prior=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>('.hq-modal-backdrop [role="dialog"]');
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]')||[]);
    focusable()[0]?.focus();
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const items=focusable();const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
    document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);prior?.focus();};
  },[modal,searching]);

  const notify=useCallback((message:string)=>setToast(message),[]);
  const selected = state.employees.find(e=>e.id===state.selectedId);
  const selectedAgent = state.agents.find(e=>e.id===state.selectedId);
  const filtered = state.employees.filter(e=>(department==='all'||e.department===department)&&(`${e.name} ${e.lastName} ${e.role}`.toLowerCase().includes(query.toLowerCase())));
  const active=state.agents.filter(a=>['working','researching'].includes(a.state)).length;
  const social=state.agents.filter(a=>['talking','meeting'].includes(a.state)).length;
  const events=state.events.filter(e=>filter==='all'||e.type===filter);
  const go=(next:string)=>{setView(next);select(null);};
  const focusEmployee=(id:string)=>{select(id);};
  const doCommand=(id:string,action:Action)=>{command(id,action);notify(action==='meeting'?'Camino a la sala de juntas':action==='coffee'?'Una pausa para recargar ideas':'Actividad actualizada');};
  const openChat=(id:string)=>{setChannel(`dm:${id}`);go('chat');};
  const openConversation=(id:string)=>{
    const agent=state.agents.find(a=>a.id===id);
    const employee=state.employees.find(e=>e.id===id);
    const partner=state.employees.find(e=>e.id===agent?.partnerId);
    if(!agent?.conversationId||!employee||!partner){openChat(id);return;}
    const thread=`social:${agent.conversationId}`;
    setMessages(previous=>previous.some(m=>m.channel===thread)?previous:[...previous,
      {id:`${thread}:1`,author:employee.id,channel:thread,text:`${partner.name}, estaba pensando en ${employee.interests[0].toLowerCase()}. A veces las mejores ideas para el trabajo aparecen cuando cambiamos de perspectiva.`,time},
      {id:`${thread}:2`,author:partner.id,channel:thread,text:`¡Sí! A mí me pasa con ${partner.interests[0].toLowerCase()}. Podemos compartir nuestras referencias después del café.`,time},
      {id:`${thread}:3`,author:employee.id,channel:thread,text:'Me gusta. Primero una pausa y luego volvemos con ideas frescas.',time},
    ].slice(-200));
    setChannel(thread);go('chat');
  };
  const cameraMove=(type:'zoom-in'|'zoom-out'|'reset'|'rotate')=>setCamera(c=>({type,nonce:(c?.nonce||0)+1}));
  const addMessage=(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const form=e.currentTarget;const input=form.elements.namedItem('message') as HTMLInputElement;const text=input.value.trim();if(!text)return;
    const author=channel.startsWith('dm:')?channel.slice(3):channel.startsWith('social:')?messages.find(m=>m.channel===channel&&m.author!=='ceo')?.author||'hermes':'hermes';
    const recipient=state.employees.find(x=>x.id===author);
    if(author==='hermes'){
      const pending={id:crypto.randomUUID(),author:'ceo',channel,text:text.slice(0,2000),time};
      setMessages(m=>[...m,pending].slice(-200));
      const request=integrationStatus.mode==='production'?authorizedFetch('/api/chatter/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:text,office:state.agents.map(agent=>({id:agent.id,state:agent.state,activity:agent.activity}))})}):fetch('/api/chatter/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:text,office:state.agents.map(agent=>({id:agent.id,state:agent.state,activity:agent.activity}))})});request.then(async response=>{if(!response.ok)throw new Error('save_failed');const data=await response.json();if(data.reply)setMessages(m=>[...m,{id:crypto.randomUUID(),author:'hermes',channel:'dm:hermes',text:data.reply,time}].slice(-200));notify(data.telegramSynced?'Hermes respondió y lo envió a Telegram':data.reply?'Hermes respondió usando el contexto de la oficina':'Instrucción guardada; falta conectar el cerebro de Hermes');}).catch(()=>notify('No se pudo guardar en Supabase; el mensaje permanece en este navegador.'));
    }else{
      const reply=`${recipient?.name||'Hermes'} recibió tu mensaje en esta oficina de demostración. Podemos reunirnos, tomar un café o revisar mi perfil.`;
      setMessages(m=>[...m,{id:crypto.randomUUID(),author:'ceo',channel,text:text.slice(0,2000),time},{id:crypto.randomUUID(),author,channel,text:reply,time}].slice(-200));
    }
    if(channel.startsWith('dm:'))command(author,'talk');input.value='';
  };
  const addIdea=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const input=e.currentTarget.elements.namedItem('idea') as HTMLInputElement;const text=input.value.trim();if(text){setIdeas(a=>[{id:crypto.randomUUID(),text:text.slice(0,500),votes:0},...a]);input.value='';notify('Idea guardada en este dispositivo');}};
  const exportState=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='chatter-oficina.json';a.click();URL.revokeObjectURL(url);notify('Estado de la oficina exportado');};
  const toggleFullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await shellRef.current?.requestFullscreen();}catch{notify('Tu navegador no permite pantalla completa');}};

  return <div className="hq" ref={shellRef}>
    {integrationStatus.mode==='production'&&ownerAccess==='signed_out'&&<div className="hq-modal-backdrop"><div className="hq-modal" role="dialog" aria-modal="true"><div className="hq-modal-symbol"><ShieldCheck size={24}/></div><h2>Acceso del propietario</h2><p>Enviaremos un enlace de acceso a tu correo para abrir la oficina y ver el chat de Hermes.</p>{loginSent?<p>Revisa tu correo y abre el enlace de acceso. Después vuelve a esta página.</p>:<form className="stack-form" onSubmit={async e=>{e.preventDefault();try{await signInWithEmail(ownerEmail);setLoginSent(true);}catch(error){notify((error as Error).message);}}}><label>Correo<input type="email" value={ownerEmail} onChange={e=>setOwnerEmail(e.target.value)} required/></label><button className="hq-primary hq-full-button" type="submit">Enviar enlace de acceso<ArrowRight size={16}/></button></form>}</div></div>}
    <header className="hq-topbar">
      <button className="hq-brand-button" onClick={()=>go('office')} aria-label="Chatter, ir a la oficina"><Brand /></button>
      <span className="hq-brand-divider"/><span className="hq-hq-badge">HQ<span>●</span></span>
      <nav className="hq-nav" aria-label="Navegación principal">{NAV.map(({id,label,icon:Icon})=><button key={id} className={view===id?'active':''} onClick={()=>go(id)}><Icon size={16}/><span>{label}</span>{id==='chat'&&<i className="hq-nav-dot"/>}</button>)}</nav>
      <div className="hq-top-actions"><button className="hq-icon" onClick={()=>setSearching(true)} aria-label="Buscar empleados"><Search size={18}/></button><button className={`hq-icon ${showActivity?'on':''}`} onClick={()=>setShowActivity(s=>!s)} aria-label="Mostrar u ocultar actividad"><Bell size={18}/><i className="hq-notification-dot"/></button><span className="hq-top-separator"/><button className="hq-ceo" onClick={()=>setModal('settings')} aria-label="Configuración del CEO">JD</button></div>
    </header>

    <div className="hq-body">
      <aside className="hq-sidebar">
        <div className="hq-workspace-select"><div className="hq-workspace-logo"><Brand small/></div><div><strong>Chatter Consulting</strong><span>Tu espacio de trabajo</span></div><ChevronDown size={14}/></div>
        <div className="hq-section-label">WORKSPACE</div>
        <button className={`hq-sidebar-main ${view==='office'?'active':''}`} onClick={()=>go('office')}><Building2 size={17}/><span>Mi oficina</span><span className="hq-live-dot"/></button>
        <button className={`hq-sidebar-main ${view==='employees'?'active':''}`} onClick={()=>go('employees')}><Users size={17}/><span>Mi equipo</span><b>10</b></button>
        <button className={`hq-sidebar-main ${view==='integrations'?'active':''}`} onClick={()=>go('integrations')}><Network size={17}/><span>Integraciones</span><ArrowUpRight size={12}/></button>
        <div className="hq-section-label hq-team-label">DEPARTAMENTOS<span>{DEPARTMENTS.length-1}</span></div>
        <button className={`hq-dept ${department==='all'?'active':''}`} onClick={()=>setDepartment('all')}><span className="hq-dept-grid"><i/><i/><i/><i/></span><span>Todo el equipo</span><b>10</b></button>
        {DEPARTMENTS.filter(d=>d.id!=='all').map(d=><button key={d.id} className={`hq-dept ${department===d.id?'active':''}`} onClick={()=>{setDepartment(d.id);if(view!=='office'&&view!=='employees')go('employees');}}><span className="hq-dept-dot" style={{background:d.color}}/><span>{d.name}</span><b>{state.employees.filter(e=>e.department===d.id).length}</b></button>)}
        <div className="hq-sidebar-bottom"><div className="hq-hermes-note"><div className="hq-note-icon"><Sparkles size={16}/><span>TU DIRECTOR DE OPERACIONES</span></div><p>Las grandes ideas<br/>empiezan conversando.</p><button onClick={()=>openChat('hermes')}>Hablar con Hermes <ArrowUpRight size={15}/></button></div><button className="hq-sidebar-main" onClick={()=>setModal('settings')}><Settings2 size={17}/><span>Configuración</span></button><button className="hq-sidebar-main" onClick={()=>setModal('help')}><CircleHelp size={17}/><span>Guía de la oficina</span><span className="hq-key">?</span></button><div className="hq-local-status"><span className="hq-live-dot"/>Todos los sistemas locales listos<ArrowUpRight size={10}/></div></div>
      </aside>

      <main className="hq-main">
        <div className="hq-page-heading"><div><div className="hq-breadcrumb">Workspace <ChevronRight size={11}/> {NAV.find(n=>n.id===view)?.label||'Integraciones'}</div><h1>{view==='office'?'Tu agencia, en movimiento.':view==='employees'?'El talento detrás de Chatter.':view==='chat'?'Habla con tu Director de Operaciones.':view==='tasks'?'Cada persona, un propósito.':view==='ideas'?'La próxima gran idea.':view==='reports'?'El pulso de tu equipo.':'Conecta las posibilidades.'}<span className="hq-heading-dot">.</span></h1><p>{view==='office'?'Un equipo extraordinario. Un espacio para hacerlo posible.':view==='employees'?'Diez especialistas, muchas formas de crear valor.':view==='chat'?'Hermes recibe tus instrucciones, coordina al equipo y te comunica los resultados.':view==='tasks'?'Explora y dirige las actividades de tu oficina virtual.':view==='ideas'?'Anota, comparte y da forma a lo que viene.':view==='reports'?'Una mirada en tiempo real a tu oficina virtual.':'El siguiente paso de tu agencia inteligente.'}</p></div><div className="hq-heading-actions"><div className="hq-date"><span>{date}</span><strong>{time} <small>GMT−7</small></strong></div><button className="hq-primary" onClick={()=>setModal('meeting')}><Plus size={16}/>Nueva reunión</button></div></div>
        <div className="hq-workspace-content">
          <section className={`hq-stage-column ${showActivity?'':'wide'}`}>
            <div className="hq-stage-top"><div className="hq-stage-tabs"><button className="active" onClick={()=>go('office')}><Building2 size={14}/>Oficina principal <ChevronDown size={12}/></button><span className="hq-location"><Globe2 size={12}/>Mazatlán, MX</span></div><div className="hq-presence"><div className="hq-mini-avatars">{state.employees.slice(0,4).map(e=><Avatar key={e.id} employee={e} size={23}/>)}</div><span><b>10</b> en la oficina</span><span className={`hq-live-pill ${state.paused?'paused':''}`}><i/>{state.paused?'Pausada':'En vivo'}</span></div></div>
            <div className={`hq-stage ${view!=='office'?'with-panel':''}`}>
              {view==='office'?<>
                <div className="hq-office-caption"><span className="hq-caption-dot"/>CHATTER HEADQUARTERS<span>EST. 2026</span></div>
                <OfficeScene employees={state.employees} agents={state.agents} selectedId={state.selectedId} onSelect={focusEmployee} paused={state.paused} speed={state.speed} labels={labels} cameraCommand={camera} onConversation={openConversation}/>
                <div className="hq-office-label"><span className="hq-floor-number">01</span><div><strong>Un lugar para crear el futuro.</strong><span>PLANTA PRINCIPAL · 10 ESPACIOS · INFINITAS IDEAS</span></div></div>
                <button className="hq-expand hq-icon" onClick={toggleFullscreen} aria-label={fullScreen?'Salir de pantalla completa':'Pantalla completa'}><Expand size={17}/></button>
                <div className="hq-scene-controls"><div className="hq-camera-controls"><button onClick={()=>cameraMove('zoom-out')} aria-label="Alejar cámara"><Minus size={15}/></button><span>ZOOM</span><button onClick={()=>cameraMove('zoom-in')} aria-label="Acercar cámara"><Plus size={15}/></button><i/><button onClick={()=>cameraMove('rotate')} aria-label="Rotar cámara"><RotateCcw size={15}/></button><button onClick={()=>cameraMove('reset')} aria-label="Restablecer cámara"><Focus size={16}/></button></div><div className="hq-simulation-controls"><button onClick={togglePause} aria-label={state.paused?'Reanudar simulación':'Pausar simulación'}>{state.paused?<Play size={14}/>:<Pause size={14}/>}</button><i/>{([1,2,4] as const).map(speed=><button key={speed} onClick={()=>setSpeed(speed)} className={state.speed===speed?'active':''} aria-label={`Velocidad ${speed}x`}>{speed}×</button>)}<i/><button onClick={()=>setLabels(!labels)} className={labels?'label-active':''} aria-label="Mostrar u ocultar nombres" aria-pressed={labels}><Eye size={15}/></button></div></div>
                <div className="hq-scene-hint"><MousePointer2 size={12}/><span>Arrastra para explorar</span><i/>Scroll para acercar<i/>Clic para conocer al equipo</div>
              </>:view==='employees'?<div className="hq-section-view"><div className="hq-view-title"><h2>Conoce a tu equipo <span>{filtered.length}</span></h2><label className="hq-input-search"><Search size={14}/><input placeholder="Buscar especialista…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="hq-employee-grid">{filtered.map(employee=>{const agent=state.agents.find(a=>a.id===employee.id)!;return <button key={employee.id} className="hq-employee-tile" onClick={()=>focusEmployee(employee.id)}><Avatar employee={employee} size={64}/><span className="hq-tile-status" style={{color:STATE_COLORS[agent.state]}}><i/>{STATE_LABELS[agent.state]}</span><h3>{employee.name} {employee.lastName}</h3><p>{employee.role}</p><div className="hq-tile-tools">{employee.tools.slice(0,2).join(' · ')}</div><span className="hq-view-profile">Conocer a {employee.name}<ArrowUpRight size={14}/></span></button>;})}</div>{!filtered.length&&<EmptyState icon={<Search/>} title="Sin coincidencias" text="Prueba otro nombre o departamento."/>}</div>
              :view==='chat'?<ChatPanel employees={state.employees} channel={channel} setChannel={setChannel} messages={messages} onSubmit={addMessage} status={integrationStatus}/>
              :view==='tasks'?<div className="hq-section-view"><div className="hq-view-title"><h2>Actividades de la oficina</h2><button className="hq-secondary" onClick={()=>setModal('activity')}><Plus size={14}/>Asignar actividad</button></div><div className="hq-phase-note"><Bot size={17}/><p>Fase 1 · Estas actividades representan rutinas simuladas. Las tareas profesionales y sus entregables se conectarán en la Fase 2.</p></div><div className="hq-task-list">{state.agents.map(a=>{const e=state.employees.find(e=>e.id===a.id)!;return <button key={a.id} className="hq-task-row" onClick={()=>focusEmployee(a.id)}><Avatar employee={e} size={36}/><div><strong>{a.activity}</strong><span>{e.name} · {e.role}</span></div><span className="hq-task-state" style={{color:STATE_COLORS[a.state]}}><i/>{STATE_LABELS[a.state]}</span><ChevronRight size={15}/></button>;})}</div></div>
              :view==='ideas'?<div className="hq-section-view"><div className="hq-ideas-hero"><div><Sparkles size={25}/></div><span>UN ESPACIO PARA LO QUE SIGUE</span><h2>¿Y si lo hacemos posible?</h2><p>Guarda esas ideas que merecen una segunda conversación.</p></div><form className="hq-idea-form" onSubmit={addIdea}><input name="idea" placeholder="Tengo una idea para Chatter…" aria-label="Nueva idea" maxLength={500} required/><button className="hq-primary" type="submit"><Plus size={16}/>Guardar idea</button></form><div className="hq-ideas-list">{ideas.map(i=><article key={i.id}><span className="hq-idea-bulb"><Lightbulb size={18}/></span><div><span>PROPUESTA DEL CEO</span><p>{i.text}</p><small>Guardada en este dispositivo · Pendiente de desarrollar</small></div><button aria-label="Apoyar idea" onClick={()=>setIdeas(a=>a.map(x=>x.id===i.id?{...x,votes:x.votes+1}:x))}><ArrowUpRight size={14}/>{i.votes}</button></article>)}</div>{!ideas.length&&<EmptyState icon={<Lightbulb/>} title="Hay espacio para tu primera idea" text="Las propuestas aparecerán aquí, listas para desarrollarse."/>}</div>
              :view==='reports'?<div className="hq-section-view"><div className="hq-view-title"><h2>El pulso de la oficina</h2><button className="hq-secondary" onClick={exportState}><Download size={14}/>Exportar estado</button></div><div className="hq-report-cards"><ReportMetric label="Equipo presente" value="10" caption="Especialistas virtuales" icon={<Users size={18}/>}/><ReportMetric label="En concentración" value={String(active)} caption="Trabajando o investigando" icon={<Target size={18}/>}/><ReportMetric label="Interacciones" value={String(state.events.filter(e=>e.type==='social').length)} caption="Eventos sociales simulados" icon={<MessageSquare size={18}/>}/><ReportMetric label="Consumo de IA" value="$0" caption="Sin servicios externos" icon={<Zap size={18}/>}/></div><h3 className="hq-report-title">Así se mueve el equipo<span>ESTADO ACTUAL</span></h3>{state.employees.map(e=>{const a=state.agents.find(x=>x.id===e.id)!;return <div className="hq-report-row" key={e.id}><Avatar employee={e} size={30}/><span>{e.name}</span><div><span style={{width:a.state==='walking'?'45%':a.state==='working'?'90%':'65%',background:e.color}}/></div><small>{STATE_LABELS[a.state]}</small></div>;})}<p className="hq-report-disclaimer">La oficina no genera créditos ni reporta ingresos por acciones simuladas. Los resultados verificados, costos y Chatter Credits corresponden a la Fase 4.</p></div>
              :<div className="hq-section-view"><div className="hq-view-title"><h2>Un mundo de herramientas</h2><span className="hq-outline-pill">FASE 3</span></div><p className="hq-integrations-intro">Los conectores se incorporarán cuando el cerebro multiagente esté listo. Esta oficina funciona de manera independiente.</p><div className="hq-integrations-grid">{[{name:'GoHighLevel',category:'CRM y automatización',icon:'G',color:'#df9661'},{name:'Meta Ads',category:'Campañas y audiencias',icon:'∞',color:'#6ba7ed'},{name:'Google Ads',category:'Publicidad e investigación',icon:'A',color:'#dfbe63'},{name:'WhatsApp',category:'Comunicación con clientes',icon:'W',color:'#87bc7b'},{name:'n8n',category:'Flujos de trabajo',icon:'n8n',color:'#df8b8b'},{name:'MCP',category:'Herramientas para agentes',icon:'⌘',color:'#b8a0df'}].map(item=><article key={item.name}><div style={{color:item.color}}>{item.icon}</div><h3>{item.name}</h3><p>{item.category}</p><span><i/>Sin conectar</span></article>)}</div><div className="hq-phase-note"><ShieldCheck size={20}/><p>Las acciones que publiquen contenido, envíen mensajes o gasten presupuesto requerirán aprobación explícita del CEO.</p></div></div>}
              {selected&&selectedAgent&&<EmployeeProfile employee={selected} agent={selectedAgent} events={state.events} onToggleEnabled={()=>enableAgent(selected.id,selectedAgent.state==='offline')} onClose={()=>select(null)} onCommand={action=>doCommand(selected.id,action)} onSave={employee=>{saveEmployee(employee);notify('Perfil actualizado y guardado');}} onChat={()=>openChat(selected.id)}/>}
            </div>
            <div className="hq-stage-status"><span><i className="hq-live-dot"/><b>{active}</b> concentrados</span><span><i className="hq-status-dot purple"/><b>{social}</b> colaborando</span><span><i className="hq-status-dot amber"/><b>{10-active-social}</b> en movimiento</span><span className="hq-stage-status-right"><ShieldCheck size={12}/>{storageError?'Almacenamiento no disponible':'Simulación local · Guardado automático'}</span></div>
          </section>

          {showActivity&&<aside className="hq-activity-panel"><div className="hq-activity-heading"><div><Activity size={16}/><h2>El pulso de Chatter</h2></div><span className="hq-live-dot"/></div><p className="hq-activity-subtitle">Las pequeñas cosas que nos mueven.</p><div className="hq-activity-filters">{[{id:'all',name:'Todo'},{id:'work',name:'Trabajo'},{id:'social',name:'Social'},{id:'meeting',name:'Reuniones'}].map(f=><button key={f.id} className={filter===f.id?'active':''} onClick={()=>setFilter(f.id)}>{f.name}</button>)}</div><div className="hq-activity-feed">{events.slice(0,12).map((event,index)=><EventItem key={event.id} event={event} employees={state.employees} simulationTime={state.simulationTime} latest={index===0} onSelect={event.conversationId?openConversation:focusEmployee}/>)}{!events.length&&<div className="hq-activity-empty"><Coffee size={24}/><p>Un momento de calma.</p><span>Las próximas interacciones aparecerán aquí.</span></div>}</div><div className="hq-activity-footer"><div className="hq-connected-icon"><Radio size={15}/></div><div><strong>{state.paused?'La oficina está en pausa':'Tu equipo está conectado'}</strong><span>{state.paused?'Reanuda para continuar las rutinas':'10 personalidades. Una misma visión.'}</span></div><button aria-label="Ver todos los empleados" onClick={()=>go('employees')}><ArrowUpRight size={16}/></button></div></aside>}
        </div>

        <section className="hq-team-section"><div className="hq-team-heading"><h2>Tu equipo<span>Personas virtuales. Potencial real.</span></h2><button onClick={()=>go('employees')}>Ver equipo completo<ArrowRight size={13}/></button></div><div className="hq-team-strip">{filtered.map(e=>{const agent=state.agents.find(a=>a.id===e.id)!;return <button key={e.id} className={`hq-person-card ${state.selectedId===e.id?'selected':''}`} onClick={()=>focusEmployee(e.id)} style={{'--person-color':e.color} as CSSProperties}><div className="hq-person-top"><div className="hq-person-avatar"><Avatar employee={e} size={39}/><i style={{background:STATE_COLORS[agent.state]}}/></div><ArrowUpRight size={12}/></div><strong>{e.name}</strong><span className="hq-person-role">{e.role}</span><span className="hq-person-state"><i style={{background:STATE_COLORS[agent.state]}}/>{STATE_LABELS[agent.state]}</span></button>;})}{!filtered.length&&<p className="hq-no-members">No hay empleados con esos filtros.</p>}</div></section>
        <footer className="hq-footer"><span><span className="hq-footer-mark">✳</span> Hecho de ideas. Movido por Chatter.</span><span>OFICINA VIRTUAL <i/>FASE 01 <i/>PERFILES FICTICIOS</span><button onClick={()=>setModal('help')}>Explora tu oficina <ArrowUpRight size={10}/></button></footer>
      </main>
    </div>

    {searching&&<div className="hq-modal-backdrop" onClick={()=>setSearching(false)}><section role="dialog" aria-modal="true" aria-label="Buscar empleados" className="hq-search-modal" onClick={e=>e.stopPropagation()}><div><Search size={20}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Busca a alguien de tu equipo…" aria-label="Nombre del empleado"/><button className="hq-icon" onClick={()=>setSearching(false)}><X size={16}/></button></div><p>TU EQUIPO</p>{state.employees.filter(e=>`${e.name} ${e.role}`.toLowerCase().includes(query.toLowerCase())).map(e=><button key={e.id} onClick={()=>{go('office');select(e.id);setSearching(false);setQuery('');}}><Avatar employee={e} size={34}/><span>{e.name}<small>{e.role}</small></span><ArrowUpRight size={15}/></button>)}</section></div>}
    {modal&&<div className="hq-modal-backdrop" onClick={()=>setModal(null)}><section role="dialog" aria-modal="true" aria-labelledby="hq-modal-title" className="hq-modal" onClick={e=>e.stopPropagation()}><button className="hq-modal-close hq-icon" onClick={()=>setModal(null)} aria-label="Cerrar ventana"><X size={18}/></button>
      {modal==='help'?<><div className="hq-modal-symbol"><Building2 size={25}/></div><span className="hq-modal-eyebrow">BIENVENIDO A CASA</span><h2 id="hq-modal-title">Tu oficina ya tiene vida.</h2><p>Explora el espacio, conoce a tus especialistas y observa cómo transcurre un día en Chatter.</p><div className="hq-help-list"><div><MousePointer2 size={19}/><p><strong>Muévete por la oficina</strong><span>Arrastra para rotar. Usa clic derecho para desplazar y la rueda para acercarte.</span></p></div><div><Users size={19}/><p><strong>Conoce al equipo</strong><span>Selecciona un personaje o su tarjeta para ver su historia, editar su perfil y asignar una actividad.</span></p></div><div><Coffee size={19}/><p><strong>Deja que las ideas se encuentren</strong><span>Invita a un café, organiza una reunión o lleva al equipo al futbolito.</span></p></div><div><ShieldCheck size={19}/><p><strong>Tu espacio se conserva</strong><span>Los perfiles y el estado se guardan en este navegador. La simulación se detiene al cerrar la aplicación.</span></p></div></div><button className="hq-primary hq-full-button" onClick={()=>setModal(null)}>Vamos a la oficina<ArrowRight size={16}/></button></>
      :modal==='settings'?<><div className="hq-modal-symbol"><Settings2 size={24}/></div><span className="hq-modal-eyebrow">A TU MANERA</span><h2 id="hq-modal-title">Configuración de la oficina</h2><p>Controla el ritmo y la información de tu espacio virtual.</p><div className="hq-setting"><div><strong>Nombres en el escenario</strong><span>Identifica a cada integrante del equipo.</span></div><button className={`hq-switch ${labels?'active':''}`} role="switch" aria-checked={labels} aria-label="Nombres en el escenario" onClick={()=>setLabels(!labels)}><i/></button></div><div className="hq-setting"><div><strong>Simulación en marcha</strong><span>Los movimientos sociales no utilizan IA.</span></div><button className={`hq-switch ${!state.paused?'active':''}`} role="switch" aria-checked={!state.paused} aria-label="Simulación en marcha" onClick={togglePause}><i/></button></div><div className="hq-setting"><div><strong>Velocidad de la oficina</strong><span>Elige el ritmo de las rutinas.</span></div><select aria-label="Velocidad de la oficina" value={state.speed} onChange={e=>setSpeed(Number(e.target.value) as 1|2|4)}><option value={1}>Normal · 1×</option><option value={2}>Rápido · 2×</option><option value={4}>Muy rápido · 4×</option></select></div><div className="hq-setting"><div><strong>Zona horaria</strong><span>America/Mazatlan · GMT−7</span></div><Globe2 size={18}/></div><div className="hq-settings-actions"><button className="hq-secondary" onClick={exportState}><Download size={14}/>Exportar oficina</button><button className="hq-reset" onClick={()=>{if(window.confirm('¿Reiniciar las rutinas y perfiles de esta oficina? Esta acción restaura los diez perfiles iniciales.')){reset();notify('Oficina restaurada');setModal(null);}}}>Restaurar oficina</button></div><div className="hq-phase-note"><Cpu size={18}/><p>Fase 1 · Sin modelos, credenciales o integraciones externas. Tus datos permanecen en este navegador.</p></div></>
      :modal==='meeting'?<><div className="hq-modal-symbol"><Users size={25}/></div><span className="hq-modal-eyebrow">JUNTOS PENSAMOS MEJOR</span><h2 id="hq-modal-title">Una mesa. Nuevas posibilidades.</h2><p>Selecciona hasta cuatro integrantes. Se reunirán en la sala de juntas mediante una rutina local.</p><div className="hq-meeting-people">{state.employees.map(e=><button key={e.id} className={meetingIds.includes(e.id)?'selected':''} onClick={()=>setMeetingIds(ids=>ids.includes(e.id)?ids.filter(id=>id!==e.id):ids.length<4?[...ids,e.id]:ids)}><Avatar employee={e} size={32}/><span>{e.name}</span><span className="hq-checkbox">{meetingIds.includes(e.id)&&<Check size={12}/>}</span></button>)}</div><button className="hq-primary hq-full-button" disabled={!meetingIds.length} onClick={()=>{meetingIds.forEach(id=>command(id,'meeting'));setModal(null);notify('Reunión convocada. El equipo va camino a la sala.');go('office');}}><Users size={16}/>Reunir al equipo · {meetingIds.length} participantes</button></>
      :<><div className="hq-modal-symbol"><ListTodo size={24}/></div><h2 id="hq-modal-title">Dale movimiento a tu oficina</h2><p>Asigna una actividad simulada a un integrante.</p><form className="hq-activity-form" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);doCommand(String(data.get('employee')),String(data.get('action')) as Action);setModal(null);}}><label>Responsable<select name="employee">{state.employees.map(e=><option key={e.id} value={e.id}>{e.name} · {e.role}</option>)}</select></label><label>Actividad<select name="action"><option value="work">Trabajar en su escritorio</option><option value="coffee">Tomar un café</option><option value="meeting">Asistir a una reunión</option><option value="relax">Descansar en el lounge</option><option value="game">Jugar futbolito</option><option value="talk">Conversar con el equipo</option></select></label><button className="hq-primary hq-full-button" type="submit">Asignar actividad<ArrowRight size={16}/></button></form></>}
    </section></div>}
    {toast&&<div className="hq-toast" role="status"><span><Check size={14}/></span>{toast}<button onClick={()=>setToast('')} aria-label="Cerrar notificación"><X size={13}/></button></div>}
  </div>;
}

function EmptyState({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="hq-empty-state"><div>{icon}</div><h3>{title}</h3><p>{text}</p></div>;}
function ChatPanel({employees,channel,setChannel,messages,onSubmit,status}:{employees:Employee[];channel:string;setChannel:(channel:string)=>void;messages:Message[];onSubmit:(event:FormEvent<HTMLFormElement>)=>void;status:IntegrationStatus}){
  const directId=channel.startsWith('dm:')?channel.slice(3):null;
  const direct=employees.find(employee=>employee.id===directId);
  const hermes=employees.find(employee=>employee.id==='hermes')!;
  const isHermes=directId==='hermes';
  return <div className="hq-chat-layout">
    <aside className="hq-channel-list">
      <h3>Dirección</h3>
      <span>CANAL PRINCIPAL</span>
      <button className={isHermes?'active':''} onClick={()=>setChannel('dm:hermes')}><Avatar employee={hermes} size={24}/><span><b>Hermes</b><small>Director</small></span></button>
      <span>EQUIPO Y CANALES</span>
      {CHANNELS.map(name=><button key={name} className={channel===name?'active':''} onClick={()=>setChannel(name)}><Hash size={14}/>{name}</button>)}
      {employees.filter(employee=>employee.id!=='hermes').map(employee=><button key={employee.id} className={channel===`dm:${employee.id}`?'active':''} onClick={()=>setChannel(`dm:${employee.id}`)}><Avatar employee={employee} size={22}/>{employee.name}</button>)}
    </aside>
    <div className="hq-chat-area">
      <div className="hq-chat-title">{direct?<><Avatar employee={direct} size={30}/><div><strong>{direct.name} {direct.lastName}</strong><small>{direct.role}</small></div></>:<><Hash size={18}/>{channel.startsWith('social:')?'Conversación del equipo':channel}</>}<span className={status.telegram?'prepared':'local'}>{status.telegram?'TELEGRAM PREPARADO':'MODO LOCAL'}</span></div>
      <div className="hq-chat-messages">
        <div className={`hq-chat-welcome ${isHermes?'director':''}`}><MessageCircle size={28}/><h3>{isHermes?'Tu canal con el Director de Operaciones':'Las buenas ideas empiezan con un hola.'}</h3><p>{isHermes?'Habla aquí con Hermes Montes. Tus instrucciones locales se conservarán en este navegador. Cuando publiquemos el webhook y Supabase, este espacio mostrará la misma conversación y los trabajos enviados desde Telegram.':'Este canal todavía funciona como una conversación local de demostración.'}</p>{isHermes&&<div className="hq-connection-state"><i className={status.telegram?'ready':''}/><span>{status.telegram?'Bot configurado en esta computadora':'Telegram pendiente de configurar'}</span><b>{status.mode==='production'&&status.database?'Sincronización disponible':'Falta publicar y conectar la base de datos'}</b></div>}
        </div>
        {messages.filter(message=>message.channel===channel).map(message=><div className="hq-message" key={message.id}>{message.author==='ceo'?<span className="hq-ceo">JD</span>:<Avatar employee={employees.find(employee=>employee.id===message.author)||hermes} size={32}/>}<div><strong>{message.author==='ceo'?'Tú · CEO':employees.find(employee=>employee.id===message.author)?.name}<time>{message.time}</time>{message.author!=='ceo'&&<small>{isHermes?'VISTA LOCAL':'SIMULACIÓN'}</small>}</strong><p>{message.text}</p></div></div>)}
      </div>
      <form className="hq-chat-compose" onSubmit={onSubmit}><input name="message" placeholder={isHermes?'Escribe una instrucción para Hermes…':'Escribe un mensaje…'} aria-label="Mensaje" maxLength={2000} required autoComplete="off"/><button type="submit" aria-label="Enviar mensaje"><Send size={17}/></button></form>
      <div className="hq-chat-note"><ShieldCheck size={11}/>{isHermes?(status.telegram?'Telegram configurado · Sincronización pendiente del despliegue':'Canal local · Telegram sin configurar'):'Conversación local de demostración'}</div>
    </div>
  </div>;
}
function ReportMetric({label,value,caption,icon}:{label:string;value:string;caption:string;icon:React.ReactNode}){return <article><div>{label}{icon}</div><strong>{value}</strong><span>{caption}</span></article>;}
function EventItem({event,employees,simulationTime,latest,onSelect}:{event:OfficeEvent;employees:Employee[];simulationTime:number;latest:boolean;onSelect:(id:string)=>void}){const e=employees.find(e=>e.id===event.employeeId);if(!e)return null;const seconds=Math.max(0,Math.floor((SIMULATION_EPOCH+simulationTime*1000-event.time)/1000));return <button className={`hq-event ${latest?'latest':''}`} onClick={()=>onSelect(e.id)}><div className="hq-event-avatar"><Avatar employee={e} size={32}/><span className={`hq-event-type ${event.type}`}>{event.type==='social'?<Coffee size={9}/>:event.type==='meeting'?<Users size={9}/>:<Zap size={9}/>}</span></div><div><div className="hq-event-name">{e.name}<span>{seconds<60?'Ahora':`Hace ${Math.floor(seconds/60)} min`}</span></div><p>{event.message}</p><span className={`hq-event-tag ${event.type}`}>{event.type==='social'?'Vida de oficina':event.type==='meeting'?'En equipo':event.type==='work'?'En concentración':'Oficina'}<span>· Simulado</span></span></div></button>;}
