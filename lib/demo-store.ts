import { randomBytes, randomUUID } from 'node:crypto';
import { DemoEngine, DomainError, type Action, type Role } from './domain';

const COOKIE = 'talktoad_demo_session';
const SESSION_MS = 24 * 60 * 60 * 1000;
type Session = { userId: string; expiresAt: number };
type DemoRuntime = {
  engine: DemoEngine;
  sessions: Map<string, Session>;
  limits: Map<string, { count: number; resetAt: number }>;
};

const runtimeGlobal = globalThis as typeof globalThis & { __talktoadDemoRuntime?: DemoRuntime };

export function requireDemoMode(): void {
  if (process.env.APP_MODE && process.env.APP_MODE !== 'demo') throw new DomainError('production_not_configured', 'La demo está desactivada en producción. Configura la autenticación y los adaptadores persistentes antes de abrir la sala.', 503);
}

export function runtime(): DemoRuntime {
  requireDemoMode();
  runtimeGlobal.__talktoadDemoRuntime ??= { engine: new DemoEngine(Date.now, true), sessions: new Map(), limits: new Map() };
  return runtimeGlobal.__talktoadDemoRuntime;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  let expected: string;
  try { expected = new URL(request.url).origin; } catch { throw new DomainError('invalid_origin', 'Origen de solicitud inválido.', 403); }
  // Next normalizes its internal URL to localhost even when the browser uses 127.0.0.1.
  // Permit only an exact Host match between loopback aliases on the same port/protocol.
  let localAlias = false;
  if (origin) {
    try {
      const incoming = new URL(origin); const internal = new URL(expected);
      const loopback = ['localhost', '127.0.0.1', '[::1]'];
      localAlias = loopback.includes(incoming.hostname) && loopback.includes(internal.hostname)
        && incoming.host === request.headers.get('host') && incoming.port === internal.port && incoming.protocol === internal.protocol;
    } catch { /* Invalid origins fail closed below. */ }
  }
  if (!origin || (origin !== expected && !localAlias)) throw new DomainError('invalid_origin', 'Esta acción debe enviarse desde la misma aplicación.', 403);
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new DomainError('invalid_origin', 'Las solicitudes entre sitios no están permitidas.', 403);
}

export function rateLimit(key: string, max: number, durationMs = 60_000): void {
  const state = runtime();
  const now = Date.now();
  const existing = state.limits.get(key);
  if (!existing || existing.resetAt <= now) state.limits.set(key, { count: 1, resetAt: now + durationMs });
  else {
    if (existing.count >= max) throw new DomainError('rate_limited', 'Has participado muy rápido. Espera un momento y vuelve a intentarlo.', 429);
    existing.count++;
  }
  if (state.limits.size > 5000) for (const [id, limit] of state.limits) if (limit.resetAt <= now) state.limits.delete(id);
}

function cookieToken(request: Request): string | null {
  const value = request.headers.get('cookie')?.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function sessionUserId(request: Request): string | null {
  const state = runtime();
  const token = cookieToken(request);
  if (!token) return null;
  const session = state.sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { state.sessions.delete(token); return null; }
  const user = state.engine.getUser(session.userId);
  if (!user || user.suspended) return null;
  return session.userId;
}

export function requireSession(request: Request): string {
  const userId = sessionUserId(request);
  if (!userId) throw new DomainError('unauthenticated', 'Inicia sesión para participar.', 401);
  return userId;
}

export function beginSession(request: Request, role: Role): { userId: string; cookie: string } {
  const state = runtime();
  const existingUser = sessionUserId(request);
  if (existingUser && state.engine.getUser(existingUser)?.role === role) {
    const token = cookieToken(request)!;
    state.sessions.set(token, { userId: existingUser, expiresAt: Date.now() + SESSION_MS });
    return { userId: existingUser, cookie: sessionCookie(token, request) };
  }
  // Session bearer token and public user ID must never share any material.
  const token = randomBytes(32).toString('hex');
  const user = state.engine.createDemoUser(role, randomUUID());
  const previousToken = cookieToken(request);
  if (previousToken) state.sessions.delete(previousToken);
  state.sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_MS });
  return { userId: user.id, cookie: sessionCookie(token, request) };
}

function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure}`;
}

export function endSession(request: Request): string {
  const token = cookieToken(request);
  if (token) runtime().sessions.delete(token);
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new DomainError('invalid_content_type', 'Envía la solicitud como JSON.', 415);
  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > 16_384) throw new DomainError('body_too_large', 'La solicitud es demasiado grande.', 413);
  const chunks: Uint8Array[] = [];
  const reader = request.body?.getReader();
  let total = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 16_384) { await reader.cancel(); throw new DomainError('body_too_large', 'La solicitud es demasiado grande.', 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new DomainError('invalid_json', 'La solicitud no contiene JSON válido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('invalid_body', 'La solicitud debe contener un objeto.');
  return value as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, key: string, min: number, max: number, optional = false): string | undefined {
  const value = input[key];
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string') throw new DomainError('invalid_field', `El campo ${key} debe ser texto.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) throw new DomainError('invalid_field', `El campo ${key} debe tener entre ${min} y ${max} caracteres válidos.`);
  return trimmed;
}

