import { errorResponse, jsonResponse, runtime as getRuntime, sessionUserId } from '@/lib/demo-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const state = getRuntime();
    return await state.engine.mutex.run(() => {
      const userId = sessionUserId(request);
      state.engine.tick();
      return jsonResponse(state.engine.snapshot(userId));
    });
  } catch (error) { return errorResponse(error); }
}
