import { CircuitBreaker, ProviderError, type VideoHandle, type VideoProvider, type VideoRequest, type VideoResult, type VideoStatus } from "./types";

export const FAL_MODEL = "minimax/h3-max/text-to-video";
export const FAL_DURATION_SECONDS = 5;
export const FAL_RESOLUTION = "768P" as const;
// Queue lifecycle URLs use only the owner and app, without the endpoint path.
const QUEUE_ROOT = "https://queue.fal.run/minimax/h3-max";
const REQUEST_ID = /^[a-zA-Z0-9_-]{1,160}$/;
export function falInput(input: VideoRequest) {
  if (!input.prompt.trim() || input.prompt.length > 1800) throw new ProviderError("invalid_prompt", "La propuesta debe tener entre 1 y 1800 caracteres.");
  return { prompt: input.prompt.trim(), duration: FAL_DURATION_SECONDS, resolution: FAL_RESOLUTION, aspect_ratio: "16:9", prompt_expansion_mode: "disabled", enable_safety_checker: true, ...(Number.isSafeInteger(input.seed) ? { seed: input.seed } : {}) };
}
export function isTrustedFalMedia(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media")); } catch { return false; }
}
export class FalVideoProvider implements VideoProvider {
  readonly name = "fal" as const;
  constructor(
    private key: string,
    private estimatedCostUsd = 0.40,
    private fetcher: typeof fetch = fetch,
    private breaker = new CircuitBreaker(),
    private now = Date.now,
    private pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) { if (!key) throw new ProviderError("unconfigured", "Falta la configuración del proveedor."); }

  private async request(path: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> {
    this.breaker.assertAvailable();
    // A timed-out POST may already have been accepted. Never automatically submit it twice.
    const attempts = method === "GET" ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetcher(path, {
          method, headers: { Authorization: `Key ${this.key}`, "Content-Type": "application/json", "X-Fal-Request-Start-Timeout": "60", "X-Fal-No-Retry": "1" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000), cache: "no-store", redirect: "error",
        });
        if (!response.ok) {
          const transient = response.status === 429 || response.status >= 500;
          if (transient && attempt + 1 < attempts) { await this.pause(300 * 2 ** attempt); continue; }
          throw new ProviderError(response.status === 422 ? "provider_rejected" : "provider_unavailable", response.status === 422 ? "El proveedor rechazó la propuesta o sus parámetros." : "El proveedor no pudo completar la operación.", transient && method === "GET");
        }
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new ProviderError("invalid_response", "El proveedor devolvió una respuesta no válida.");
        this.breaker.success();
        return result as Record<string, unknown>;
      } catch (error) {
        if (!(error instanceof ProviderError) && method === "GET" && attempt + 1 < attempts) { await this.pause(300 * 2 ** attempt); continue; }
        this.breaker.failure();
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(method === "POST" ? "submission_unknown" : "provider_timeout", method === "POST" ? "No se pudo confirmar el envío. Revisión manual necesaria antes de repetirlo." : "El proveedor tardó demasiado en responder.", method === "GET");
      }
    }
    throw new ProviderError("provider_unavailable", "El proveedor no está disponible.");
  }
  private url(handle: VideoHandle, suffix = "") {
    if (!REQUEST_ID.test(handle.requestId)) throw new ProviderError("invalid_request_id", "Identificador de generación no válido.");
    return `${QUEUE_ROOT}/requests/${handle.requestId}${suffix}`;
  }
  async submit(input: VideoRequest): Promise<VideoHandle> {
    const response = await this.request(`https://queue.fal.run/${FAL_MODEL}`, "POST", falInput(input));
    if (typeof response.request_id !== "string" || !REQUEST_ID.test(response.request_id)) throw new ProviderError("submission_unknown", "El envío necesita revisión antes de repetirlo.");
    return { requestId: response.request_id, submittedAt: this.now() };
  }
  async status(handle: VideoHandle): Promise<VideoStatus> {
    const response = await this.request(this.url(handle, "/status"));
    if (response.error) throw new ProviderError("generation_failed", "La generación terminó con un error del proveedor.");
    const stage = response.status === "IN_QUEUE" ? "queued" : response.status === "IN_PROGRESS" ? "generating" : response.status === "COMPLETED" ? "processing_output" : null;
    if (!stage) throw new ProviderError("invalid_response", "Estado de generación no reconocido.");
    return { stage, latencyMs: Math.max(0, this.now() - handle.submittedAt), ...(typeof response.queue_position === "number" ? { queuePosition: response.queue_position } : {}) };
  }
  async result(handle: VideoHandle): Promise<VideoResult> {
    const response = await this.request(this.url(handle));
    const video = response.video as { url?: unknown; content_type?: unknown } | undefined;
    if (!video || typeof video.url !== "string" || !isTrustedFalMedia(video.url) || (video.content_type && video.content_type !== "video/mp4")) throw new ProviderError("invalid_output", "El proveedor no entregó un video válido.");
    // Safety checker is always enabled; a human still reviews the actual audiovisual output.
    return { url: video.url, durationSeconds: FAL_DURATION_SECONDS, estimatedCostUsd: this.estimatedCostUsd, latencyMs: Math.max(0, this.now() - handle.submittedAt), requiresOutputReview: true };
  }
  async cancel(handle: VideoHandle) {
    const response = await this.request(this.url(handle, "/cancel"), "PUT");
    return { confirmed: response.status === "OK" };
  }
}
