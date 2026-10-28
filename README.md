# Chatter AI Headquarters

La entrada principal del proyecto es ahora la oficina virtual 3D de **Chatter Consulting**. Ejecuta `npm ci` y `npm run dev`, y abre [http://127.0.0.1:3000](http://127.0.0.1:3000).

La Fase 1 incluye diez empleados ficticios, rutinas locales, navegación con obstáculos, cámara interactiva, perfiles y persistencia en el navegador. No requiere claves API. La simulación no continúa con el navegador cerrado y todavía no ejecuta agentes de IA ni herramientas externas.

Consulta [la guía de Chatter: arquitectura, controles, pruebas, límites y fases siguientes](docs/chatter-headquarters.md). Las pruebas del nuevo motor se ejecutan con `npx tsx --test tests/chatter.test.ts`.

La base de operaciones de la Fase 2 está descrita en [Telegram, trabajos, herramientas, cron y notificaciones](docs/chatter-operations.md). El webhook permanece cerrado hasta configurar sus secretos y la base de datos.

La aplicación previa se conserva en [`/talktoad`](http://127.0.0.1:3000/talktoad). Su documentación original continúa abajo; sus servicios y créditos no pertenecen al nuevo prototipo de Chatter.

# Talktoad

Un escenario de video que la comunidad dirige con ideas, votos y turnos patrocinados. MVP local con una demo interactiva, imágenes originales, clips ambientales, motor autoritativo en el servidor y adaptadores para Supabase, Stripe y fal.ai.

## Ejecutar

Requiere Node.js 22 o posterior (verificado con Node 24) y npm.

```sh
npm ci
npm run dev
```

Abre **http://127.0.0.1:3000/talktoad**. No necesitas `.env.local` ni credenciales para la demo. Para ejecutar el build optimizado:

```sh
npm run build
npm start
```

No se ha publicado ni desplegado esta aplicación. El servidor se enlaza a loopback.

## Probar la experiencia

1. Abre la sala como visitante: el escenario reproduce un clip sin registro. La banda «Demo interactiva» identifica la simulación.
2. Elige **Entrar a la sala → Creador**. Escribe en el chat, reacciona, abre **Ideas** y vota. Usa **Proponer una escena** para enviar un título y una descripción visual.
3. La propuesta pasa por moderación en unos dos segundos. La selección combina votos, espera y diversidad. Al elegirse, atraviesa las etapas de generación durante veinte segundos, entra al buffer y aparece con atribución. El perfil muestra el estado de cada contribución. Los replays tienen enlaces `?clip=…`.
4. Cambia a **Anunciante** desde el perfil. La sesión incluye un anuncio de muestra aprobado. Usa **Dirigir la próxima escena**, selecciona el anuncio y confirma la reserva. Nova puede hacer **una contraoferta simulada** después de 25 segundos si tu oferta no supera 300 créditos. Al superarte se libera tu reserva.
5. Un anuncio nuevo siempre requiere revisión. Entra como **Moderación**, abre **Administrar**, apruébalo y revisa las operaciones. Para dos anunciantes simultáneos usa dos navegadores o perfiles separados; pestañas del mismo navegador comparten sesión.
6. La subasta se cierra con el reloj del servidor. **Salud de la sala → Cerrar subasta demo** permite adelantar el cierre para una demostración. Sólo paga el ganador y la escena patrocinada espera al turno correspondiente.
7. Reporta una escena con la bandera. Una idea rechazada puede apelarse desde el perfil o la pestaña Ideas. Moderación revisa reportes, suspende cuentas, retira clips y registra ajustes compensatorios.

### Cuentas demo

No hay contraseñas. Cada nueva sesión recibe **1.200 créditos ficticios**.

| Perfil | Acciones |
| --- | --- |
| Visitante | Ver la sala y replays |
| Creador | Conversar, reaccionar, votar, proponer, reportar, apelar |
| Anunciante | Lo anterior, anuncios con revisión y pujas |
| Moderación | Revisar contenido y reportes, suspender, pausar, cerrar/cancelar subastas, retirar clips, ajustes y auditoría |

Estos selectores de roles existen sólo en la demo. `APP_MODE=production` desactiva las rutas demo; un valor desconocido también falla de forma cerrada.

## Arquitectura y decisiones

- **Next.js App Router, React, TypeScript estricto y Tailwind 4**. Estilos editoriales propios, fuentes locales Manrope y Space Grotesk, iconos Lucide, diálogos nativos con manejo de foco y reduced motion.
- `components/room.tsx`: sala, formularios, onboarding, replay, cuentas y administración. `lib/config.ts`: marca provisional, reparto y precios visibles.
- `lib/domain.ts`: máquinas de estados, selección, programación, generación demo y contabilidad. Mutex FIFO en el servidor; ninguna puja, crédito o decisión privilegiada se confirma desde el cliente.
- `lib/demo-store.ts`: sesión opaca HttpOnly, SameSite, validación estricta de entrada, verificación de Origin, rate limits, JSON acotado y errores públicos seguros. Demo con polling autoritativo cada dos segundos y protección contra snapshots antiguos.
- `supabase/migrations`: esquema PostgreSQL, RLS, contabilidad inmutable, RPC con locks y claves de idempotencia, almacenamiento privado y canales de sala. Ver [base de datos](docs/database.md).
- `lib/providers`: interfaz de video, proveedor demo y fal, moderación, timeout, reintentos acotados de lecturas y circuit breaker. `app/api/generation`: envío y revisión de salida.
- `lib/payments`: Checkout, portal, verificación de firma sobre raw body, conciliación e idempotencia en SQL. La página de éxito **nunca concede créditos**.
- `lib/realtime.ts`: canales privados Supabase, Presence, Broadcast efímero y recuperación de snapshots. Preparado para conectar al adaptador persistente; la sala demo usa polling.

Los créditos se reservan con una puja válida, se liberan al ser superada y sólo se consumen en el cierre ganador. No son transferibles, retirables ni convertibles en dinero. No hay recompensas aleatorias. Cuatro de cada cinco turnos programados son comunitarios; el patrocinio no sustituye la moderación.

## Integraciones y variables

Copia `.env.example` a `.env.local` para trabajar en un entorno sandbox. Los nombres requeridos están incluidos sin valores:

| Variables | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Auth y cliente público con RLS |
| `SUPABASE_SECRET_KEY`, `DATABASE_URL` | Operaciones servidor y migraciones; nunca al navegador |
| `FAL_KEY` | Generación real, sólo servidor |
| `OPENAI_API_KEY` | Moderación remota; sin ella la generación real exige revisión humana documentada |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Sandbox, Checkout y firma de webhooks |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Reservada para integración de cliente Stripe |
| `APP_MODE` | Vacío o `demo`: demo local. `production`: adaptadores reales, demo bloqueada |
| `APP_URL` | Origen permitido para servicios reales |
| `STRIPE_SUBSCRIPTION_PRICE_ID`, `STRIPE_CREDITS_PRICE_ID` | Precios creados en sandbox y comprobados en el servidor |
| `FAL_ESTIMATED_CLIP_USD` | Estimación para control de presupuesto de H3 Max; por defecto conservador 0.40 USD para 5 s a 768P; verificar tarifa antes de usar |
| `ENABLE_H3_DIRECTOR` | Desactivado. Activarlo requiere implementar y validar el esquema del proveedor |

La suscripción de muestra cuesta 12 USD/mes e incluye 600 créditos; el paquete contiene 1.000 créditos por 10 USD. La configuración autorizada de Stripe está en `lib/payments/catalog.ts`; el servidor comprueba que el Price coincide. No se usa Connect.

Ver [integraciones](docs/integrations.md) para endpoints, precondiciones y documentación oficial.

## Verificación

```sh
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

Las pruebas unitarias y de integración cubren contabilidad, reservas, concurrencia serializada, cierre idempotente, extensión tardía, equidad, moderación, autorización, cola, firma de webhook, fallos de proveedor y reconexión. Las pruebas E2E deterministas recorren los handlers HTTP completos con reloj controlado: una propuesta comunitaria y una patrocinada hasta reproducción. No llaman servicios pagados. La verificación visual se realiza además contra la aplicación en ejecución.

`supabase/tests/invariants.sql` verifica privilegios y contabilidad en PostgreSQL. Las pruebas de contrato SQL por sí solas **no demuestran** RLS ni concurrencia de una instancia alojada. Consulta [verificación](docs/verification.md) para resultados y alcance realmente ejecutados.

## Límites reales de esta entrega

- **La demo vive en memoria de un único proceso.** Reiniciar el servidor borra sesiones, saldos, contenido y enlaces de replay. No es apta para varias réplicas ni para valor monetario. El reloj avanza al recibir consultas, no mediante un worker permanente.
- Las personas, mensajes y reacciones del guion son simulados. Los tres clips locales son animaciones ambientales de imágenes originales; **no representan generación semántica a partir de cada prompt**. Cada clip dura 5 s y se repite en un turno de 30 s.
- La moderación demo usa reglas conservadoras en texto; no garantiza cobertura completa ni analiza video. Las integraciones reales retienen el resultado hasta revisión humana. No se implementan cargas públicas de archivos.
- **La UI de la sala aún no está conectada al repositorio persistente de Supabase.** Auth, Realtime, SQL y rutas reales de pagos/generación están preparados, pero configurar claves no transforma por sí solo la demo en una plataforma en producción. La sala falla cerrada en ese modo para no mezclar datos reales con perfiles ficticios.
- El proveedor real apunta a `minimax/h3-max/text-to-video`; su esquema se verificó con el MCP de fal y su Queue API. No se realizaron pagos, llamadas de generación pagadas ni despliegues. Los contratos se prueban con dobles de red; falta la verificación pagada de extremo a extremo porque la cuenta de fal no tiene saldo disponible.
- H3 Max Director es una reserva desactivada, no una integración terminada. La analítica es operativa básica; no hay un colector de telemetría duradero ni embudo comercial completo.
- La CSP permite estilos y bootstrap inline de Next; antes de publicación conviene adoptar nonces por solicitud. Los límites en memoria necesitan un almacén compartido para despliegues con múltiples instancias.

## Próximos pasos por impacto

1. Conectar el repositorio persistente a la sala y al panel: Supabase Auth, snapshots, comandos RPC y Realtime; retirar el selector de roles de la experiencia real.
2. Ejecutar migraciones y pruebas RLS/concurrencia en Supabase local y sandbox; ensayar restauración y conciliación de saldos.
3. Configurar Stripe sandbox, verificar entrega/repetición/desorden de eventos y probar reembolsos parciales, renovación y cancelación.
4. Probar fal con presupuesto pequeño, revisión real del resultado, worker duradero, métricas de latencia y alarmas.
5. Completar moderación multimodal, accesibilidad automatizada, carga, rate limits compartidos y CSP con nonces antes de habilitar producción.

## Recursos visuales

Los originales y su procedencia están descritos en [public/media/README.md](public/media/README.md). Los videos y posters están incluidos y no se descargan al arrancar. No se incluyeron secretos reales.
