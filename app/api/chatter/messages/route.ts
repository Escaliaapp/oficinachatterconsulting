import { z } from "zod";
import { apiError, json, parseBody, requiredEnv } from "@/lib/supabase/server";
import { appendHermesMessage, chatterDb, hermesConversation, requireLocalOffice } from "@/lib/chatter/operations/database";
import { answerAsHermes } from "@/lib/chatter/operations/hermes-ai";
import { sendTelegram } from "@/lib/chatter/operations/telegram";

const officeMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  office: z.array(z.object({ id:z.string().max(40), state:z.string().max(40), activity:z.string().max(300) })).max(20).default([]),
});

export async function GET(request: Request) {
  try {
    requireLocalOffice(request);
    const db = chatterDb();
    const conversationId = await hermesConversation(db, requiredEnv("TELEGRAM_OWNER_CHAT_ID"));
    const result = await db.from("chatter_messages").select("id,author_type,author_id,source,body,created_at,job_id").eq("conversation_id",conversationId).order("created_at",{ascending:true}).limit(200);
    if (result.error) throw new Error("messages_read_failed");
    return json({ conversationId, messages: result.data ?? [] });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    requireLocalOffice(request);
    const input = await parseBody(request,officeMessageSchema,4_000);
    const db = chatterDb();
    const conversationId = await hermesConversation(db,requiredEnv("TELEGRAM_OWNER_CHAT_ID"));
    await appendHermesMessage(db,{conversationId,authorType:"owner",authorId:"owner",source:"office",body:input.body});
    const [messagesResult,jobsResult] = await Promise.all([
      db.from("chatter_messages").select("author_type,body").eq("conversation_id",conversationId).order("created_at",{ascending:true}).limit(30),
      db.from("chatter_jobs").select("id,employee_id,objective,status,result_summary,created_at").order("created_at",{ascending:false}).limit(20),
    ]);
    if (messagesResult.error || jobsResult.error) throw new Error("hermes_context_failed");
    const reply = await answerAsHermes({messages:messagesResult.data ?? [],office:input.office,jobs:jobsResult.data ?? []});
    if (reply) await appendHermesMessage(db,{conversationId,authorType:"hermes",authorId:"hermes",source:"office",body:reply});
    let telegramSynced = false;
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const telegramChat = process.env.TELEGRAM_OWNER_CHAT_ID?.trim();
    if (telegramToken && telegramChat) {
      const ownerSent = await sendTelegram(telegramChat, `CEO desde la oficina:\n${input.body}`, telegramToken);
      await appendHermesMessage(db,{conversationId,externalMessageId:ownerSent?.message_id?String(ownerSent.message_id):undefined,authorType:"owner",authorId:"owner",source:"telegram",body:input.body});
      if (reply) {
        const hermesSent = await sendTelegram(telegramChat, reply, telegramToken);
        await appendHermesMessage(db,{conversationId,externalMessageId:hermesSent?.message_id?String(hermesSent.message_id):undefined,authorType:"hermes",authorId:"hermes",source:"telegram",body:reply});
      }
      telegramSynced = true;
    }
    return json({ok:true,reply,telegramSynced,aiConfigured:Boolean(process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim())},201);
  } catch (error) { return apiError(error); }
}
