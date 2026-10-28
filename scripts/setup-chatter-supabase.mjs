import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const envFile = new URL("../.env.local", import.meta.url);
const prompt = createInterface({ input: stdin, output: stdout });

function setEnv(source, key, value) {
  const line = `${key}=${String(value).trim()}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
}

try {
  let env = await readFile(envFile, "utf8");
  stdout.write("\nConfiguración local de Supabase para Chatter\n");
  stdout.write("No compartas estas claves ni envíes capturas de esta ventana.\n\n");

  const publishable = (await prompt.question("1. Pega la Publishable key y presiona Enter: ")).trim();
  if (!publishable || publishable.startsWith("PEGA_AQUI")) throw new Error("La clave publicable está vacía.");

  const projectUrl = (await prompt.question("2. Pega la Project URL y presiona Enter: ")).trim();
  let parsed;
  try { parsed = new URL(projectUrl); } catch { throw new Error("La Project URL no es una dirección válida."); }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) throw new Error("La Project URL debe ser una dirección HTTPS de Supabase.");

  const secret = (await prompt.question("3. Pega la Secret key y presiona Enter: ")).trim();
  if (!secret || secret.startsWith("PEGA_AQUI")) throw new Error("La clave secreta está vacía.");

  env = setEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishable);
  env = setEnv(env, "NEXT_PUBLIC_SUPABASE_URL", parsed.origin);
  env = setEnv(env, "SUPABASE_SECRET_KEY", secret);
  await writeFile(envFile, env, { encoding: "utf8", mode: 0o600 });

  stdout.write("\n✓ La conexión de Supabase quedó guardada en .env.local.\n");
  stdout.write("✓ La clave secreta permanece únicamente en el servidor.\n");
} catch (error) {
  process.exitCode = 1;
  stdout.write(`\nNo se completó la configuración: ${error instanceof Error ? error.message : "error desconocido"}\n`);
} finally {
  prompt.close();
}
