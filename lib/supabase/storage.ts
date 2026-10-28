import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTrustedFalMedia } from "../providers/fal";
import { ApiError } from "./server";
export const CLIP_BUCKET = "generated-clips";
export function outputPath(roomId: string, jobId: string) { return `${roomId}/${jobId}/output.mp4`; }
export async function savePrivateClip(db: SupabaseClient, url: string, path: string) {
  if (!isTrustedFalMedia(url)) throw new ApiError(502, "invalid_media_source", "Origen de video no permitido.");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("video/mp4")) throw new ApiError(502, "invalid_video", "No se pudo verificar el archivo de video.");
  const maxBytes = 50 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maxBytes) throw new ApiError(413, "video_too_large", "El video excede el límite permitido.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, "video_too_large", "El video excede el límite permitido."); }
    chunks.push(value);
  }
  if (size < 12) throw new ApiError(502, "invalid_video", "El archivo de video está vacío.");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") throw new ApiError(502, "invalid_video", "La firma del archivo no corresponde a un MP4.");
  const { error } = await db.storage.from(CLIP_BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: false, cacheControl: "3600" });
  // A concurrent poll can have stored the exact deterministic job path first.
  if (error && !("statusCode" in error && String(error.statusCode) === "409")) throw new ApiError(503, "storage_failed", "No se pudo guardar el video privado.");
}
export async function signedClipUrl(db: SupabaseClient, path: string) {
  const { data, error } = await db.storage.from(CLIP_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new ApiError(503, "signed_url_failed", "No se pudo preparar la reproducción.");
  return { url: data.signedUrl, expiresAt: Date.now() + 300_000 };
}
