import { assertSameOrigin, beginSession, endSession, errorResponse, jsonResponse, parseRole, rateLimit, readJson, runtime as getRuntime } from '@/lib/demo-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const state = getRuntime();
    assertSameOrigin(request);
    // This process-wide cap also bounds unauthenticated session creation without trusting proxy headers.
    rateLimit('session-create-global', 120);
    const role = parseRole(await readJson(request));
    return await state.engine.mutex.run(() => {
      const session = beginSession(request, role);
      state.engine.tick();
      return jsonResponse({ ok: true, snapshot: state.engine.snapshot(session.userId) }, 200, { 'Set-Cookie': session.cookie });
    });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const state = getRuntime();
    assertSameOrigin(request);
    return await state.engine.mutex.run(() => jsonResponse({ ok: true, snapshot: state.engine.snapshot() }, 200, { 'Set-Cookie': endSession(request) }));
  } catch (error) { return errorResponse(error); }
}
