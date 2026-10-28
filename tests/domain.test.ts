import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsyncMutex, DemoEngine, DomainError, assertProposalTransition, type Action, type User } from '../lib/domain';
import { assertSameOrigin, beginSession, endSession, parseAction, parseRole, requireDemoMode, runtime, sessionUserId } from '../lib/demo-store';
import { moderateText } from '../lib/moderation';
import { GET as getRoom } from '../app/api/room/route';
import { POST as postAction } from '../app/api/action/route';
import { POST as postSession, DELETE as deleteSession } from '../app/api/session/route';

function setup() {
  let now = 1_800_000_000_000;
  const engine = new DemoEngine(() => now);
  let key = 0;
  const act = (user: User, action: Action, idempotencyKey = `test-key-${++key}`) => engine.execute(user.id, action, idempotencyKey);
  const advance = (ms: number) => { now += ms; engine.tick(); };
  const advertiser = (id: string) => engine.createDemoUser('advertiser', id);
  const ownAd = (user: User) => engine.snapshot(user.id).proposals.find((p) => p.authorId === user.id && p.kind === 'sponsored')!.id;
  return { engine, act, advance, advertiser, ownAd, now: () => now };
}

test('guest snapshot is watchable and excludes private balances, moderation and ledger', () => {
  const { engine } = setup();
  const snapshot = engine.snapshot();
  assert.equal(snapshot.user, null);
  assert.equal(snapshot.admin, null);
  assert.equal(snapshot.currentClip.author, 'Luna');
  assert.equal(snapshot.nextClip?.author, 'Milo');
  assert.equal(snapshot.auction.leader?.amount, 120);
  assert.equal(snapshot.proposals.filter((p) => p.status === 'eligible' && p.kind === 'community').length, 3);
  assert.equal(snapshot.mode, 'demo');
  assert.deepEqual(engine.getBalance('nova'), { available: 1080, reserved: 120, total: 1200 });
});

test('credits reserve, release on outbid and consume exactly once at close', () => {
  const { engine, act, advertiser, ownAd } = setup();
  const a = advertiser('a'); const b = advertiser('b');
  act(a, { type: 'bid', amount: 150, proposalId: ownAd(a) });
  assert.deepEqual(engine.getBalance('nova'), { available: 1200, reserved: 0, total: 1200 });
  assert.deepEqual(engine.getBalance(a.id), { available: 1050, reserved: 150, total: 1200 });
  act(b, { type: 'bid', amount: 180, proposalId: ownAd(b) });
  assert.deepEqual(engine.getBalance(a.id), { available: 1200, reserved: 0, total: 1200 });
  assert.equal(engine.closeAuction('system', true), true);
  const ledgerCount = engine.getLedger().length;
  assert.equal(engine.closeAuction('system', true), false);
  assert.equal(engine.getLedger().length, ledgerCount);
  assert.deepEqual(engine.getBalance(b.id), { available: 1020, reserved: 0, total: 1020 });
  assert.equal(engine.getLedger().filter((e) => e.kind === 'consume').length, 1);
  assert.equal(engine.snapshot().auction.winner?.userId, b.id);
});

test('self outbid releases old hold and checks only the additional amount', () => {
  const { engine, act, advertiser, ownAd } = setup();
  const user = advertiser('a');
  act(user, { type: 'bid', amount: 1000, proposalId: ownAd(user) });
  act(user, { type: 'bid', amount: 1200, proposalId: ownAd(user) });
  assert.deepEqual(engine.getBalance(user.id), { available: 0, reserved: 1200, total: 1200 });
  const ledger = engine.getLedger();
  assert.throws(() => act(user, { type: 'bid', amount: 1210, proposalId: ownAd(user) }), (e: unknown) => e instanceof DomainError && e.code === 'insufficient_credits');
  assert.deepEqual(engine.getLedger(), ledger);
});

test('idempotent command retry cannot double reserve and key reuse with changed payload is rejected', () => {
  const { engine, act, advertiser, ownAd } = setup();
  const user = advertiser('a');
  const action: Action = { type: 'bid', amount: 150, proposalId: ownAd(user) };
  act(user, action, 'same-key');
  const before = engine.getLedger();
  assert.equal(act(user, action, 'same-key').duplicate, true);
  assert.deepEqual(engine.getLedger(), before);
  assert.throws(() => act(user, { ...action, amount: 170 }, 'same-key'), (e: unknown) => e instanceof DomainError && e.code === 'idempotency_conflict');
});

