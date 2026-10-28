import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Static regression guards. SQL integration assertions live in supabase/tests;
// this suite alone does not prove database execution, RLS, or concurrency.
const directory = join(process.cwd(), 'supabase', 'migrations');
const sql = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
  .map((name) => readFileSync(join(directory, name), 'utf8')).join('\n');

test('SQL contract: authenticated cannot call privileged money or moderation writes', () => {
  assert.match(sql, /revoke execute on all functions in schema public from public,anon,authenticated/);
  const grants = [...sql.matchAll(/grant execute on function ([^;]+) to authenticated;/g)].map((match) => match[1]);
  assert.ok(grants.every((grant) => grant === 'public.place_bid(uuid,uuid,bigint,text)'));
  assert.doesNotMatch(sql, /grant insert[^;]*public\.(?:bids|credit_ledger_entries|moderation_decisions|subscriptions)[^;]*to authenticated/);
});

test('SQL contract: ledger has append-only trigger and explicit nonnegative balances', () => {
  assert.match(sql, /before update or delete on public.credit_ledger_entries/);
  assert.match(sql, /available bigint not null default 0 check\(available >= 0\)/);
  assert.match(sql, /reserved bigint not null default 0 check\(reserved >= 0\)/);
  assert.match(sql, /idempotency_key text not null unique/);
  assert.match(sql, /from public.credit_accounts where user_id=p_user_id for update/);
});

test('SQL contract: bid identity comes from Auth, settlement locks and extensions are bounded', () => {
  assert.match(sql, /bidder uuid := auth.uid\(\)/);
  assert.match(sql, /from public.auctions where id=p_auction_id for update/);
  assert.match(sql, /least\(clock_timestamp\(\)\+interval '15 seconds',max_ends_at\)/);
  assert.match(sql, /public.consume_reserved_credits\(b.user_id,b.amount/);
  assert.match(sql, /public.release_credits\(b.user_id,b.amount/);
});

test('SQL contract: programming and output review remain mandatory', () => {
  assert.match(sql, /community_slots integer not null default 4/);
  assert.match(sql, /sponsored_slots integer not null default 1/);
  assert.match(sql, /PROGRAMMING_RATIO_GUARD/);
  assert.match(sql, /AUTHOR_CONSECUTIVE_LIMIT/);
  assert.match(sql, /HUMAN_OUTPUT_APPROVAL_REQUIRED/);
});

test('SQL contract: private Realtime state cannot be spoofed by browser ephemeral events', () => {
  assert.match(sql, /'state_changed','room:'\|\|room::text,true/);
  assert.match(sql, /realtime.topic\(\) like 'presence:room:%'/);
  assert.match(sql, /insert into storage.buckets[^;]*'generated-clips','generated-clips',false/);
});
