import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';

// Exercise the real route against fake services: no paid requests or CRM writes.
function runner(options: { disabled?: boolean; quota?: number; providerFailure?: boolean; saveFailure?: boolean; noClaim?: boolean } = {}) {
  const calls: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
  const db = {
    rpc: async () => { calls.push('claim'); return { data: options.noClaim ? [] : [{ id: 'job-1', objective: 'Busca inmobiliarias en Mérida' }] }; },
    from: () => ({
      select: () => ({ gte: async () => ({ count: options.quota ?? 0 }) }),
      insert: async () => { calls.push('save'); return { error: options.saveFailure ? { code: 'DB_DOWN' } : null }; },
      update: (value: Record<string, unknown>) => { updates.push(value); return { eq: async () => ({ error: null }) }; },
    }),
  };
  const dependencies: Record<string, unknown> = {
    zod: { z },
    '@/lib/supabase/server': {
      ApiError, json: (value: unknown) => Response.json(value), apiError: (error: ApiError) => Response.json({ error: error.message, code: error.code }, { status: error.status }),
      parseBody: async (request: Request, schema: z.ZodType) => schema.parse(await request.json()),
      requireOfficeUser: async () => ({ db }), serviceSupabase: () => db, verifyOrigin: () => {},
    },
    '@/lib/chatter/connectors/server': { connectorConfig: async (id: string) => ({ storageReady: true, configured: true, enabled: id === 'apollo' && !options.disabled }) },
    '@/lib/chatter/operations/apollo': { searchApolloPeople: async () => { calls.push('apollo'); if (options.providerFailure) throw new ApiError(502, 'apollo_access_denied', 'Apollo rechazó el acceso.'); return [{ id: 'person-1', firstName: 'Ana' }]; } },
    '@/lib/chatter/operations/google-places': { searchGooglePlaces: async () => { calls.push('google'); return []; } },
    '@/lib/chatter/operations/gohighlevel': { createGoHighLevelContact: async () => { calls.push('crm'); return {}; } },
    '@/lib/chatter/operations/diego-cities': { randomDiegoCity: () => 'Mérida' },
  };
  const source = readFileSync('app/api/chatter/jobs/run/route.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const routeModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, routeModule, routeModule.exports);
  return { calls, updates, run: () => routeModule.exports.POST(new Request('https://office.test/api/chatter/jobs/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'apollo' }) })) };
}

test('OFF rejects execution before claiming a job or calling a provider', async () => {
  const context = runner({ disabled: true });
  assert.equal((await context.run()).status, 409);
  assert.deepEqual(context.calls, []);
});
test('Apollo execution stores a person without calling Google or CRM', async () => {
  const context = runner();
  const result = await (await context.run()).json();
  assert.equal(result.found, 1);
  assert.deepEqual(context.calls, ['claim','apollo','save']);
  assert.equal(context.updates.at(-1)?.status, 'completed');
});
test('daily quota prevents provider calls', async () => {
  const context = runner({ quota: 10 });
  assert.equal((await context.run()).status, 200);
  assert.deepEqual(context.calls, ['claim']);
});
test('another running worker prevents duplicate provider work', async () => {
  const context = runner({ noClaim: true });
  assert.equal((await context.run()).status, 200);
  assert.deepEqual(context.calls, ['claim']);
});
test('provider failure marks task failed and returns safe diagnostic', async () => {
  const context = runner({ providerFailure: true });
  const response = await context.run();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'apollo_access_denied');
  assert.equal(context.updates.at(-1)?.status, 'failed');
});
test('storage failure cannot be reported as completed work', async () => {
  const context = runner({ saveFailure: true });
  const response = await context.run();
  assert.equal(response.status, 503);
  assert.equal(context.updates.at(-1)?.status, 'failed');
});
