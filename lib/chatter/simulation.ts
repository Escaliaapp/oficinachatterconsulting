import { EMPLOYEES } from './employees';
import { findPath, OFFICE_LAYOUT } from './layout';
import type { AgentCommand, AgentState, EmployeeRuntime, OfficeEvent, OfficeState, Point2 } from './types';

export const SIMULATION_EPOCH = Date.parse('2026-10-26T16:00:00Z');
const MAX_EVENTS = 100;
const WORK_ACTIVITIES: Record<string, string> = {
  hermes: 'Organizando las prioridades del equipo', luna: 'Coordinando la agenda de la oficina',
  diego: 'Explorando un brief de prospección', mateo: 'Revisando una propuesta de campaña',
  valentina: 'Explorando un nuevo concepto visual', ana: 'Escribiendo ideas para el próximo guion',
  lucia: 'Investigando tendencias de búsqueda', jorge: 'Diseñando un flujo de automatización',
  pablo: 'Explorando el tablero de métricas', carlos: 'Preparando una reunión de seguimiento',
};
const ROUTINE: AgentCommand[] = ['talk', 'work', 'talk', 'meeting', 'talk', 'coffee', 'talk', 'work', 'meeting'];
const CONVERSATION_SPOTS: [Point2, Point2][] = [
  [[5.5, -3.5], [6.7, -3.5]],
  [[4, -2], [5.2, -2]],
  [[7.3, -2], [8.5, -2]],
];
const OBJECTIVES: Record<string, string> = { hermes: 'alinear prioridades y desbloqueos del equipo', luna: 'coordinar la agenda y las próximas citas', diego: 'mejorar la calidad y cobertura de los prospectos', mateo: 'optimizar campañas con el presupuesto autorizado', valentina: 'convertir briefs en piezas listas para revisión', ana: 'mejorar el mensaje y los guiones de campaña', lucia: 'captar oportunidades y atribuir cada prospecto', jorge: 'mantener el CRM limpio y automatizado', pablo: 'medir resultados y preparar el cierre diario', carlos: 'convertir conversaciones en citas calificadas' };
const PAIR_DECISIONS: Record<string, string> = { 'ana-valentina': 'Ana entrega un brief y Valentina prepara una variante visual para revisión.', 'diego-jorge': 'Diego comparte prospectos con fuente y Jorge los deduplica antes de activar seguimiento.', 'jorge-lucia': 'Lucía entrega prospectos atribuidos y Jorge confirma su entrada al CRM.', 'carlos-jorge': 'Jorge asigna contactos calificados y Carlos prepara el siguiente contacto.', 'mateo-pablo': 'Mateo comparte resultados de campaña y Pablo los incorpora al reporte.', 'hermes-pablo': 'Hermes define prioridades y Pablo prepara métricas para el cierre diario.' };
function decisionFor(a: string, b: string) { return PAIR_DECISIONS[[a,b].sort().join('-')] ?? `${OBJECTIVES[a] ?? 'el objetivo del equipo'} y ${OBJECTIVES[b] ?? 'el siguiente paso'} quedan alineados.`; }

function event(state: OfficeState, id: string, type: OfficeEvent['type'], message: string, conversationId?: string): OfficeEvent {
  const sequence=state.events.reduce((max,item)=>Math.max(max,Number(/^event-(\d+)-/.exec(item.id)?.[1]||0)),0)+1;
  return { id: `event-${sequence}-${Math.round(state.simulationTime * 1000)}-${id}`, employeeId: id, type, message, time: SIMULATION_EPOCH + state.simulationTime * 1000, ...(conversationId ? { conversationId } : {}) };
}
function addEvent(state: OfficeState, item: OfficeEvent): OfficeState {
  return { ...state, events: [item, ...state.events].slice(0, MAX_EVENTS) };
}

