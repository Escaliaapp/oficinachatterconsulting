import "server-only";
import { OPERATIONAL_AGENTS } from "./registry";
import { ApiError } from "@/lib/supabase/server";

type ChatMessage = { author_type: string; body: string };
type OfficeAgent = { id: string; state: string; activity: string };

export async function answerAsHermes(input: { messages: ChatMessage[]; office: OfficeAgent[]; jobs: unknown[] }) {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const key = openRouterKey || process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const endpoint = openRouterKey ? "https://openrouter.ai/api/v1/responses" : "https://api.openai.com/v1/responses";

  const team = Object.values(OPERATIONAL_AGENTS).map(agent => ({
    id: agent.id, name: agent.name, role: agent.role, mission: agent.mission,
    tools: agent.tools.map(tool => tool.id),
  }));
  const history = input.messages.slice(-24).map(message => ({
    role: message.author_type === "hermes" ? "assistant" : "user",
    content: message.body,
  }));
  const context = JSON.stringify({ equipo: team, estado_visual_actual: input.office, trabajos_reales: input.jobs });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.HERMES_MODEL?.trim() || (openRouterKey ? "openai/gpt-5.5" : "gpt-5.5"),
      instructions: `Eres Hermes Montes, Director de Operaciones de Chatter Consulting. Hablas en español mexicano, claro, cálido y ejecutivo. El propietario conversa contigo para dirigir una agencia de agentes de IA. Conoces las funciones del equipo y el estado que aparece en la oficina. Distingue siempre entre actividad visual simulada y trabajos reales registrados. No afirmes que una API, correo, campaña, prospecto o cita fue ejecutada si no aparece en trabajos_reales. Si te piden una acción que aún no tiene herramienta conectada, explica qué falta y propone el siguiente paso. Responde normalmente en 2 a 5 párrafos breves. Contexto actual: ${context}`,
      input: history,
      max_output_tokens: 700,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new ApiError(502, "hermes_ai_failed", "Hermes no pudo generar una respuesta en este momento.");
  const data = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  const text = data.output?.flatMap(item => item.content ?? []).filter(item => item.type === "output_text").map(item => item.text ?? "").join("\n").trim();
  if (!text) throw new ApiError(502, "hermes_ai_empty", "Hermes no devolvió una respuesta.");
  return text;
}
