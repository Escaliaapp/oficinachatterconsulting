import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = "ApiError"; }
}
export function requireProduction() {
  if (process.env.APP_MODE !== "production") throw new ApiError(409, "demo_only", "Estás en la demostración. Esta operación de servicios externos está desactivada.");
}
export function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new ApiError(503, "service_unconfigured", "Esta integración todavía no está configurada.");
  return value;
}
export function serviceSupabase(): SupabaseClient {
  requireProduction();
  return createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
export function appOrigin(): string {
  const url = new URL(requiredEnv("APP_URL"));
  if (url.username || url.password || (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))) throw new ApiError(503, "invalid_origin", "El origen de la aplicación no está configurado correctamente.");
  return url.origin;
}
export function verifyOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== appOrigin()) throw new ApiError(403, "invalid_origin", "Origen de solicitud no permitido.");
}
export async function requireUser(request: Request) {
  requireProduction();
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer [^\s]+$/.test(authorization) || authorization.length > 8192) throw new ApiError(401, "authentication_required", "Inicia sesión para continuar.");
  const db = serviceSupabase();
  const { data, error } = await db.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new ApiError(401, "invalid_session", "Tu sesión expiró. Vuelve a iniciar sesión.");
  const profileResult = await db.from("profiles").select("id,display_name,suspended_at,stripe_customer_id").eq("id", data.user.id).single();
  if (profileResult.error || !profileResult.data) throw new ApiError(403, "profile_missing", "Tu perfil aún no está disponible.");
  if (profileResult.data.suspended_at) throw new ApiError(403, "account_suspended", "Esta cuenta está suspendida.");
  return { db, user: data.user, profile: profileResult.data as { id: string; display_name: string; suspended_at: string | null; stripe_customer_id: string | null } };
}
export async function requireRoomModerator(request: Request, roomId: string) {
  const context = await requireUser(request);
  const [roles, membership] = await Promise.all([
    context.db.from("user_roles").select("role").eq("user_id", context.user.id).eq("role", "admin"),
    context.db.from("room_members").select("role").eq("user_id", context.user.id).eq("room_id", roomId).eq("role", "moderator"),
  ]);
  if (roles.error || membership.error || (!roles.data?.length && !membership.data?.length)) throw new ApiError(403, "moderator_required", "Esta acción requiere permisos de moderación para la sala.");
  return context;
}
export async function parseBody<T>(request: Request, schema: z.ZodType<T>, maxBytes = 12_000): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "json_required", "Envía contenido JSON.");
  const raw = await readLimitedText(request, maxBytes);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ApiError(400, "invalid_json", "La solicitud no contiene JSON válido."); }
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "invalid_input", "Revisa los campos enviados.");
  return result.data;
}
export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new ApiError(413, "body_too_large", "La solicitud supera el tamaño permitido.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, "body_too_large", "La solicitud supera el tamaño permitido."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
export function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) throw new ApiError(400, "idempotency_required", "Se requiere un identificador único de operación.");
  return value;
}
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export function apiError(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
  // Provider payloads, SQL details, credentials and stack traces never reach the browser.
  return json({ error: "No se pudo completar la operación. Inténtalo más tarde.", code: "operation_failed" }, 503);
}

/** Local abuse guard. Use edge/WAF rate limits too when scaling across replicas. */
const buckets = new Map<string, { count: number; until: number }>();
export function rateLimit(key: string, limit = 10, intervalMs = 60_000) {
  const now = Date.now();
  if (buckets.size > 10_000) for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id);
  const bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) { buckets.set(key, { count: 1, until: now + intervalMs }); return; }
  if (++bucket.count > limit) throw new ApiError(429, "rate_limited", "Has realizado muchas solicitudes. Espera un momento.");
}
