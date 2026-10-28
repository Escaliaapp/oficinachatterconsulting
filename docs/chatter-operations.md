# Chatter Operations

La Fase 2 usa a Hermes como única puerta de entrada por Telegram. Hermes no comparte credenciales con los empleados: crea un trabajo persistente, lo asigna y el ejecutor concede únicamente las herramientas declaradas para ese empleado.

## Flujo operativo

1. Telegram entrega la orden al webhook con un secreto y un `chat_id` permitido.
2. Hermes crea un trabajo idempotente en `chatter_jobs` y confirma el identificador por Telegram.
3. Un worker duradero reclama el trabajo, registra cada llamada en `chatter_job_events` y ejecuta APIs o MCPs bajo la política del empleado.
4. Las acciones externas o irreversibles cambian el trabajo a `waiting_approval`; Hermes solicita aprobación antes de continuar.
5. Los resultados se guardan en almacenamiento privado y se registran en `chatter_artifacts`.
6. Al terminar, el notificador envía un correo desde el buzón compartido. El remitente visible sigue siendo el buzón verificado; el asunto y la firma identifican al empleado, por ejemplo: `[Valentina · Chatter] Imagen terminada`.
7. Telegram recibe un resumen y, cuando el tamaño lo permite, el archivo; el correo adjunta el archivo o incluye un enlace privado con vencimiento.

Los cron jobs crean trabajos mediante el mismo contrato. No ejecutan herramientas directamente y por eso conservan idempotencia, límites, auditoría y aprobaciones.

## Configuración preparada

- `TELEGRAM_BOT_TOKEN`: token creado en BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: valor aleatorio que Telegram enviará en el encabezado del webhook.
- `TELEGRAM_OWNER_CHAT_ID`: único chat autorizado para dirigir a Hermes.
- `CHATTER_CRON_SECRET`: autentica al invocador de trabajos programados.
- `CHATTER_SHARED_EMAIL`: buzón compartido que aparecerá como remitente.
- `EMAIL_PROVIDER_API_KEY`: credencial del proveedor de correo, únicamente en el servidor.
- Supabase: aplica `202610270002_chatter_operations.sql` para trabajos, eventos, calendarios y archivos.

El webhook disponible es `POST /api/chatter/telegram`. Ejemplos de conversación:

```text
/equipo
/tarea diego Investiga 20 prospectos de clínicas en Chihuahua
/tarea valentina Crea una imagen 1:1 para la campaña de noviembre
```

## Lo que falta conectar

Esta base recibe y persiste órdenes reales, pero no incluye credenciales ni simula que una integración está activa. Para operar en producción todavía deben configurarse el bot y su webhook HTTPS, Supabase, el proveedor del buzón, el almacenamiento privado, el runtime duradero del worker y cada conexión API/MCP. Las primeras conexiones recomendadas son CRM, correo, calendario, búsqueda y generación de imágenes.

Cada conector debe declarar esquema de entrada, permisos, límites de costo, política de aprobación, tiempo máximo, reintentos seguros y clave de idempotencia. Nunca se permite que un empleado amplíe sus propios permisos.

## Equipo operativo acordado

| Empleado | Función operativa | Conexiones previstas | Entrega principal |
| --- | --- | --- | --- |
| Hermes Montes | Director y único interlocutor del propietario | Telegram, correo compartido y registro interno de trabajos | Delega y comunica estado, bloqueos y resultados. |
| Luna Serrano | Recepción y coordinación | Calendario y notificaciones internas | Juntas, recordatorios y estado coordinado del equipo. |
| Diego Navarro | Prospección B2B | Google Places/Maps y, después, Apollo | Prospectos con fuente y criterios para Jorge. |
| Mateo Ríos | Especialista Meta Ads | MCP/API de Meta Ads | Campañas y optimizaciones autorizadas. |
| Valentina Cruz | Diseño y creatividad | OpenAI Images, Higgsfield y biblioteca de marca | Imágenes, variantes y archivos de campaña. |
| Ana Beltrán | Copywriting y contenido | Modelo de texto y base de conocimiento | Guiones y briefs para Valentina; copies para Mateo. |
| Lucía Vega | Google Ads y SEO | Google Ads y Search Console | Campañas y prospectos atribuidos para Jorge. |
| Jorge Salazar | CRM y automatizaciones | CRM y motor de automatización | Contactos deduplicados y automatizaciones controladas. |
| Pablo Fuentes | Analítica y reportes | Analítica, CRM y bitácora de trabajos | Cierre diario para Hermes con métricas y pendientes. |
| Carlos Ortega | Customer Success | GoHighLevel, CRM y calendario | Conversaciones, citas y escalamientos humanos. |

### Acceso a Supabase

El worker usa credenciales de servicio sólo en el servidor y aplica la política del registro de agentes. Los agentes no reciben acceso general a Supabase ni conocen sus credenciales. Hermes puede leer todos los trabajos y reportes; Pablo sólo lectura transversal y escritura de sus reportes; Jorge administra los prospectos; Carlos únicamente contactos y conversaciones asignadas; el resto trabaja en datos propios o de su departamento. Las tablas de credenciales, permisos, auditoría y costos no son editables por ningún agente.

### Entregas entre agentes

Las entregas son eventos persistentes, no mensajes informales: Ana → Valentina/Mateo; Diego y Lucía → Jorge; Jorge → Carlos; Mateo, Lucía, Jorge y Carlos → Pablo; todo el equipo → Hermes. Cada entrega conserva trabajo de origen, responsable, artefactos, fecha y estado. Hermes puede reasignar, pero no ejecutar herramientas especializadas que no tenga concedidas.

Carlos puede usar su nombre operativo, pero siempre debe presentarse como **“Carlos Ortega, asistente virtual de Chatter”**. Debe ofrecer acceso a una persona cuando el cliente lo solicite o cuando aparezcan cobros, quejas, datos sensibles, compromisos contractuales o una situación fuera de sus permisos.
