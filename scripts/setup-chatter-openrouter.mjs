import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const envFile = new URL("../.env.local", import.meta.url);
const prompt = createInterface({ input: stdin, output: stdout });
const setEnv = (source, key, value) => {
  const line = `${key}=${String(value).trim()}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
};

try {
  let env = await readFile(envFile, "utf8");
  stdout.write("\nConexión del cerebro de Hermes con OpenRouter\n");
  stdout.write("No compartas la clave ni envíes capturas de esta ventana.\n\n");
  const key = (await prompt.question("Pega tu OpenRouter API key y presiona Enter: ")).trim();
  if (!key.startsWith("sk-or-")) throw new Error("La clave no parece una OpenRouter API key válida.");
  env = setEnv(env, "OPENROUTER_API_KEY", key);
  env = setEnv(env, "HERMES_MODEL", "openai/gpt-5.5");
  await writeFile(envFile, env, { encoding: "utf8", mode: 0o600 });
  stdout.write("\n✓ OpenRouter quedó conectado al cerebro de Hermes.\n");
  stdout.write("✓ La clave permanece únicamente en el servidor.\n");
} catch (error) {
  process.exitCode = 1;
  stdout.write(`\nNo se completó la configuración: ${error instanceof Error ? error.message : "error desconocido"}\n`);
} finally { prompt.close(); }
