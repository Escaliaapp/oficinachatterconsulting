import { assertSameOrigin, errorResponse, jsonResponse, parseAction, rateLimit, readJson, requireSession, runtime as getRuntime } from '@/lib/demo-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const state = getRuntime();
    assertSameOrigin(request);
    const userId = requireSession(request);
    rateLimit(`actions:${userId}`, 80);
    const { action, idempotencyKey } = parseAction(await readJson(request));
    if (action.type === 'propose') rateLimit(`proposals:${userId}`, 6);
    if (action.type === 'chat') rateLimit(`chat:${userId}`, 20);
    return await state.engine.mutex.run(() => {
      state.engine.tick();
      const result = state.engine.execute(userId, action, idempotencyKey);
      return jsonResponse({ ok: true, ...result, snapshot: state.engine.snapshot(userId) });
    });
  } catch (error) { return errorResponse(error); }
}
