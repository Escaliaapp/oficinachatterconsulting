import test from "node:test";
import assert from "node:assert/strict";
import { parseHermesCommand, secretsMatch } from "../lib/chatter/operations/telegram";
import { agentFor } from "../lib/chatter/operations/registry";

test("Hermes convierte una orden de Telegram en trabajo idempotente", () => {
  const parsed = parseHermesCommand({ update_id: 44, message: { message_id: 8, chat: { id: 99 }, from: { id: 7 }, text: "/tarea @Diego Investiga veinte clínicas en Chihuahua" } });
  assert.equal(parsed.job?.employeeId, "diego");
  assert.equal(parsed.job?.source, "telegram");
  assert.equal(parsed.job?.idempotencyKey, "telegram-44-8");
});

test("Hermes rechaza empleados desconocidos y enumera el equipo", () => {
  assert.match(parseHermesCommand({ update_id: 1, message: { message_id: 1, chat: { id: 1 }, text: "/tarea mario haz algo" } }).reply ?? "", /No reconozco/);
  assert.match(parseHermesCommand({ update_id: 2, message: { message_id: 2, chat: { id: 1 }, text: "/equipo" } }).reply ?? "", /Hermes/);
});

test("Hermes envía el texto libre de Telegram a su conversación inteligente", () => {
  const parsed = parseHermesCommand({ update_id: 3, message: { message_id: 3, chat: { id: 1 }, text: "¿Qué está haciendo el equipo?" } });
  assert.equal(parsed.chat, "¿Qué está haciendo el equipo?");
  assert.equal(parsed.reply, undefined);
});

test("el secreto del webhook se compara sin exponerlo", () => {
  assert.equal(secretsMatch("correcto", "correcto"), true);
  assert.equal(secretsMatch("incorrecto", "correcto"), false);
  assert.equal(secretsMatch(null, "correcto"), false);
});

test("cada empleado declara herramientas y aprobación para escrituras externas", () => {
  assert.equal(agentFor("valentina").tools.some((tool) => tool.id === "openai-images"), true);
  assert.equal(agentFor("diego").tools.find((tool) => tool.id === "google-places")?.risk, "read");
  assert.equal(agentFor("mateo").tools.find((tool) => tool.id === "meta-ads" && tool.risk === "write")?.approval, "before_external_action");
});

test("la cadena operativa conserva delegación, entregas y acceso mínimo", () => {
  assert.equal(agentFor("hermes").reportsTo, "owner");
  assert.deepEqual(agentFor("diego").deliversTo, ["jorge", "hermes"]);
  assert.equal(agentFor("jorge").receivesFrom.includes("lucia"), true);
  assert.equal(agentFor("pablo").deliversTo.includes("hermes"), true);
  assert.equal(agentFor("carlos").communication.includes("asistente virtual"), true);
  assert.equal(agentFor("carlos").data.find((permission) => permission.resource === "leads")?.scope, "assigned");
  assert.equal(agentFor("hermes").tools.some((tool) => tool.id === "google-ads"), false);
});
