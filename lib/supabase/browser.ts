"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient | null = null;
export function browserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
/** Supabase performs the authentication; the server independently validates every bearer token. */
export async function signInWithEmail(email: string) {
  const db = browserSupabase();
  if (!db) throw new Error("La autenticación todavía no está configurada.");
  const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/` } });
  if (error) throw new Error("No se pudo enviar el enlace de acceso. Inténtalo después.");
}
export async function authorizedFetch(url: string, init: RequestInit = {}) {
  if (!url.startsWith("/api/") || url.startsWith("//")) throw new Error("Solo se permiten rutas API locales.");
  const db = browserSupabase();
  const session = db ? (await db.auth.getSession()).data.session : null;
  if (!session) throw new Error("Inicia sesión para continuar.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(url, { ...init, headers, credentials: "same-origin", redirect: "error" });
}