function workState(id: string): AgentState { return id === 'lucia' ? 'researching' : 'working'; }
function destinationActivity(id: string, target: string): string {
  if (target === 'work') return WORK_ACTIVITIES[id] ?? 'Trabajando en su escritorio';
  if (target === 'coffee') return 'Tomando un café en la cafetería';
  if (target === 'relax') return 'Recargando energía en la sala de descanso';
  if (target === 'game') return 'En una partida de futbolito';
  if (target === 'meeting') return 'Compartiendo prioridades en la sala de juntas';
  return 'Compartiendo ideas con el equipo';
}
function travel(agent: EmployeeRuntime, destination: Point2, target: AgentCommand, destinationState: AgentState): EmployeeRuntime {
  const path = findPath(agent.position, destination);
  if (!path.length) return { ...agent, elapsed: 0, state: 'idle', activity: 'Esperando una ruta disponible', path: [], target, destinationState };
  if (Math.hypot(agent.position[0] - destination[0], agent.position[1] - destination[1]) < .05) {
    return { ...agent, position: [...destination], state: destinationState, activity: destinationActivity(agent.id, target), path: [], target, destinationState, elapsed: 0 };
  }
  const actionLabels: Record<AgentCommand, string> = { work: 'Regresando a su escritorio', coffee: 'De camino a la cafetería', meeting: 'De camino a la sala de juntas', relax: 'De camino a descansar', talk: 'Acercándose a un compañero', game: 'De camino al futbolito' };
  return { ...agent, path, state: 'walking', target, destinationState, elapsed: 0, activity: actionLabels[target] };
}

/** Local commands share one entry point; a future backend event adapter can call it. */
export function commandAgent(state: OfficeState, id: string, action: AgentCommand): OfficeState {
  const index = state.agents.findIndex(a => a.id === id);
  if (index < 0 || state.agents[index].state === 'offline') return state;
  const source = state.agents[index];
  const agents = state.agents.map(a => {
    if (a.partnerId !== id) return a;
    const home = OFFICE_LAYOUT.desks.find(d => d.id === a.id)!.seat;
    return travel({ ...a, partnerId: undefined, conversationId: undefined }, home, 'work', workState(a.id));
  });
  const agent = { ...source, partnerId: undefined, conversationId: undefined };
  const seat = OFFICE_LAYOUT.desks.find(d => d.id === id)?.seat;
  if (!seat) return state;
  let message = ''; let type: OfficeEvent['type'] = 'social';
  if (action === 'work') {
    agents[index] = travel(agent, seat, action, workState(id)); message = 'Retoma su espacio de trabajo'; type = 'work';
  } else if (action === 'coffee') {
    agents[index] = travel(agent, OFFICE_LAYOUT.coffeeSeats[index], action, 'break'); message = 'Hace una pausa para tomar café';
  } else if (action === 'relax') {
    agents[index] = travel(agent, OFFICE_LAYOUT.loungeSeats[index], action, 'break'); message = 'Se dirige a la sala de descanso';
  } else if (action === 'game') {
    agents[index] = travel(agent, OFFICE_LAYOUT.gameSeats[index], action, 'break'); message = 'Se suma a una partida de futbolito';
  } else if (action === 'meeting') {
    const conversationId=agents.find(a=>a.target==='meeting'&&a.conversationId)?.conversationId??`meeting-${id}-${Math.round(state.simulationTime*1000)}`;
    agents[index] = travel(agent, OFFICE_LAYOUT.meetingSeats[index], action, 'meeting'); message = id === 'hermes' ? 'Convoca una reunión breve de coordinación' : 'Se reúne con Hermes para revisar prioridades'; type = 'meeting';
    agents[index]={...agents[index],conversationId};
    if (id !== 'hermes') {
      const hermesIndex = agents.findIndex(a => a.id === 'hermes');
      if (hermesIndex >= 0 && agents[hermesIndex].state !== 'offline'&&agents[hermesIndex].conversationId!==conversationId) agents[hermesIndex] = travel({ ...agents[hermesIndex], partnerId: undefined, conversationId }, OFFICE_LAYOUT.meetingSeats[hermesIndex], 'meeting', 'meeting');
    }
  } else {
    const department=state.employees.find(e=>e.id===id)?.department;
    const candidates=agents.map((a,i)=>({a,i})).filter(({a,i})=>i!==index&&a.state!=='offline'&&a.state!=='walking'&&a.state!=='meeting'&&!a.partnerId);
    const preferred=candidates.find(({a})=>state.employees.find(e=>e.id===a.id)?.department===department);
    const linked=candidates.find(({a})=>[id,a.id].sort().join('-') in PAIR_DECISIONS);
    const chosen=(preferred??linked??candidates[0])?.i??-1;
    if (chosen < 0) return commandAgent(state, id, 'relax');
    const spot = CONVERSATION_SPOTS.find(pair => !agents.some((a, i) => {
      if (i === index || i === chosen || a.target !== 'talk' || !a.partnerId) return false;
      const destination = a.path.at(-1) ?? a.position;
      return pair.some(p => Math.hypot(p[0] - destination[0], p[1] - destination[1]) < .5);
    }));
    if (!spot) return commandAgent(state, id, 'relax');
    const conversationId = `conversation-${id}-${agents[chosen].id}-${Math.round(state.simulationTime * 1000)}`;
    agents[index] = { ...travel(agent, spot[0], 'talk', 'talking'), partnerId: agents[chosen].id, conversationId };
    agents[chosen] = { ...travel(agents[chosen], spot[1], 'talk', 'talking'), partnerId: id, conversationId };
    const name = state.employees.find(e => e.id === agents[chosen].id)?.name ?? 'un compañero';
    message = `${decisionFor(id, agents[chosen].id)} (${name})`;
    return addEvent({ ...state, agents }, event(state, id, 'social', message, conversationId));
  }
  return addEvent({ ...state, agents }, event(state, id, type, message));
}

