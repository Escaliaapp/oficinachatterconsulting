import { createHash, timingSafeEqual } from "node:crypto";
import { employeeIdSchema, type CreateJob, type EmployeeId } from "./types";
import { OPERATIONAL_AGENTS } from "./registry";

type TelegramMessage = { message_id: number; chat: { id: number }; from?: { id: number; first_name?: string }; text?: string };
export type TelegramUpdate = { update_id: number; message?: TelegramMessage };

export function secretsMatch(received: string | null, expected: string) {
  if (!received || !expected) return false;
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function parseHermesCommand(update: TelegramUpdate): { reply?: string; job?: CreateJob; chat?: string } {
  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text) return { reply: "Envíame una instrucción de texto." };
  if (text === "/ayuda" || text === "/start") return { reply: "Soy Hermes. Usa /equipo o escribe: /tarea diego Investiga 20 prospectos de clínicas en Chihuahua." };
  if (text === "/equipo") return { reply: Object.values(OPERATIONAL_AGENTS).map((agent) => `${agent.name}: ${agent.mission}`).join("\n") };
  const match = text.match(/^\/tarea\s+@?([a-záéíóú]+)\s+([\s\S]+)$/i);
  if (!match) return text.startsWith("/")
    ? { reply: "No reconozco ese comando. Usa /ayuda, /equipo o /tarea diego <objetivo>." }
    : { chat: text };
  const normalized = match[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const employee = employeeIdSchema.safeParse(normalized);
  if (!employee.success) return { reply: "No reconozco a ese empleado. Usa /equipo para ver los nombres." };
  const id = employee.data as EmployeeId;
  return { job: {
    employeeId: id,
    objective: match[2].trim(),
    source: "telegram",
    requestedBy: String(message.from?.id ?? message.chat.id),
    conversationId: String(message.chat.id),
    idempotencyKey: `telegram-${update.update_id}-${message.message_id}`,
  } };
}

export async function sendTelegram(chatId: string, text: string, token: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }), signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json() as {ok?:boolean;result?:{message_id?:number}};
  if (!response.ok || !payload.ok) throw new Error("telegram_send_failed");
  return payload.result;
}

