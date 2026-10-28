import { apiError, json, requiredEnv } from "@/lib/supabase/server";
import { requireOfficeUser } from "@/lib/supabase/server";
import { hermesConversation } from "@/lib/chatter/operations/database";

export async function GET(request: Request) {
  try {
    const { db } = await requireOfficeUser(request);
    await hermesConversation(db, requiredEnv("TELEGRAM_OWNER_CHAT_ID"));
    const result = await db.from("chatter_jobs").select("id,employee_id,objective,status,result_summary,created_at").order("created_at", { ascending: false }).limit(100);
    if (result.error) throw new Error("jobs_read_failed");
    return json({ jobs: result.data ?? [] });
  } catch (error) { return apiError(error); }
}
