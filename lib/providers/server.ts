import "server-only";
import { FalVideoProvider } from "./fal";
import { ApiError, requiredEnv, requireProduction } from "../supabase/server";

let provider: FalVideoProvider | null = null;
export function estimatedClipCost(): number {
  // Conservative standard-rate budget for 5 seconds at 768P. Override after
  // checking the current model price; fal may run temporary promotions.
  const value = Number(process.env.FAL_ESTIMATED_CLIP_USD || "0.40");
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new ApiError(503, "cost_unconfigured", "La estimación de generación necesita revisión.");
  return value;
}
export function videoProvider() {
  requireProduction();
  if (process.env.ENABLE_H3_DIRECTOR === "true") throw new ApiError(503, "director_not_enabled", "H3 Max Director necesita validación del esquema antes de activarse.");
  provider ??= new FalVideoProvider(requiredEnv("FAL_KEY"), estimatedClipCost());
  return provider;
}
