# Verificación

Estado observado el 19 de octubre de 2026 sobre el repositorio local. No hubo despliegue, transacciones Stripe, generación pagada ni conexión a una base Supabase.

## Resultados ejecutados

| Comando o revisión | Resultado | Alcance real |
| --- | --- | --- |
| `npm test` | 43 aprobadas, 0 fallidas | 27 pruebas del dominio demo, 11 de adaptadores y 5 contratos estáticos de SQL. |
| `npm run test:e2e` | 2 aprobadas, 0 fallidas | Recorridos comunitario y patrocinado contra los handlers HTTP reales, con reloj y almacén en memoria controlados. |
| `npm run typecheck` | Aprobado | TypeScript estricto sin emitir archivos. |
| `npm run lint` | Aprobado | ESLint sobre el repositorio. |
| `npm run build` | Aprobado | Build optimizado de Next.js 16.4.2; página principal y rutas API compiladas. |
| `npm audit --omit=dev` | 0 vulnerabilidades de producción reportadas | Resultado del registro npm para las dependencias instaladas en ese momento. |
| Revisión visual local | Aprobada en escritorio | Sala en `127.0.0.1:3000`, inicio de sesión demo, chat y envío de propuesta; revisión manual, no auditoría automatizada de accesibilidad visual. |

Las 43 pruebas incluyen reservas y liberaciones, cierre idempotente, concurrencia FIFO del motor demo, extensiones tardías, selección y diversidad, moderación, autorización, cookies HttpOnly, control de Origin, cola fal, fallos de proveedor, firma de webhook, reembolsos y reconciliación de snapshots. Las dos pruebas E2E recorren propuesta, moderación, generación simulada, cola, reproducción, replay, anuncio, dos postores y liquidación.

## Qué demuestran las pruebas SQL

`tests/sql-contract.test.ts` inspecciona las migraciones como texto y evita regresiones evidentes: grants privilegiados, ledger mutable, ausencia de locks, saltos de programación, omisión de revisión humana o topics Realtime inseguros. Que estas cinco pruebas pasen **no demuestra** que PostgreSQL haya aplicado el SQL, que RLS filtre filas reales ni que dos conexiones concurrentes se serialicen correctamente.

`supabase/tests/invariants.sql` contiene aserciones ejecutables para una base migrada y sembrada. Cubre privilegios efectivos, RLS, Storage privado, idempotencia, sobregiro, inmutabilidad, subasta, programación y conciliación Stripe. No se ejecutó porque no se levantó PostgreSQL/Supabase local ni se conectó una instancia alojada.

## Dobles y servicios externos

Los tests no consumen servicios pagados. fal y Stripe usan dobles de red o firmas de prueba locales. El esquema de `minimax/h3-max/text-to-video` se contrastó mediante el MCP de fal, pero la cuenta reportó saldo agotado, por lo que no se realizó una generación real. Tampoco se enviaron webhooks de Stripe sandbox ni se validó Auth, Realtime o Storage contra Supabase.

La prueba E2E llama directamente a los Route Handlers con `Request`/`Response`; conserva cookies y permisos reales del código, pero no abre un navegador ni atraviesa una red. La revisión visual manual complementa ese hueco sólo para el flujo demo observado.

## Validación pendiente antes de producción

1. Aplicar las migraciones y el seed en Supabase local, ejecutar `supabase/tests/invariants.sql` y probar carreras con conexiones PostgreSQL separadas.
2. Verificar Auth, RLS, Realtime privado, URLs firmadas y restauración en un proyecto sandbox.
3. Ejecutar Checkout, webhooks repetidos/desordenados, renovaciones y reembolsos en Stripe sandbox.
4. Financiar una prueba acotada de fal, revisar el video generado, medir latencia/costo y comprobar cancelación y fallos ambiguos.
5. Añadir pruebas de navegador, accesibilidad, carga y recuperación de procesos antes de habilitar `APP_MODE=production`.
