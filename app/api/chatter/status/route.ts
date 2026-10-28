function configured(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return Boolean(normalized && !normalized.startsWith("PEGA_AQUI") && !normalized.startsWith("CREA_AQUI"));
}

export async function GET() {
  return Response.json({
    telegram: configured(process.env.TELEGRAM_BOT_TOKEN) && configured(process.env.TELEGRAM_OWNER_CHAT_ID) && configured(process.env.TELEGRAM_WEBHOOK_SECRET),
    database: configured(process.env.NEXT_PUBLIC_SUPABASE_URL) && configured(process.env.SUPABASE_SECRET_KEY),
    ai: configured(process.env.OPENROUTER_API_KEY) || configured(process.env.OPENAI_API_KEY),
    mode: process.env.APP_MODE === "production" ? "production" : "local",
  }, { headers: { "Cache-Control": "no-store" } });
}
