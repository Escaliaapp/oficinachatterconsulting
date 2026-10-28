import type { EmployeeId, ToolPolicy } from "./types";

export type DataPermission = {
  resource: "jobs" | "schedules" | "leads" | "campaigns" | "content" | "artifacts" | "conversations" | "analytics" | "reports";
  access: "read" | "write" | "read_write";
  scope: "own" | "assigned" | "department" | "all";
};

export type OperationalAgent = {
  id: EmployeeId; name: string; role: string; department: string; reportsTo: EmployeeId | "owner";
  mission: string; communication: string; tools: ToolPolicy[]; data: DataPermission[];
  receivesFrom: EmployeeId[]; deliversTo: EmployeeId[];
};

const read = (id: string, kind: ToolPolicy["kind"] = "mcp"): ToolPolicy => ({ id, kind, risk: "read", approval: "never" });
const write = (id: string, kind: ToolPolicy["kind"] = "mcp", approval: ToolPolicy["approval"] = "before_external_action"): ToolPolicy => ({ id, kind, risk: "write", approval });
const data = (resource: DataPermission["resource"], access: DataPermission["access"], scope: DataPermission["scope"]): DataPermission => ({ resource, access, scope });

export const OPERATIONAL_AGENTS: Record<EmployeeId, OperationalAgent> = {
  hermes: {
    id: "hermes", name: "Hermes Montes", role: "Director de Operaciones", department: "Dirección", reportsTo: "owner",
    mission: "Recibir instrucciones del propietario, delegar el trabajo y comunicar avances y resultados del equipo.",
    communication: "Único interlocutor del propietario por Telegram y correo compartido; no ejecuta el trabajo especializado.",
    tools: [read("telegram-channel", "api"), read("team-status", "api"), write("job-delegation", "api", "never"), write("shared-email", "api")],
    data: [data("jobs", "read_write", "all"), data("reports", "read", "all"), data("schedules", "read_write", "all")],
    receivesFrom: ["luna", "diego", "mateo", "valentina", "ana", "lucia", "jorge", "pablo", "carlos"], deliversTo: [],
  },
  luna: {
    id: "luna", name: "Luna Serrano", role: "Recepción y coordinación", department: "Coordinación", reportsTo: "hermes",
    mission: "Coordinar juntas, calendarios, recordatorios y actividad interna del equipo.",
    communication: "Notifica a Hermes sobre juntas, bloqueos, vencimientos y coordinación del equipo.",
    tools: [read("calendar"), write("calendar"), read("team-status", "api"), write("internal-notifications", "api", "never")],
    data: [data("schedules", "read_write", "all"), data("jobs", "read", "all")], receivesFrom: [], deliversTo: ["hermes"],
  },
  diego: {
    id: "diego", name: "Diego Navarro", role: "Prospección B2B", department: "Prospección", reportsTo: "hermes",
    mission: "Encontrar, deduplicar y calificar prospectos reales antes de entregarlos al CRM.",
    communication: "Entrega lotes de prospectos con fuente, fecha, criterios y evidencia de procedencia.",
    tools: [read("google-places", "api"), read("apollo", "api"), write("lead-import", "api", "never")],
    data: [data("leads", "read_write", "own"), data("jobs", "read", "own")], receivesFrom: [], deliversTo: ["jorge", "hermes"],
  },
  mateo: {
    id: "mateo", name: "Mateo Ríos", role: "Especialista Meta Ads", department: "Marketing & Ads", reportsTo: "hermes",
    mission: "Diseñar, operar y optimizar campañas de Meta Ads dentro del presupuesto autorizado.",
    communication: "Reporta gasto, cambios, resultados y recomendaciones; publicar o modificar campañas requiere aprobación.",
    tools: [read("meta-ads"), write("meta-ads")],
    data: [data("campaigns", "read_write", "own"), data("artifacts", "read", "department")], receivesFrom: ["ana", "valentina"], deliversTo: ["pablo", "hermes"],
  },
  valentina: {
    id: "valentina", name: "Valentina Cruz", role: "Diseño y creatividad", department: "Diseño", reportsTo: "hermes",
    mission: "Convertir briefs y guiones aprobados en imágenes y piezas visuales.",
    communication: "Entrega archivos, prompts, variantes y datos de generación a Hermes y al solicitante.",
    tools: [read("brand-assets"), read("openai-images", "api"), write("openai-images", "api", "never"), read("higgsfield", "api"), write("higgsfield", "api", "never")],
    data: [data("content", "read", "assigned"), data("artifacts", "read_write", "own")], receivesFrom: ["ana"], deliversTo: ["mateo", "hermes"],
  },
  ana: {
    id: "ana", name: "Ana Beltrán", role: "Copywriting y contenido", department: "Contenido", reportsTo: "hermes",
    mission: "Crear guiones, copies, briefs creativos y mensajes comerciales basados en información aprobada.",
    communication: "Entrega guiones y briefs estructurados a Valentina y textos de campaña a Mateo.",
    tools: [read("knowledge-base"), read("openai-text", "api"), write("content-drafts", "api", "never")],
    data: [data("content", "read_write", "own"), data("campaigns", "read", "department")], receivesFrom: [], deliversTo: ["valentina", "mateo", "hermes"],
  },
  lucia: {
    id: "lucia", name: "Lucía Vega", role: "Google Ads & SEO", department: "Marketing & Ads", reportsTo: "hermes",
    mission: "Operar Google Ads y SEO, captar prospectos y entregar cada contacto nuevo al responsable del CRM.",
    communication: "Entrega a Jorge prospectos con campaña, palabra clave, consentimiento y atribución.",
    tools: [read("google-ads", "api"), write("google-ads", "api"), read("search-console", "api"), write("lead-import", "api", "never")],
    data: [data("campaigns", "read_write", "own"), data("leads", "read_write", "own")], receivesFrom: ["ana", "valentina"], deliversTo: ["jorge", "pablo", "hermes"],
  },
  jorge: {
    id: "jorge", name: "Jorge Salazar", role: "CRM y automatizaciones", department: "Automatización", reportsTo: "hermes",
    mission: "Recibir contactos nuevos, deduplicarlos, mantener el CRM y activar automatizaciones autorizadas.",
    communication: "Confirma altas, duplicados, errores de sincronización y responsables asignados.",
    tools: [read("crm"), write("crm", "mcp", "never"), read("automation", "api"), write("automation", "api")],
    data: [data("leads", "read_write", "all"), data("jobs", "read", "department")], receivesFrom: ["diego", "lucia"], deliversTo: ["carlos", "pablo", "hermes"],
  },
  pablo: {
    id: "pablo", name: "Pablo Fuentes", role: "Analítica y reportes", department: "Analítica", reportsTo: "hermes",
    mission: "Consolidar lo ocurrido durante el día y preparar reportes con métricas verificables.",
    communication: "Entrega a Hermes el cierre diario: trabajo realizado, resultados, costos, bloqueos y pendientes.",
    tools: [read("analytics", "api"), read("crm"), read("job-ledger", "api"), write("reports", "api", "never")],
    data: [data("analytics", "read", "all"), data("jobs", "read", "all"), data("reports", "read_write", "own")], receivesFrom: ["mateo", "lucia", "jorge", "carlos"], deliversTo: ["hermes"],
  },
  carlos: {
    id: "carlos", name: "Carlos Ortega", role: "Customer Success", department: "Atención a clientes", reportsTo: "hermes",
    mission: "Atender y dar seguimiento a contactos asignados mediante el agente de IA de GoHighLevel.",
    communication: "Se presenta como ‘Carlos Ortega, asistente virtual de Chatter’; registra conversación, intención, cita y escalamiento humano.",
    tools: [read("gohighlevel", "api"), write("gohighlevel", "api"), read("crm"), write("calendar")],
    data: [data("leads", "read", "assigned"), data("conversations", "read_write", "assigned"), data("schedules", "read_write", "assigned")], receivesFrom: ["jorge"], deliversTo: ["pablo", "hermes"],
  },
};

export function agentFor(id: EmployeeId) { return OPERATIONAL_AGENTS[id]; }
