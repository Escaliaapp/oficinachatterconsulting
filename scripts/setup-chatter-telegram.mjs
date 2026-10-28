import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const envFile = new URL("../.env.local", import.meta.url);
const prompt = createInterface({ input: stdin, output: stdout });

function setEnv(source, key, value) {
  const safe = String(value).trim();
  const line = `${key}=${safe}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
}

async function telegram(method, token) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(15_000) });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram respondió ${response.status}`);
  return payload.result;
}

try {
  let env = await readFile(envFile, "utf8");
  stdout.write("\nConfiguración local de Hermes en Telegram\n\n");
  stdout.write("1. Abre @BotFather en Telegram.\n2. Envía /newbot y termina el registro.\n3. Copia el token que te entrega.\n\n");
  const token = (await prompt.question("Pega aquí el token del bot y presiona Enter: ")).trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("El token no tiene el formato esperado. Cópialo completo desde BotFather.");
  const bot = await telegram("getMe", token);
  stdout.write(`\nBot verificado: @${bot.username}\n`);
  stdout.write(`Abre https://t.me/${bot.username}, pulsa INICIAR y envíale la palabra HOLA.\n`);
  await prompt.question("Cuando ya hayas enviado HOLA, vuelve aquí y presiona Enter: ");
  const updates = await telegram("getUpdates?allowed_updates=%5B%22message%22%5D", token);
  const messages = updates.map((update) => update.message).filter((message) => message?.chat?.id && message.chat.type === "private");
  const message = messages.at(-1);
  if (!message) throw new Error("No encontré mensajes privados. Envía HOLA al bot, espera unos segundos y ejecuta de nuevo este comando.");
  env = setEnv(env, "TELEGRAM_BOT_TOKEN", token);
  env = setEnv(env, "TELEGRAM_OWNER_CHAT_ID", message.chat.id);
  env = setEnv(env, "TELEGRAM_WEBHOOK_SECRET", randomBytes(32).toString("base64url"));
  env = setEnv(env, "CHATTER_CRON_SECRET", randomBytes(32).toString("base64url"));
  await writeFile(envFile, env, { encoding: "utf8", mode: 0o600 });
  stdout.write("\n✓ Telegram quedó guardado en .env.local.\n");
  stdout.write(`✓ Chat autorizado: ${message.chat.id}\n`);
  stdout.write("✓ Los dos secretos de seguridad fueron generados automáticamente.\n");
  stdout.write("\nNo compartas el archivo .env.local ni una captura de su contenido.\n");
} catch (error) {
  process.exitCode = 1;
  stdout.write(`\nNo se completó la configuración: ${error instanceof Error ? error.message : "error desconocido"}\n`);
} finally {
  prompt.close();
}
