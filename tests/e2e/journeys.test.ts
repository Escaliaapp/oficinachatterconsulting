import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DemoEngine, type Action, type RoomSnapshot, type Role } from '../../lib/domain';
import { runtime } from '../../lib/demo-store';
import { GET as roomRoute } from '../../app/api/room/route';
import { POST as sessionRoute } from '../../app/api/session/route';
import { POST as actionRoute } from '../../app/api/action/route';

// The exact HTTP handlers are exercised with Request/Response + session cookies.
// Only time and the demo process store are replaced; no privileged test API is exposed.
function fixture() {
  let now = 1_800_000_000_000;
  const state = runtime();
  state.engine = new DemoEngine(() => now); state.sessions.clear(); state.limits.clear();
  const origin = 'http://127.0.0.1:3000';
  const request = (path: string, body?: object, cookie?: string) => new Request(`${origin}${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    async login(role: Role) {
      const response = await sessionRoute(request('/api/session', { role }));
      assert.equal(response.status, 200);
      return { cookie: response.headers.get('set-cookie')!.split(';')[0], snapshot: (await response.json()).snapshot as RoomSnapshot };
    },
    async act(cookie: string, action: Action, key = randomUUID()) {
      const response = await actionRoute(request('/api/action', { ...action, idempotencyKey: key }, cookie));
      const body = await response.json(); assert.equal(response.status, 200, body.error);
      return body.snapshot as RoomSnapshot;
    },
    async snapshot(cookie?: string) { return (await (await roomRoute(request('/api/room', undefined, cookie))).json()) as RoomSnapshot; },
    advance(ms: number) { now += ms; state.engine.tick(); },
  };
}

test('E2E comunitario: visitante → sesión → conversación/voto → moderación → generación → cola → pantalla → replay', async () => {
  const f = fixture();
  assert.equal((await f.snapshot()).user, null);
  const member = await f.login('subscriber'); const moderator = await f.login('moderator');
  await f.act(member.cookie, { type: 'chat', text: 'Imaginemos un jardín de cristal bajo la luna.' });
  await f.act(member.cookie, { type: 'react', emoji: '💜' });
  const pending = await f.act(member.cookie, { type: 'propose', title: 'Un bosque de vidrio', prompt: 'Un bosque de cristal refleja una luna de color violeta sobre un lago tranquilo.', kind: 'community' });
  const proposal = pending.proposals.find(p => p.authorId === member.snapshot.user!.id)!;
  assert.equal(proposal.status, 'pending_moderation');
  f.advance(2100);
  const approved = await f.snapshot(member.cookie);
  assert.equal(approved.proposals.find(p => p.id === proposal.id)?.status, 'eligible');
  const voted = await f.act(member.cookie, { type: 'vote', proposalId: proposal.id });
  assert.equal(voted.proposals.find(p => p.id === proposal.id)?.votes, 1);
  // Moderator advances selection through all eligible candidates, using the public admin command.
  for (let i = 0; i < 4; i++) await f.act(moderator.cookie, { type: 'admin', operation: 'select_community' });
  assert.equal((await f.snapshot(member.cookie)).proposals.find(p => p.id === proposal.id)?.status, 'generating');
  f.advance(21_000);
  assert((await f.snapshot(member.cookie)).queue.some(c => c.proposalId === proposal.id));
  let played = false;
  for (let i = 0; i < 9; i++) { f.advance(30_001); const s = await f.snapshot(member.cookie); if (s.currentClip.proposalId === proposal.id) { assert.equal(s.currentClip.authorId, member.snapshot.user!.id); assert.equal(s.currentClip.kind, 'community'); played = true; } }
  assert(played, 'the approved proposal must reach playback');
  const final = await f.snapshot(member.cookie);
  assert(final.history.some(c => c.proposalId === proposal.id));
  assert(final.notifications.some(n => n.text.includes('pantalla')));
});

test('E2E patrocinado: anuncio → revisión humana → dos postores → reservas → cierre idempotente → publicidad en pantalla', async () => {
  const f = fixture();
  const advertiser = await f.login('advertiser'); const second = await f.login('advertiser'); const moderator = await f.login('moderator');
  const draft = await f.act(advertiser.cookie, { type: 'propose', title: 'Jardín de Studio', prompt: 'Una taza artesanal original flota entre flores de cristal, presentada por Studio.', kind: 'sponsored' });
  const ad = draft.proposals.find(p => p.authorId === advertiser.snapshot.user!.id && p.status === 'pending_moderation')!;
  assert(ad, 'new advertising remains pending human review');
  await f.act(moderator.cookie, { type: 'moderate', proposalId: ad.id, decision: 'approve' });
  const firstBid = await f.act(advertiser.cookie, { type: 'bid', proposalId: ad.id, amount: 330 });
  assert.equal(firstBid.user!.balance.reserved, 330);
  const secondAd = second.snapshot.proposals.find(p => p.authorId === second.snapshot.user!.id && p.kind === 'sponsored')!;
  const secondBid = await f.act(second.cookie, { type: 'bid', proposalId: secondAd.id, amount: 350 });
  assert.equal(secondBid.user!.balance.reserved, 350);
  assert.equal((await f.snapshot(advertiser.cookie)).user!.balance.available, 1200);
  const finalBid = await f.act(advertiser.cookie, { type: 'bid', proposalId: ad.id, amount: 380 });
  assert.equal(finalBid.user!.balance.available, 820);
  const key = randomUUID();
  await f.act(moderator.cookie, { type: 'admin', operation: 'close_auction' }, key);
  await f.act(moderator.cookie, { type: 'admin', operation: 'close_auction' }, key);
  const settled = await f.snapshot(advertiser.cookie);
  assert.equal(settled.auction.status, 'settled'); assert.equal(settled.user!.balance.total, 820); assert.equal(settled.user!.balance.reserved, 0);
  assert.equal((await f.snapshot(second.cookie)).user!.balance.total, 1200);
  let played = false;
  for (let i = 0; i < 9; i++) { f.advance(30_001); const s = await f.snapshot(advertiser.cookie); if(s.currentClip.proposalId === ad.id) { assert.equal(s.currentClip.kind, 'sponsored'); assert.match(s.currentClip.selectionReason, /patrocinado/); played = true; } }
  assert(played, 'paid winner reaches a labeled sponsored slot');
  const audit = (await f.snapshot(moderator.cookie)).admin!;
  assert.equal(audit.ledger.filter(e => e.kind === 'consume' && e.userId === advertiser.snapshot.user!.id).length, 1);
});
