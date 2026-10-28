import { readFile } from "node:fs/promises";

const envText = await readFile(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  return match ? [[match[1], match[2].trim()]] : [];
}));
const url = (process.argv[2] || "https://oficinachatterconsulting.vercel.app").replace(/\/$/, "");
const token = env.TELEGRAM_BOT_TOKEN;
const secret = env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !secret) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_WEBHOOK_SECRET en .env.local");
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: `${url}/api/chatter/telegram`, secret_token: secret, allowed_updates: ["message"] }),
});
const data = await response.json();
if (!response.ok || !data.ok) throw new Error("Telegram rechazó el webhook");
console.log("✓ Telegram quedó conectado a Hermes en la oficina publicada.");
