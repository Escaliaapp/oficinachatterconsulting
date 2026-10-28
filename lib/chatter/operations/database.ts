import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/supabase/server";

function value(key: string) {
  const found = process.env[key]?.trim();
  if (!found || found.startsWith("PEGA_AQUI") || found.startsWith("CREA_AQUI")) throw new ApiError(503, "chatter_database_unconfigured", "La base de datos de Chatter todavía no está configurada.");
  return found;
}

export function chatterDb() {
  return createClient(value("NEXT_PUBLIC_SUPABASE_URL"), value("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export function requireLocalOffice(request: Request) {
  if (process.env.APP_MODE === "production") throw new ApiError(401, "office_auth_required", "La oficina publicada requiere autenticación del propietario.");
  const url = new URL(request.url);
  const localHosts = new Set(["127.0.0.1", "localhost"]);
  if (!localHosts.has(url.hostname)) throw new ApiError(403, "local_office_only", "Este acceso sólo está disponible en la oficina local.");
  const origin = request.headers.get("origin");
  if (origin) {
    const source = new URL(origin);
    const sameLocalServer = localHosts.has(source.hostname) && source.protocol === url.protocol && source.port === url.port;
    if (!sameLocalServer) throw new ApiError(403, "invalid_origin", "Origen no permitido.");
  }
}

export async function hermesConversation(db: SupabaseClient, chatId: string) {
  const existing = await db.from("chatter_conversations").select("id").eq("channel", "telegram").eq("external_chat_id", chatId).maybeSingle();
  if (existing.error) throw new ApiError(503, "conversation_lookup_failed", `No se pudo consultar la conversación de Hermes (${existing.error.code || "provider_error"}).`);
  if (existing.data) return String(existing.data.id);
  const created = await db.from("chatter_conversations").insert({ channel: "telegram", external_chat_id: chatId }).select("id").single();
  if (created.error || !created.data) throw new ApiError(503, "conversation_create_failed", "No se pudo crear la conversación de Hermes.");
  return String(created.data.id);
}

export async function appendHermesMessage(db: SupabaseClient, message: { conversationId:string; externalMessageId?:string; authorType:"owner"|"hermes"|"system"; authorId?:string; source:"telegram"|"office"|"system"; body:string; jobId?:string }) {
  const row = { conversation_id:message.conversationId, external_message_id:message.externalMessageId ?? null, author_type:message.authorType, author_id:message.authorId ?? null, source:message.source, body:message.body.slice(0,4096), job_id:message.jobId ?? null };
  if (message.externalMessageId) {
    const existing = await db.from("chatter_messages").select("id").eq("source", message.source).eq("external_message_id", message.externalMessageId).maybeSingle();
    if (existing.error) throw new ApiError(503, "message_lookup_failed", `No se pudo comprobar el mensaje (${existing.error.code || "provider_error"}).`);
    if (existing.data) return;
  }
  const result = await db.from("chatter_messages").insert(row);
  if (result.error) throw new ApiError(503, "message_store_failed", `No se pudo guardar el mensaje (${result.error.code || "provider_error"}).`);
}

