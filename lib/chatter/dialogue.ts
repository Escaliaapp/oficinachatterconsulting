import type { Employee, EmployeeRuntime } from './types';

/** Local proposals, not evidence that external work has been executed. */
export function dialogueLines(person: Employee) {
  return [
    `Desde ${person.role}, propongo revisar qué nos acerca a conseguir citas y clientes.`,
    `Mi prioridad es ${person.growth.replace(/\.$/, '').toLowerCase()}. ¿Qué necesitas de mí?`,
    `Propongo compartir un entregable verificable y revisar los bloqueos con Hermes.`,
    `Siguiente paso propuesto: validar el resultado antes de dar el trabajo por terminado.`,
  ];
}

export function speechTurn(runtime: EmployeeRuntime, agents: EmployeeRuntime[]) {
  if (!['talking', 'meeting'].includes(runtime.state)) return null;
  const members = runtime.state === 'meeting'
    ? agents.filter(a => a.target === 'meeting' && a.conversationId===runtime.conversationId).sort((a,b) => a.id.localeCompare(b.id))
    : agents.filter(a => a.id === runtime.id || a.id === runtime.partnerId).sort((a,b) => a.id.localeCompare(b.id));
  if (members.length < 2 || members.some(a => a.state === 'walking')) return null;
  const elapsed = Math.min(...members.map(a => a.elapsed));
  const turn = Math.floor(elapsed / 5);
  if (turn >= members.length * 4 || members[turn % members.length].id !== runtime.id) return null;
  return Math.floor(turn / members.length);
}

export function visibleSpeech(person: Employee, runtime: EmployeeRuntime, agents: EmployeeRuntime[]) {
  const turn=speechTurn(runtime,agents);
  return turn===null?null:dialogueLines(person)[turn];
}
