export type ContentSurface = "chat" | "proposal" | "advertisement" | "link" | "image" | "video";
export interface ModerationVerdict { approved: boolean; requiresHuman: boolean; reason: string; provider: "policy" | "openai" }

/** Defense in depth only: lexical rules are not a complete semantic classifier. */
export function moderatePolicy(text: string, surface: ContentSurface): ModerationVerdict {
  const normalized = text.normalize("NFKD").replace(/[\u0300-\u036f\u200b-\u200f\uFEFF]/g, "").toLowerCase();
  if (!text.trim() || text.length > (surface === "chat" ? 400 : 1800)) return { approved: false, requiresHuman: false, reason: "El texto está vacío o supera el límite permitido.", provider: "policy" };
  const blocked = /\b(porn(?:ografia|ography)?|violaci[oó]n|rape|csam|child porn|gore|decapita\w*|nazi|terroris\w*|deepfake|suplant\w*|phishing|fraude|fraud|casino|apuesta\w*|gambling|cocaina|fentanilo|nudes|desnud\w*|matar\w*|kill\s+(all|them)|robar\s+(cuentas|tarjetas)|bomba\s+casera)\b/i;
  if (blocked.test(normalized)) return { approved: false, requiresHuman: false, reason: "Esta propuesta no cumple las políticas de seguridad. Puedes editarla o apelar.", provider: "policy" };
  if (/https?:\/\/|www\.|javascript:|data:|<\s*script/i.test(normalized)) return { approved: false, requiresHuman: true, reason: "Los enlaces y destinos externos requieren revisión antes de publicarse.", provider: "policy" };
  if (surface === "advertisement" && /\b(politic\w*|electoral|vota por|tabaco|vape\w*|alcohol|arma\w*|medicamento\w*|inversion\w*|rendimiento garantizado)\b/.test(normalized)) return { approved: false, requiresHuman: false, reason: "Esta categoría publicitaria no está permitida.", provider: "policy" };
  return { approved: true, requiresHuman: surface === "advertisement" || surface === "image" || surface === "video", reason: "Validación estructural superada; aplicar revisión correspondiente a la superficie.", provider: "policy" };
}

export async function moderateText(text: string, surface: ContentSurface, key?: string, fetcher: typeof fetch = fetch): Promise<ModerationVerdict> {
  const local = moderatePolicy(text, surface);
  if (!local.approved) return local;
  if (!key) return { ...local, approved: false, requiresHuman: true, reason: "La moderación automática no está configurada; se requiere revisión humana." };
  try {
    const response = await fetcher("https://api.openai.com/v1/moderations", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "omni-moderation-latest", input: text }), signal: AbortSignal.timeout(12_000), redirect: "error" });
    if (!response.ok) throw new Error("moderation_unavailable");
    const data = await response.json() as { results?: { flagged?: boolean }[] };
    if (data.results?.length !== 1 || typeof data.results[0].flagged !== "boolean") throw new Error("moderation_invalid");
    return { approved: !data.results[0].flagged, requiresHuman: local.requiresHuman, reason: data.results[0].flagged ? "El contenido no superó la moderación. Puedes editarlo o apelar." : "Texto revisado automáticamente.", provider: "openai" };
  } catch {
    return { approved: false, requiresHuman: true, reason: "La moderación no está disponible. El contenido queda retenido para revisión.", provider: "openai" };
  }
}
