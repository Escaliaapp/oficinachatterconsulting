import { EMPLOYEES } from './employees';
import { isSegmentWalkable, isWalkable } from './layout';
import { createOfficeState } from './simulation';
import type { AgentState, Employee, EmployeeRuntime, OfficeEvent, OfficeState, Point2 } from './types';

export const OFFICE_STORAGE_KEY = 'chatter-headquarters:v1';
const STATES = new Set<AgentState>(['working', 'walking', 'talking', 'meeting', 'break', 'researching', 'idle', 'offline']);
const IDS = new Set(EMPLOYEES.map(e => e.id));
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const point = (v: unknown): v is Point2 => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n));
const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const text = (v: unknown, fallback: string, max = 2000) => typeof v === 'string' && v.trim() ? v.slice(0, max) : fallback;

export function serializeOfficeState(state: OfficeState): string {
  return JSON.stringify({ version: 1, state });
}

function restoreEmployee(raw: unknown, original: Employee): Employee {
  if (!isRecord(raw) || raw.id !== original.id) return original;
  const result = { ...original };
  const fields = ['name', 'lastName', 'role', 'bio', 'city', 'education', 'specialization', 'experience', 'personality', 'growth', 'relationships', 'routine'] as const;
  for (const field of fields) result[field] = text(raw[field], original[field], field === 'name' || field === 'lastName' ? 60 : 2000);
  for (const field of ['interests', 'strengths', 'weaknesses', 'tools'] as const) if (Array.isArray(raw[field]) && raw[field].every(v => typeof v === 'string')) result[field] = (raw[field] as string[]).slice(0, 20).map(v => v.slice(0, 150));
  // Prototype credits are never minted by local activity or restored from edited storage.
  result.credits = 0;
  return result;
}

function restoreAgent(raw: unknown, fallback: EmployeeRuntime): EmployeeRuntime {
  if (!isRecord(raw) || raw.id !== fallback.id || !point(raw.position) || !isWalkable(raw.position)) return fallback;
  if (!STATES.has(raw.state as AgentState) || !STATES.has(raw.destinationState as AgentState) || !Array.isArray(raw.path) || !raw.path.every(point) || raw.path.length > 100) return fallback;
  let previous = raw.position;
  for (const waypoint of raw.path) { if (!isSegmentWalkable(previous, waypoint)) return fallback; previous = waypoint; }
  if (raw.state === 'walking' && !raw.path.length) return fallback;
  return {
    ...fallback, position: [...raw.position], state: raw.state as AgentState, destinationState: raw.destinationState as AgentState,
    rotation: typeof raw.rotation === 'number' && Number.isFinite(raw.rotation) ? raw.rotation : fallback.rotation,
    activity: text(raw.activity, fallback.activity, 200), target: ['work', 'coffee', 'meeting', 'relax', 'talk', 'game'].includes(raw.target as string) ? raw.target as string : 'work',
    path: raw.path.map(p => [...p] as Point2), elapsed: finitePositive(raw.elapsed) ? Math.min(raw.elapsed, 1000) : 0,
    cycle: finitePositive(raw.cycle) ? Math.floor(raw.cycle) : 0,
    partnerId: typeof raw.partnerId === 'string' && IDS.has(raw.partnerId) ? raw.partnerId : undefined,
    conversationId: typeof raw.conversationId === 'string' ? raw.conversationId.slice(0, 150) : undefined,
  };
}

/** Fail closed on damaged/old storage, while retaining independently valid profile edits. */
export function restoreOfficeState(serialized: string | null | undefined): OfficeState {
  const fallback = createOfficeState();
  if (!serialized || serialized.length > 1_000_000) return fallback;
  try {
    const data: unknown = JSON.parse(serialized);
    if (!isRecord(data) || data.version !== 1 || !isRecord(data.state)) return fallback;
    const raw = data.state;
    const employees = fallback.employees.map(employee => restoreEmployee(Array.isArray(raw.employees) ? raw.employees.find(e => isRecord(e) && e.id === employee.id) : undefined, employee));
    const agents = fallback.agents.map(agent => restoreAgent(Array.isArray(raw.agents) ? raw.agents.find(a => isRecord(a) && a.id === agent.id) : undefined, agent));
    const events: OfficeEvent[] = Array.isArray(raw.events) ? raw.events.filter((e): e is OfficeEvent => isRecord(e) && typeof e.id === 'string' && e.id.length < 250 && typeof e.employeeId === 'string' && IDS.has(e.employeeId) && ['work', 'social', 'meeting', 'system'].includes(e.type as string) && typeof e.message === 'string' && e.message.length < 500 && finitePositive(e.time) && (e.conversationId === undefined || typeof e.conversationId === 'string')).slice(0, 100) : fallback.events;
    return { employees, agents, events, paused: typeof raw.paused === 'boolean' ? raw.paused : false, speed: raw.speed === 2 || raw.speed === 4 ? raw.speed : 1, simulationTime: finitePositive(raw.simulationTime) ? Math.min(raw.simulationTime, 86400 * 365) : 0, selectedId: typeof raw.selectedId === 'string' && IDS.has(raw.selectedId) ? raw.selectedId : null };
  } catch { return fallback; }
}

export function updateEmployeeProfile(state: OfficeState, id: string, changes: Partial<Employee>): OfficeState {
  return { ...state, employees: state.employees.map(employee => employee.id === id ? restoreEmployee({ ...employee, ...changes, id }, employee) : employee) };
}
