export type Point2 = [number, number];
export type AgentState = 'working' | 'walking' | 'talking' | 'meeting' | 'break' | 'researching' | 'idle' | 'offline';
export type AgentCommand = 'work' | 'coffee' | 'meeting' | 'relax' | 'talk' | 'game';

/** All employees and their biographies are fictional prototype characters. */
export interface Employee {
  id: string; name: string; lastName: string; role: string; department: string;
  age: number; birthDate: string; color: string; skinColor: string; hairColor: string;
  gender: 'male' | 'female'; bio: string; city: string; education: string;
  specialization: string; experience: string; personality: string; interests: string[];
  strengths: string[]; weaknesses: string[]; growth: string; relationships: string;
  routine: string; tools: string[]; credits: number; performance: number;
}
export interface EmployeeRuntime {
  id: string; position: Point2; rotation: number; state: AgentState; activity: string;
  path: Point2[]; target: string; elapsed: number; cycle: number;
  destinationState: AgentState; partnerId?: string; conversationId?: string;
}
export interface OfficeEvent {
  id: string; employeeId: string; type: 'work' | 'social' | 'meeting' | 'system';
  message: string; time: number; conversationId?: string;
}
export interface OfficeState {
  employees: Employee[]; agents: EmployeeRuntime[]; events: OfficeEvent[];
  paused: boolean; speed: 1 | 2 | 4; simulationTime: number; selectedId: string | null;
}
export const STATE_LABELS: Record<AgentState, string> = {
  working: 'Trabajando', walking: 'En movimiento', talking: 'Conversando',
  meeting: 'En reunión', break: 'Descansando', researching: 'Investigando',
  idle: 'Disponible', offline: 'Fuera de horario',
};
export const STATE_COLORS: Record<AgentState, string> = {
  working: '#b8e88a', walking: '#83c8f8', talking: '#c0a1ef', meeting: '#f0be7e',
  break: '#d7bd89', researching: '#85c9d0', idle: '#b8e88a', offline: '#7b818b',
};
