import { apiError, json, requireUser } from "../../../../lib/supabase/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { user, profile, db } = await requireUser(request);
    const roles = await db.from("user_roles").select("role").eq("user_id", user.id);
    const memberships = await db.from("room_members").select("room_id,role").eq("user_id", user.id);
    return json({ user: { id: user.id, name: profile.display_name }, roles: roles.data ?? [], rooms: memberships.data ?? [] });
  } catch (error) { return apiError(error); }
}
