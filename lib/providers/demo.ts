import { ProviderError, type VideoHandle, type VideoProvider, type VideoRequest, type VideoResult, type VideoStatus } from "./types";

/** Explicit simulation: deterministic prerecorded local media, never a paid generation. */
export class DemoVideoProvider implements VideoProvider {
  readonly name = "demo" as const;
  private cancelled = new Set<string>();
  constructor(private mediaUrl = "/media/moon-garden.mp4", private now = Date.now) {}
  async submit(input: VideoRequest): Promise<VideoHandle> {
    let hash = 2166136261;
    for (const char of input.prompt) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return { requestId: `demo-${(hash >>> 0).toString(16)}`, submittedAt: this.now() };
  }
  async status(handle: VideoHandle): Promise<VideoStatus> {
    const latencyMs = Math.max(0, this.now() - handle.submittedAt);
    return { stage: this.cancelled.has(handle.requestId) ? "cancelled" : latencyMs < 800 ? "queued" : latencyMs < 2600 ? "generating" : latencyMs < 3200 ? "processing_output" : "ready", latencyMs };
  }
  async result(handle: VideoHandle): Promise<VideoResult> {
    if ((await this.status(handle)).stage !== "ready") throw new ProviderError("not_ready", "La escena demo todavía se está preparando.");
    return { url: this.mediaUrl, durationSeconds: 5, estimatedCostUsd: 0, latencyMs: this.now() - handle.submittedAt, requiresOutputReview: false };
  }
  async cancel(handle: VideoHandle) { this.cancelled.add(handle.requestId); return { confirmed: true }; }
}
