import { apiError, ApiError, parseBody, requiredEnv, serviceSupabase } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/chatter/operations/jobs";
import { agentFor } from "@/lib/chatter/operations/registry";
import { parseHermesCommand, secretsMatch, sendTelegram, type TelegramUpdate } from "@/lib/chatter/operations/telegram";
import { appendHermesMessage, hermesConversation } from "@/lib/chatter/operations/database";
import { answerAsHermes } from "@/lib/chatter/operations/hermes-ai";
import { z } from "zod";

const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    message_id: z.number().int(), chat: z.object({ id: z.number().int() }),
    from: z.object({ id: z.number().int(), first_name: z.string().optional() }).optional(),
    text: z.string().max(4_096).optional(),
  }).optional(),
});

export async function POST(request: Request) {
  try {
    const secret = requiredEnv("TELEGRAM_WEBHOOK_SECRET");
    if (!secretsMatch(request.headers.get("x-telegram-bot-api-secret-token"), secret)) throw new ApiError(401, "invalid_webhook", "Webhook no autorizado.");
    const update = await parseBody<TelegramUpdate>(request, telegramUpdateSchema, 64_000);
    const message = update.message;
    const allowedChat = requiredEnv("TELEGRAM_OWNER_CHAT_ID");
    if (!message || String(message.chat.id) !== allowedChat) throw new ApiError(403, "chat_not_allowed", "Chat no autorizado.");
    const db = serviceSupabase();
    const conversationId = await hermesConversation(db, allowedChat);
    if (message.text) await appendHermesMessage(db,{conversationId,externalMessageId:String(message.message_id),authorType:"owner",authorId:String(message.from?.id??message.chat.id),source:"telegram",body:message.text});
    const parsed = parseHermesCommand(update);
    const token = requiredEnv("TELEGRAM_BOT_TOKEN");
    if (message.text?.trim().toLowerCase() === "/ejecutar diego") {
      const run = await fetch(`${requiredEnv("APP_URL")}/api/chatter/jobs/run`, { method: "POST", headers: { Authorization: `Bearer ${requiredEnv("CHATTER_CRON_SECRET")}` }, cache: "no-store" });
      const result = await run.json() as { message?: string; found?: number; sentToGoHighLevel?: number };
      const reply = result.found === undefined ? (result.message ?? "No se pudo ejecutar la tarea.") : `✅ Diego terminó la tarea. Encontró ${result.found} prospectos y envió ${result.sentToGoHighLevel ?? 0} a GoHighLevel.`;
      const sent = await sendTelegram(allowedChat, reply, token);
      await appendHermesMessage(db,{conversationId,externalMessageId:sent?.message_id?String(sent.message_id):undefined,authorType:"hermes",authorId:"hermes",source:"telegram",body:reply});
      return Response.json({ ok: true });
    }
    if (parsed.reply) {
      const sent = await sendTelegram(allowedChat, parsed.reply, token);
      await appendHermesMessage(db,{conversationId,externalMessageId:sent?.message_id?String(sent.message_id):undefined,authorType:"hermes",authorId:"hermes",source:"telegram",body:parsed.reply});
    }
    if (parsed.job) {
      const job = await enqueueJob(db, parsed.job);
      const agent = agentFor(parsed.job.employeeId);
      const reply=`✅ Hermes asignó el trabajo a ${agent.name}.\n\n${job.objective}\n\nEstado: en cola · ID: ${job.id}`;
      const sent=await sendTelegram(allowedChat,reply,token);
      await appendHermesMessage(db,{conversationId,externalMessageId:sent?.message_id?String(sent.message_id):undefined,authorType:"hermes",authorId:"hermes",source:"telegram",body:reply,jobId:String(job.id)});
    }
    if (parsed.chat) {
      const [messagesResult,jobsResult] = await Promise.all([
        db.from("chatter_messages").select("author_type,body").eq("conversation_id",conversationId).order("created_at",{ascending:true}).limit(30),
        db.from("chatter_jobs").select("id,employee_id,objective,status,result_summary,created_at").order("created_at",{ascending:false}).limit(20),
      ]);
      if (messagesResult.error || jobsResult.error) throw new Error("hermes_context_failed");
      const reply = await answerAsHermes({messages:messagesResult.data ?? [],office:[],jobs:jobsResult.data ?? []});
      if (!reply) throw new ApiError(503,"hermes_ai_unconfigured","El cerebro de Hermes todavía no está configurado.");
      const sent = await sendTelegram(allowedChat,reply,token);
      await appendHermesMessage(db,{conversationId,externalMessageId:sent?.message_id?String(sent.message_id):undefined,authorType:"hermes",authorId:"hermes",source:"telegram",body:reply});
    }
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}