test('concurrent bidders are serialized, preserve total credits and never hold losing funds', async () => {
  const { engine, act, advertiser, ownAd } = setup();
  const users = Array.from({ length: 10 }, (_, i) => advertiser(`bidder-${i}`));
  const results = await Promise.allSettled(users.map((user, i) => engine.mutex.run(() => act(user, { type: 'bid', amount: 150 + i * 10, proposalId: ownAd(user) }))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.equal(engine.snapshot().auction.leader?.amount, 240);
  assert.equal(users.reduce((sum, u) => sum + engine.getBalance(u.id).reserved, 0), 240);
  for (const user of users) assert.equal(engine.getBalance(user.id).total, 1200);
  engine.closeAuction('system', true);
  assert.equal(users.reduce((sum, u) => sum + engine.getBalance(u.id).total, 0), 12000 - 240);
  assert.ok(users.every((u) => engine.getBalance(u.id).available >= 0 && engine.getBalance(u.id).reserved === 0));
});

test('mutex releases after errors and enforces FIFO across asynchronous transactions', async () => {
  const mutex = new AsyncMutex(); const order: number[] = [];
  const first = mutex.run(async () => { order.push(1); await Promise.resolve(); order.push(2); throw new Error('expected'); });
  const second = mutex.run(() => { order.push(3); return true; });
  await assert.rejects(first);
  assert.equal(await second, true);
  assert.deepEqual(order, [1, 2, 3]);
});

test('late bid extends server deadline, capped at two extensions', () => {
  const { engine, act, advance, advertiser, ownAd } = setup();
  const user = advertiser('late');
  const originalEnd = engine.snapshot().auction.endsAt;
  advance(130_000);
  act(user, { type: 'bid', amount: 150, proposalId: ownAd(user) });
  assert.equal(engine.snapshot().auction.endsAt, originalEnd + 20_000);
  assert.equal(engine.snapshot().auction.status, 'extended');
  advance(20_000);
  act(user, { type: 'bid', amount: 170, proposalId: ownAd(user) });
  assert.equal(engine.snapshot().auction.endsAt, originalEnd + 40_000);
  advance(20_000);
  act(user, { type: 'bid', amount: 190, proposalId: ownAd(user) });
  assert.equal(engine.snapshot().auction.extensions, 2);
  assert.equal(engine.snapshot().auction.endsAt, originalEnd + 40_000);
  advance(10_001);
  assert.equal(engine.snapshot().auction.status, 'settled');
  assert.throws(() => act(user, { type: 'bid', amount: 210, proposalId: ownAd(user) }));
});

test('rejected, unapproved, another author and non-advertiser bids cannot touch balances', () => {
  const { engine, act, advertiser, ownAd } = setup();
  const subscriber = engine.createDemoUser('subscriber', 'reader'); const ad = advertiser('a');
  const original = engine.getLedger();
  assert.throws(() => act(subscriber, { type: 'bid', amount: 200, proposalId: ownAd(ad) }));
  assert.throws(() => act(ad, { type: 'bid', amount: 200, proposalId: 'sponsor-nova' }));
  act(ad, { type: 'propose', prompt: 'Una escultura original de papel presentada por Estudio Aurora.', kind: 'sponsored' });
  const pending = engine.snapshot(ad.id).proposals.find((p) => p.authorId === ad.id && p.status === 'pending_moderation')!;
  assert.throws(() => act(ad, { type: 'bid', amount: 200, proposalId: pending.id }));
  assert.deepEqual(engine.getLedger(), original);
});

test('cancelling auction releases winner hold and does not generate a sponsored clip', () => {
  const { engine, act } = setup();
  const moderator = engine.createDemoUser('moderator', 'mod');
  act(moderator, { type: 'admin', operation: 'cancel_auction', reason: 'Revisión preventiva.' });
  assert.deepEqual(engine.getBalance('nova'), { available: 1200, reserved: 0, total: 1200 });
  assert.equal(engine.snapshot().auction.status, 'cancelled');
  assert.equal(engine.getLedger().filter((e) => e.kind === 'consume').length, 0);
  assert.equal(engine.snapshot().generations.some((g) => g.proposalId === 'sponsor-nova'), false);
});

test('community journey: moderation, eligibility, vote, selection, generation, queue, playback, attribution and replay', () => {
  const { engine, act, advance } = setup();
  const user = engine.createDemoUser('subscriber', 'creator');
  act(user, { type: 'propose', title: 'Mi bosque de luz', prompt: 'Un bosque de árboles de cristal crece bajo una lluvia de estrellas violetas.' });
  let proposal = engine.snapshot(user.id).proposals.find((p) => p.authorId === user.id)!;
  assert.equal(proposal.status, 'pending_moderation');
  advance(2100);
  proposal = engine.snapshot(user.id).proposals.find((p) => p.id === proposal.id)!;
  assert.equal(proposal.status, 'eligible');
  act(user, { type: 'vote', proposalId: proposal.id });
  assert.equal(engine.snapshot(user.id).proposals.find((p) => p.id === proposal.id)?.votedByMe, true);
  for (let i = 0; i < 4; i++) engine.selectCommunity();
  assert.equal(engine.snapshot(user.id).proposals.find((p) => p.id === proposal.id)?.status, 'generating');
  advance(21_000);
  assert.ok(engine.snapshot(user.id).queue.some((c) => c.proposalId === proposal.id));
  let played = false;
  for (let i = 0; i < 12; i++) {
    advance(30_000);
    const snap = engine.snapshot(user.id);
    if (snap.currentClip.proposalId === proposal.id) { played = true; assert.equal(snap.currentClip.authorId, user.id); assert.equal(snap.currentClip.kind, 'community'); }
  }
  assert.equal(played, true);
  assert.equal(engine.snapshot(user.id).proposals.find((p) => p.id === proposal.id)?.status, 'played');
  assert.ok(engine.snapshot(user.id).notifications.some((n) => n.text.includes('pantalla')));
  assert.ok(engine.snapshot(user.id).history.some((clip) => clip.proposalId === proposal.id) || engine.snapshot(user.id).currentClip.proposalId === proposal.id);
});

test('sponsored journey requires human approval, wins, generates and plays as fifth turn', () => {
  const { engine, act, advertiser, advance } = setup();
  const ad = advertiser('new-ad'); const mod = engine.createDemoUser('moderator', 'reviewer');
  act(ad, { type: 'propose', prompt: 'Un objeto de cerámica original entre jardines luminosos, presentado por Estudio Nube.', title: 'Estudio Nube', kind: 'sponsored' });
  const proposal = engine.snapshot(ad.id).proposals.find((p) => p.authorId === ad.id && p.status === 'pending_moderation')!;
  advance(3000);
  assert.equal(engine.snapshot(ad.id).proposals.find((p) => p.id === proposal.id)?.status, 'pending_moderation');
  act(mod, { type: 'moderate', proposalId: proposal.id, decision: 'approve' });
  act(ad, { type: 'bid', proposalId: proposal.id, amount: 180 });
  engine.closeAuction('system', true);
  assert.equal(engine.snapshot().auction.winner?.userId, ad.id);
  const kinds = [engine.snapshot().currentClip.kind];
  for (let i = 0; i < 4; i++) { advance(30_000); kinds.push(engine.snapshot().currentClip.kind); }
  assert.deepEqual(kinds, ['community', 'community', 'community', 'community', 'sponsored']);
  assert.equal(engine.snapshot().currentClip.proposalId, proposal.id);
  assert.match(engine.snapshot().currentClip.selectionReason, /patrocinado/);
  assert.equal(engine.getBalance(ad.id).total, 1020);
});

test('selection combines votes, waiting time and author diversity', () => {
  const { engine } = setup();
  // Luna has most votes but just played; the diversity penalty allows Milo to lead.
  assert.equal(engine.selectCommunity()?.authorId, 'milo');
  assert.equal(engine.selectCommunity()?.authorId, 'luna');
  assert.equal(engine.selectCommunity()?.authorId, 'sol');
  assert.equal(engine.selectCommunity(), null);
});

test('moderation blocks unsafe text, cannot be bypassed by human approval, supports report and appeal', () => {
  const { engine, act } = setup();
  const user = engine.createDemoUser('subscriber', 'unsafe'); const mod = engine.createDemoUser('moderator', 'mod');
  assert.throws(() => act(user, { type: 'chat', text: 'te voy a matar' }), (e: unknown) => e instanceof DomainError && e.code === 'moderation_rejected');
  act(user, { type: 'propose', prompt: 'Un deepfake sin consentimiento de una persona real.' });
  const rejected = engine.snapshot(user.id).proposals.find((p) => p.authorId === user.id)!;
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.reason);
  assert.throws(() => act(mod, { type: 'moderate', proposalId: rejected.id, decision: 'approve' }));
  act(user, { type: 'appeal', proposalId: rejected.id, reason: 'Solicito una revisión del contexto de esta propuesta.' });
  act(user, { type: 'report', targetId: 'chat-1', reason: 'Solicito revisar este mensaje de la sala.' });
  assert.equal(engine.snapshot(mod.id).admin?.appeals.length, 1);
  assert.equal(engine.snapshot(mod.id).admin?.reports.length, 1);
  assert.equal(engine.snapshot(user.id).admin, null);
});

test('advertising policies and executable or external links are rejected', () => {
  for (const prompt of ['Vota por el próximo presidente', 'Visita nuestro casino de apuestas', 'Compra tabaco de nuestra marca', 'Ganancias garantizadas con nuestra inversión']) assert.equal(moderateText(prompt, 'advertisement').approved, false, prompt);
  for (const prompt of ['https://example.com', '<script>alert(1)</script>', 'gore explícito', 'Mickey Mouse en una aventura']) assert.equal(moderateText(prompt, 'proposal').approved, false, prompt);
  assert.equal(moderateText('Medusas de cristal entre nubes de color violeta.', 'proposal').approved, true);
});

test('non-moderators cannot change room, moderate, inspect ledger or adjust credits', () => {
  const { engine, act } = setup();
  const user = engine.createDemoUser('subscriber', 'member');
  for (const action of [
    { type: 'admin', operation: 'pause_room' },
    { type: 'admin', operation: 'credit_adjustment', targetId: user.id, amount: 500, reason: 'Fraude' },
    { type: 'moderate', proposalId: 'proposal-whale', decision: 'approve' },
  ] as Action[]) assert.throws(() => act(user, action), (e: unknown) => e instanceof DomainError && e.status === 403);
  assert.equal(engine.snapshot(user.id).admin, null);
  assert.equal(engine.getBalance(user.id).total, 1200);
});

test('admin adjustments append compensations; immutable prior ledger remains intact', () => {
  const { engine, act } = setup();
  const mod = engine.createDemoUser('moderator', 'mod');
  const before = engine.getLedger();
  act(mod, { type: 'admin', operation: 'credit_adjustment', targetId: 'luna', amount: 100, reason: 'Compensación de prueba' });
  act(mod, { type: 'admin', operation: 'credit_adjustment', targetId: 'luna', amount: -100, reason: 'Reversión de la compensación' });
  assert.deepEqual(engine.getLedger().slice(0, before.length), before);
  assert.equal(engine.getBalance('luna').total, 1200);
  const entries = engine.getLedger().filter((e) => e.kind === 'adjustment');
  assert.equal(entries.length, 2);
  assert.throws(() => act(mod, { type: 'admin', operation: 'credit_adjustment', targetId: 'luna', amount: -1300, reason: 'No debe permitir saldo negativo' }));
  assert.equal(engine.getBalance('luna').total, 1200);
});

test('paused room freezes authoritative playback and auction time; resume compensates elapsed time', () => {
  const { engine, act, advance } = setup();
  const mod = engine.createDemoUser('moderator', 'mod');
  const original = engine.snapshot();
  act(mod, { type: 'admin', operation: 'pause_room' });
  advance(100_000);
  assert.equal(engine.snapshot().currentClip.id, original.currentClip.id);
  assert.equal(engine.snapshot().auction.status, 'open');
  act(mod, { type: 'admin', operation: 'resume_room' });
  assert.equal(engine.snapshot().auction.endsAt, original.auction.endsAt + 100_000);
  assert.equal(engine.snapshot().currentClip.startedAt, original.currentClip.startedAt! + 100_000);
});

test('snapshots are detached and reconnect rebuilds state without exposing mutation paths', () => {
  const { engine, act } = setup();
  const user = engine.createDemoUser('subscriber', 'viewer');
  const a = engine.snapshot(user.id);
  a.auction.leader!.amount = 0; a.currentClip.title = 'tampered'; a.user!.balance.available = 999999;
  act(user, { type: 'chat', text: '¡Aquí estoy de nuevo!' });
  const b = engine.snapshot(user.id);
  assert.equal(b.auction.leader?.amount, 120);
  assert.notEqual(b.currentClip.title, 'tampered');
  assert.equal(b.user?.balance.available, 1200);
  assert.equal(b.chat.at(-1)?.text, '¡Aquí estoy de nuevo!');
});

test('strict schema rejects client identity, arbitrary role, invalid amounts and unknown actions', () => {
  const key = 'test-key-123';
  assert.throws(() => parseAction({ type: 'bid', proposalId: 'a', amount: -1, idempotencyKey: key }));
  assert.throws(() => parseAction({ type: 'bid', proposalId: 'a', amount: 1.5, idempotencyKey: key }));
  assert.throws(() => parseAction({ type: 'chat', text: 'hola', userId: 'nova', idempotencyKey: key }));
  assert.throws(() => parseAction({ type: 'grant_credit', amount: 9999, idempotencyKey: key }));
  assert.throws(() => parseAction({ type: 'chat', text: '', idempotencyKey: key }));
  assert.throws(() => parseRole({ role: 'admin' }));
  assert.deepEqual(parseAction({ type: 'chat', text: ' hola ', idempotencyKey: key }).action, { type: 'chat', text: 'hola' });
});

test('mutation origin guard rejects missing, foreign and cross-site origins', () => {
  assert.throws(() => assertSameOrigin(new Request('http://localhost:3000/api/action')));
  assert.throws(() => assertSameOrigin(new Request('http://localhost:3000/api/action', { headers: { origin: 'https://attacker.test' } })));
  assert.throws(() => assertSameOrigin(new Request('http://localhost:3000/api/action', { headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request('http://localhost:3000/api/action', { headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request('http://localhost:3000/api/action', { headers: { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000', 'sec-fetch-site': 'same-origin' } })));
  assert.throws(() => assertSameOrigin(new Request('http://localhost:3000/api/action', { headers: { origin: 'https://attacker.test', host: 'attacker.test' } })));
});

test('opaque HttpOnly session never shares the public identity and logout revokes it', () => {
  const request = new Request('https://demo.test/api/session');
  const session = beginSession(request, 'subscriber');
  assert.match(session.cookie, /HttpOnly/); assert.match(session.cookie, /SameSite=Strict/); assert.match(session.cookie, /Secure/);
  const token = session.cookie.split(';')[0].split('=')[1];
  assert.equal(session.userId.includes(token), false);
  const authenticated = new Request('https://demo.test/api/room', { headers: { cookie: session.cookie.split(';')[0] } });
  assert.equal(sessionUserId(authenticated), session.userId);
  assert.equal(sessionUserId(new Request('https://demo.test/api/room', { headers: { cookie: `talktoad_demo_session=${session.userId}` } })), null);
  assert.equal(JSON.stringify(runtime().engine.snapshot(session.userId)).includes(token), false);
  endSession(authenticated);
  assert.equal(sessionUserId(authenticated), null);
});

test('explicit production mode fails closed before any demo identity is created', () => {
  const original = process.env.APP_MODE;
  try {
    process.env.APP_MODE = 'production';
    assert.throws(requireDemoMode, (e: unknown) => e instanceof DomainError && e.status === 503);
    assert.throws(() => beginSession(new Request('https://app.test/api/session'), 'moderator'));
  } finally { if (original === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = original; }
});

test('state machine rejects jumping straight from a draft to a playable clip', () => {
  assert.throws(() => assertProposalTransition('draft', 'played'));
  assert.throws(() => assertProposalTransition('rejected', 'eligible'));
  assert.doesNotThrow(() => assertProposalTransition('pending_moderation', 'approved'));
});

test('HTTP journey uses server cookie, reconstructs state, blocks forged roles and revokes logout', async () => {
  const base = 'http://localhost:3000';
  const mutation = (path: string, body: unknown, cookie?: string) => new Request(`${base}${path}`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const guest = await getRoom(new Request(`${base}/api/room`));
  assert.equal(guest.status, 200);
  assert.equal((await guest.json()).user, null);
  const anonymousAction = await postAction(mutation('/api/action', { type: 'chat', text: 'Hola', idempotencyKey: 'http-guest' }));
  assert.equal(anonymousAction.status, 401);
  const login = await postSession(mutation('/api/session', { role: 'subscriber' }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const loggedIn = await login.json();
  assert.equal(loggedIn.snapshot.user.balance.available, 1200);
  const chat = await postAction(mutation('/api/action', { type: 'chat', text: '¡Ya puedo dirigir una escena!', idempotencyKey: 'http-chat' }, cookie));
  assert.equal(chat.status, 200);
  assert.equal((await chat.json()).snapshot.chat.at(-1).text, '¡Ya puedo dirigir una escena!');
  const reconnect = await getRoom(new Request(`${base}/api/room`, { headers: { cookie } }));
  assert.equal((await reconnect.json()).user.id, loggedIn.snapshot.user.id);
  const forged = await postAction(mutation('/api/action', { type: 'admin', operation: 'pause_room', idempotencyKey: 'http-admin' }, cookie));
  assert.equal(forged.status, 403);
  const forgedIdentity = await postAction(mutation('/api/action', { type: 'chat', text: 'Hola', userId: 'nova', idempotencyKey: 'http-forged' }, cookie));
  assert.equal(forgedIdentity.status, 400);
  const logout = await deleteSession(new Request(`${base}/api/session`, { method: 'DELETE', headers: { origin: base, cookie } }));
  assert.equal(logout.status, 200);
  const revoked = await postAction(mutation('/api/action', { type: 'chat', text: 'Hola', idempotencyKey: 'http-revoked' }, cookie));
  assert.equal(revoked.status, 401);
});

test('empty buffer switches to ambient without extending a sponsor or consuming community turns', () => {
  const { engine, advance } = setup();
  for (let i = 0; i < 20; i++) advance(30_000);
  const snapshot = engine.snapshot();
  assert.equal(snapshot.currentClip.authorId, 'system');
  assert.equal(snapshot.currentClip.kind, 'community');
  assert.match(snapshot.currentClip.selectionReason, /ambiental/);
  const total = snapshot.stats.communityTurns + snapshot.stats.sponsoredTurns;
  advance(90_000);
  const later = engine.snapshot();
  assert.equal(later.stats.communityTurns + later.stats.sponsoredTurns, total);
});

test('one controlled simulated counteroffer releases demo participant funds', () => {
  const { engine, act, advance, advertiser, ownAd } = setup();
  const user = advertiser('participant');
  act(user, { type: 'bid', proposalId: ownAd(user), amount: 150 });
  advance(30_000);
  assert.equal(engine.snapshot().auction.leader?.userId, 'nova');
  assert.deepEqual(engine.getBalance(user.id), { available: 1200, reserved: 0, total: 1200 });
  act(user, { type: 'bid', proposalId: ownAd(user), amount: 180 });
  advance(30_000);
  assert.equal(engine.snapshot().auction.leader?.userId, user.id);
});

test('continuous demo replenishes ideas and opens a fresh auction without resetting balances', () => {
  let now = 1_800_000_000_000;
  const engine = new DemoEngine(() => now, true);
  const original = engine.snapshot().auction.id;
  for (let i = 0; i < 16; i++) { now += 22_000; engine.tick(); }
  const snapshot = engine.snapshot();
  assert.notEqual(snapshot.auction.id, original);
  assert(snapshot.proposals.some(p => p.id.startsWith('demo-idea')));
  assert.equal(engine.getBalance('nova').total, 1080);
  assert.equal(engine.getLedger().filter(e => e.kind === 'consume' && e.userId === 'nova').length, 1);
});