export function createOfficeState(): OfficeState {
  const state: OfficeState = {
    employees: structuredClone(EMPLOYEES),
    agents: EMPLOYEES.map((employee, index) => ({
      id: employee.id, position: [...OFFICE_LAYOUT.desks.find(d => d.id === employee.id)!.seat],
      rotation: Math.PI, state: workState(employee.id), activity: WORK_ACTIVITIES[employee.id],
      path: [], target: 'work', destinationState: workState(employee.id), elapsed: index * 2.3, cycle: index,
      partnerId: undefined, conversationId: undefined,
    })),
    events: [], paused: false, speed: 1, simulationTime: 0, selectedId: null,
  };
  const opening: [string, OfficeEvent['type'], string][] = [
    ['hermes', 'meeting', 'El equipo está listo para un nuevo día'],
    ['mateo', 'work', 'Explora una propuesta de campaña'],
    ['ana', 'work', 'Prepara ideas para un nuevo guion'],
    ['jorge', 'work', 'Revisa el mapa de automatizaciones'],
    ['lucia', 'work', 'Organiza sus referencias de investigación'],
    ['luna', 'system', 'La oficina abre sus puertas'],
  ];
  state.events = opening.map(([id, type, message], index) => ({ id: `opening-${index}`, employeeId: id, type, message, time: SIMULATION_EPOCH - index * 60_000 }));
  state.agents[4] = { ...state.agents[4], position: [5.5, -3.5], state: 'talking', target: 'talk', destinationState: 'talking', partnerId: 'ana', conversationId: 'conversation-opening', activity: 'Comparte referencias creativas con Ana', elapsed: 0 };
  state.agents[5] = { ...state.agents[5], position: [6.7, -3.5], state: 'talking', target: 'talk', destinationState: 'talking', partnerId: 'valentina', conversationId: 'conversation-opening', activity: 'Explora un concepto con Valentina', elapsed: 0 };
  const withWalkers = commandAgent(commandAgent(state, 'diego', 'coffee'), 'carlos', 'meeting');
  return { ...withWalkers, events: [event(state, 'valentina', 'social', 'Comparte un concepto creativo con Ana', 'conversation-opening'), ...withWalkers.events] };
}

