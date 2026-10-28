import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError, apiError, json, rateLimit, requiredEnv, requireProduction, requireUser, serviceSupabase } from "../../../../../lib/supabase/server";
import { signedClipUrl } from "../../../../../lib/supabase/storage";
export const runtime = "nodejs";
export async function GET(request: Request, route: { params: Promise<{ clipId: string }> }) {
  try {
    requireProduction();
    const { clipId } = await route.params;
    if (!z.string().uuid().safeParse(clipId).success) throw new ApiError(404, "clip_missing", "No se encontró el clip.");
    const authorization = request.headers.get("authorization");
    if (authorization) {
      const context = await requireUser(request);
      rateLimit(`clip:${context.user.id}`, 120);
    }
    // Public/room visibility is evaluated through RLS, never bypassed by the service client.
    const viewer = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), { auth: { persistSession: false }, ...(authorization ? { global: { headers: { Authorization: authorization } } } : {}) });
    const { data, error } = await viewer.from("generated_clips").select("storage_path,status").eq("id", clipId).eq("status", "approved").single();
    if (error || !data) throw new ApiError(404, "clip_missing", "Este clip no está disponible para esta sesión.");
    return json(await signedClipUrl(serviceSupabase(), data.storage_path));
  } catch (error) { return apiError(error); }
}