function allowedFields(input: Record<string, unknown>, fields: readonly string[]): void {
  for (const key of Object.keys(input)) if (!fields.includes(key)) throw new DomainError('unknown_field', `El campo ${key} no está permitido.`);
}

export function parseRole(input: Record<string, unknown>): Role {
  allowedFields(input, ['role']);
  if (!['subscriber', 'advertiser', 'moderator'].includes(String(input.role))) throw new DomainError('invalid_role', 'Elige un perfil de la demo.');
  return input.role as Role;
}

export function parseAction(input: Record<string, unknown>): { action: Action; idempotencyKey: string } {
  const type = stringField(input, 'type', 1, 30)!;
  const idempotencyKey = stringField(input, 'idempotencyKey', 8, 128)!;
  if (!/^[\w:.-]+$/.test(idempotencyKey)) throw new DomainError('invalid_idempotency_key', 'La clave de idempotencia tiene un formato inválido.');
  const fields = (extra: string[]) => allowedFields(input, ['type', 'idempotencyKey', ...extra]);
  let action: Action;
  switch (type) {
    case 'chat': fields(['text']); action = { type, text: stringField(input, 'text', 1, 500)! }; break;
    case 'react': fields(['emoji']); action = { type, emoji: stringField(input, 'emoji', 1, 10)! }; break;
    case 'vote': fields(['proposalId']); action = { type, proposalId: stringField(input, 'proposalId', 1, 150)! }; break;
    case 'propose': {
      fields(['prompt', 'kind', 'title']);
      if (input.kind !== undefined && input.kind !== 'community' && input.kind !== 'sponsored') throw new DomainError('invalid_kind', 'El tipo de propuesta no es válido.');
      const title = stringField(input, 'title', 3, 100, true);
      action = { type, prompt: stringField(input, 'prompt', 12, 1200)!, ...(input.kind ? { kind: input.kind as 'community' | 'sponsored' } : {}), ...(title ? { title } : {}) }; break;
    }
    case 'bid':
      fields(['proposalId', 'amount']);
      if (typeof input.amount !== 'number' || !Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > 100_000) throw new DomainError('invalid_amount', 'La oferta debe ser un número entero de créditos.');
      action = { type, proposalId: stringField(input, 'proposalId', 1, 150)!, amount: input.amount }; break;
    case 'report': fields(['targetId', 'reason']); action = { type, targetId: stringField(input, 'targetId', 1, 150)!, reason: stringField(input, 'reason', 8, 1000)! }; break;
    case 'appeal': fields(['proposalId', 'reason']); action = { type, proposalId: stringField(input, 'proposalId', 1, 150)!, reason: stringField(input, 'reason', 8, 1000)! }; break;
    case 'moderate': {
      fields(['proposalId', 'decision', 'reason']);
      if (input.decision !== 'approve' && input.decision !== 'reject') throw new DomainError('invalid_decision', 'La decisión debe ser aprobar o rechazar.');
      const reason = stringField(input, 'reason', 3, 1000, true);
      action = { type, proposalId: stringField(input, 'proposalId', 1, 150)!, decision: input.decision, ...(reason ? { reason } : {}) }; break;
    }
    case 'admin': {
      fields(['operation', 'targetId', 'amount', 'reason']);
      const operations = ['pause_room', 'resume_room', 'close_auction', 'cancel_auction', 'new_auction', 'select_community', 'suspend_user', 'remove_clip', 'credit_adjustment', 'resolve_report', 'resolve_appeal'];
      if (!operations.includes(String(input.operation))) throw new DomainError('invalid_operation', 'Operación administrativa desconocida.');
      if (input.amount !== undefined && (typeof input.amount !== 'number' || !Number.isSafeInteger(input.amount))) throw new DomainError('invalid_amount', 'El ajuste debe ser un entero.');
      const targetId = stringField(input, 'targetId', 1, 150, true); const reason = stringField(input, 'reason', 3, 1000, true);
      action = { type, operation: input.operation as Extract<Action, { type: 'admin' }>['operation'], ...(targetId ? { targetId } : {}), ...(input.amount !== undefined ? { amount: input.amount as number } : {}), ...(reason ? { reason } : {}) }; break;
    }
    default: throw new DomainError('invalid_action', 'Acción desconocida.');
  }
  return { action, idempotencyKey };
}

export function jsonResponse(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', ...extraHeaders } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof DomainError) return jsonResponse({ error: error.message, code: error.code }, error.status, error.status === 429 ? { 'Retry-After': '60' } : undefined);
  // Never send stack traces, provider payloads or credentials to the browser.
  console.error('[demo-api] Unexpected error:', error instanceof Error ? error.name : 'unknown');
  return jsonResponse({ error: 'No pudimos completar la acción. Vuelve a intentarlo.', code: 'internal_error' }, 500);
}