function advanceAgent(agent: EmployeeRuntime, seconds: number): EmployeeRuntime {
  if (agent.state === 'offline') return agent;
  if (agent.state !== 'walking') return { ...agent, elapsed: agent.elapsed + seconds };
  let position: Point2 = [...agent.position]; let path = agent.path; let remaining = seconds * 1.12; let rotation = agent.rotation;
  while (remaining > 0 && path.length) {
    const target = path[0]; const dx = target[0] - position[0]; const dz = target[1] - position[1]; const length = Math.hypot(dx, dz);
    if (length > .001) rotation = Math.atan2(dx, dz);
    if (length <= remaining) { position = [...target]; path = path.slice(1); remaining -= length; }
    else { position = [position[0] + dx / length * remaining, position[1] + dz / length * remaining]; remaining = 0; }
  }
  if (!path.length) return { ...agent, position, path, rotation: agent.target === 'work' ? Math.PI : rotation, state: agent.destinationState, activity: destinationActivity(agent.id, agent.target), elapsed: 0 };
  return { ...agent, position, path, rotation, elapsed: agent.elapsed + seconds };
}

/** Frame-independent pure state machine; it never calls an AI model or external API. */
export function stepSimulation(state: OfficeState, deltaSeconds: number): OfficeState {
  if (state.paused || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return state;
  const elapsed = Math.min(deltaSeconds, 1) * state.speed;
  let next: OfficeState = { ...state, simulationTime: state.simulationTime + elapsed, agents: state.agents.map(agent => advanceAgent(agent, elapsed)) };
  next={...next,agents:next.agents.map(agent=>{
    if(agent.state==='walking'||agent.state==='offline')return agent;
    const partner=agent.partnerId?next.agents.find(a=>a.id===agent.partnerId):undefined;
    const facing=partner&&agent.state==='talking'?partner.position:agent.state==='meeting'?OFFICE_LAYOUT.meeting:agent.target==='game'?[6.5,0]:agent.target==='coffee'?[6.6,4.5]:null;
    return facing?{...agent,rotation:Math.atan2(facing[0]-agent.position[0],facing[1]-agent.position[1])}:agent;
  })};
  // At most one routine is scheduled per tick to avoid bursts of duplicate social events.
  const index = next.agents.findIndex((agent, i) => agent.state !== 'walking' && agent.state !== 'offline' && agent.elapsed >= (agent.state === 'talking' ? 45 : agent.state === 'meeting' ? 85 : agent.state === 'working' || agent.state === 'researching' ? 16 + i : 20 + i));
  if (index >= 0) {
    const agent = next.agents[index]; const cycle = agent.cycle + 1;
    const action = agent.target === 'work' ? ROUTINE[cycle % ROUTINE.length] : 'work';
    next = { ...next, agents: next.agents.map((a, i) => i === index ? { ...a, cycle } : a) };
    next = commandAgent(next, agent.id, action);
  }
  return next;
}

export function setAgentEnabled(state: OfficeState, id: string, enabled: boolean): OfficeState {
  if (!state.agents.some(a => a.id === id)) return state;
  const next = { ...state, agents: state.agents.map(agent => {
    if(agent.id===id)return {...agent,state:(enabled?'idle':'offline') as AgentState,path:[],elapsed:0,activity:enabled?'Disponible para el equipo':'Agente pausado por el CEO',partnerId:undefined,conversationId:undefined};
    if(!enabled&&agent.partnerId===id){const seat=OFFICE_LAYOUT.desks.find(d=>d.id===agent.id)!.seat;return travel({...agent,partnerId:undefined,conversationId:undefined},seat,'work',workState(agent.id));}
    return agent;
  }) };
  return enabled ? commandAgent(next, id, 'work') : addEvent(next, event(next, id, 'system', 'Actividad individual pausada'));
}

/** Phase 2 integration boundary: renderers need no provider-specific dependencies. */
export type OfficeDomainEvent =
  | { type: 'TASK_STARTED'; employeeId: string }
  | { type: 'AGENT_MEETING_REQUESTED'; employeeId: string }
  | { type: 'AGENT_BREAK_REQUESTED'; employeeId: string }
  | { type: 'AGENT_PAUSED'; employeeId: string };
export function applyOfficeEvent(state: OfficeState, incoming: OfficeDomainEvent): OfficeState {
  if (incoming.type === 'AGENT_PAUSED') return setAgentEnabled(state, incoming.employeeId, false);
  return commandAgent(state, incoming.employeeId, incoming.type === 'AGENT_MEETING_REQUESTED' ? 'meeting' : incoming.type === 'AGENT_BREAK_REQUESTED' ? 'coffee' : 'work');
}
