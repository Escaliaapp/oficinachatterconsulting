import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYEES } from '../lib/chatter/employees';
import { findPath, isSegmentWalkable, isWalkable, OFFICE_LAYOUT } from '../lib/chatter/layout';
import { createOfficeState, commandAgent, stepSimulation, setAgentEnabled, applyOfficeEvent } from '../lib/chatter/simulation';
import { restoreOfficeState, serializeOfficeState, updateEmployeeProfile } from '../lib/chatter/persistence';

test('ten unique fictional employees have complete identities and no simulated earnings', () => {
  assert.equal(EMPLOYEES.length, 10); assert.equal(new Set(EMPLOYEES.map(e => e.id)).size, 10);
  for (const employee of EMPLOYEES) {
    assert.ok(employee.bio.length > 100); assert.ok(employee.birthDate); assert.ok(employee.education.includes('fictici'));
    assert.ok(employee.strengths.length); assert.ok(employee.weaknesses.length); assert.ok(employee.relationships); assert.equal(employee.credits, 0);
  }
});

test('every workspace and social destination is walkable and connected around physical obstacles', () => {
  const destinations = [...OFFICE_LAYOUT.meetingSeats, ...OFFICE_LAYOUT.coffeeSeats, ...OFFICE_LAYOUT.loungeSeats, ...OFFICE_LAYOUT.gameSeats];
  for (const desk of OFFICE_LAYOUT.desks) {
    assert.ok(isWalkable(desk.seat), desk.id);
    for (const destination of destinations) {
      assert.ok(isWalkable(destination), `destination ${destination}`);
      const path = findPath(desk.seat, destination); assert.ok(path.length > 0, `${desk.id} -> ${destination}`);
      let previous = desk.seat;
      for (const waypoint of path) { assert.ok(isSegmentWalkable(previous, waypoint), `${previous} -> ${waypoint}`); previous = waypoint; }
      assert.deepEqual(path.at(-1), destination);
    }
  }
  assert.deepEqual(findPath([-7, -4.5], [0, 0]), []);
  assert.equal(isSegmentWalkable([-8, -4.5], [-6, -4.5]), false);
});

test('commands reach requested rooms, meetings include Hermes, and social movement creates no credits', () => {
  for (const action of ['coffee', 'relax', 'meeting', 'game', 'work'] as const) {
    let state = commandAgent(createOfficeState(), 'pablo', action);
    assert.equal(state.agents.find(a => a.id === 'pablo')?.target, action);
    if (action === 'meeting') assert.equal(state.agents.find(a => a.id === 'hermes')?.target, 'meeting');
    for (let i = 0; i < 1000 && state.agents.find(a => a.id === 'pablo')?.state === 'walking'; i++) {
      const previous = state; state = stepSimulation(state, .05);
      for (let j = 0; j < state.agents.length; j++) assert.ok(isSegmentWalkable(previous.agents[j].position, state.agents[j].position));
    }
    const agent = state.agents.find(a => a.id === 'pablo')!;
    assert.notEqual(agent.state, 'walking'); assert.equal(agent.target, action);
    assert.ok(state.employees.every(e => e.credits === 0));
  }
});

test('pause freezes time, movement and events; speed advances the local clock', () => {
  const original = createOfficeState(); const paused = { ...original, paused: true };
  assert.equal(stepSimulation(paused, .5), paused);
  assert.equal(stepSimulation(original, Number.NaN), original);
  assert.equal(stepSimulation(original, -1), original);
  assert.equal(stepSimulation({ ...original, speed: 4 }, .5).simulationTime, 2);
});

test('individual pause keeps that character still while other employees continue', () => {
  let state = setAgentEnabled(createOfficeState(), 'diego', false);
  const position = state.agents.find(a => a.id === 'diego')!.position;
  for (let i = 0; i < 30; i++) state = stepSimulation(state, .5);
  assert.deepEqual(state.agents.find(a => a.id === 'diego')!.position, position);
  assert.equal(state.agents.find(a => a.id === 'diego')!.state, 'offline');
  state = setAgentEnabled(state, 'diego', true);
  assert.notEqual(state.agents.find(a => a.id === 'diego')!.state, 'offline');
});

test('conversation commands link two employees to one inspectable simulated conversation', () => {
  const state = commandAgent(createOfficeState(), 'pablo', 'talk'); const agent = state.agents.find(a => a.id === 'pablo')!;
  assert.ok(agent.partnerId); assert.ok(agent.conversationId);
  const partner = state.agents.find(a => a.id === agent.partnerId)!;
  assert.equal(partner.partnerId, agent.id); assert.equal(partner.conversationId, agent.conversationId);
  assert.equal(state.events[0].conversationId, agent.conversationId);
});

test('state and profile edits round trip across reloads without extrapolating closed-browser time', () => {
  let state = updateEmployeeProfile(createOfficeState(), 'ana', { bio: 'Una historia editada por el CEO.', interests: ['Lectura', 'Café'] });
  state = { ...stepSimulation(state, .5), selectedId: 'ana', paused: true, speed: 2 };
  assert.deepEqual(restoreOfficeState(serializeOfficeState(state)), state);
});

test('damaged, obsolete and unsafe storage recovers without accepting impossible routes or minted credits', () => {
  for (const raw of [undefined, null, '', 'not json', '{}', '{"version":999,"state":{}}', 'null']) assert.equal(restoreOfficeState(raw).employees.length, 10);
  const original = createOfficeState(); const corrupt = structuredClone(original);
  corrupt.agents[0].position = [100, 100]; corrupt.employees[0].credits = 99999;
  corrupt.agents[1].path = [[-7, 4.2]]; corrupt.agents[1].state = 'walking';
  const restored = restoreOfficeState(serializeOfficeState(corrupt));
  assert.deepEqual(restored.agents[0], original.agents[0]); assert.deepEqual(restored.agents[1], original.agents[1]); assert.equal(restored.employees[0].credits, 0);
});

test('future domain events use the same navigation/state boundary and never mutate the input', () => {
  const original = createOfficeState(); const clone = structuredClone(original);
  const next = applyOfficeEvent(original, { type: 'AGENT_MEETING_REQUESTED', employeeId: 'pablo' });
  assert.deepEqual(original, clone); assert.equal(next.agents.find(a => a.id === 'pablo')?.target, 'meeting');
});

test('routine simulation stays bounded and characters remain outside furniture over a full session', () => {
  let state = createOfficeState();
  for (let frame = 0; frame < 1800; frame++) {
    state = stepSimulation(state, .2);
    for (const agent of state.agents) assert.ok(isWalkable(agent.position), `${agent.id}: ${agent.position}`);
  }
  assert.ok(state.events.length <= 100); assert.ok(state.events.some(e => e.type === 'social')); assert.ok(state.employees.every(e => e.credits === 0));
});
test('repeated commands remain uniquely identifiable after the bounded event log fills',()=>{
  let state={...createOfficeState(),paused:true};
  for(let i=0;i<150;i++)state=commandAgent(state,'luna','work');
  assert.equal(state.events.length,100);
  assert.equal(new Set(state.events.map(e=>e.id)).size,100);
});

test('pausing one conversational partner releases the other participant',()=>{
  const state=setAgentEnabled(createOfficeState(),'ana',false);
  assert.equal(state.agents.find(a=>a.id==='ana')?.state,'offline');
  assert.equal(state.agents.find(a=>a.id==='valentina')?.partnerId,undefined);
  assert.equal(state.agents.find(a=>a.id==='valentina')?.target,'work');
});
