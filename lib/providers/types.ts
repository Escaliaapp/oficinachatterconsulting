export type VideoStage = "queued" | "generating" | "processing_output" | "ready" | "failed" | "cancelled";
export interface VideoRequest { prompt: string; seed?: number }
export interface VideoHandle { requestId: string; submittedAt: number }
export interface VideoStatus { stage: VideoStage; queuePosition?: number; latencyMs: number }
export interface VideoResult { url: string; durationSeconds: number; estimatedCostUsd: number; latencyMs: number; requiresOutputReview: boolean }
export interface VideoProvider {
  readonly name: "demo" | "fal";
  submit(input: VideoRequest): Promise<VideoHandle>;
  status(handle: VideoHandle): Promise<VideoStatus>;
  result(handle: VideoHandle): Promise<VideoResult>;
  cancel(handle: VideoHandle): Promise<{ confirmed: boolean }>;
}
export class ProviderError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message); this.name = "ProviderError"; }
}

/** Process-local breaker. Database budget + job claims remain authoritative across replicas. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  constructor(private threshold = 3, private cooldownMs = 30_000, private now = Date.now) {}
  assertAvailable() {
    if (this.openedAt !== null && this.now() - this.openedAt < this.cooldownMs) {
      throw new ProviderError("circuit_open", "El proveedor está en pausa temporal. Inténtalo después.", true);
    }
    if (this.openedAt !== null) { this.failures = 0; this.openedAt = null; }
  }
  success() { this.failures = 0; this.openedAt = null; }
  failure() { if (++this.failures >= this.threshold) this.openedAt = this.now(); }
}
