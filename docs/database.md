# Base de datos

El esquema persistente está preparado para Supabase/PostgreSQL, pero **no se aplicó a una instancia local ni alojada durante esta entrega**. La demo que abre `npm run dev` usa el motor en memoria de `lib/domain.ts`; configurar variables de Supabase no cambia ese comportamiento por sí solo.

## Fuentes y orden de aplicación

Supabase aplica estos archivos por nombre:

1. `202610190001_platform.sql`: tablas, índices, RLS, privilegios, libro mayor y subastas.
2. `202610190002_workflows.sql`: programación, generación, conciliación Stripe, Realtime y Storage.
3. `202610190003_auth.sql`: alta mínima desde Auth y control de diversidad al pujar.
4. `seed.sql`: identidades y contenido reproducibles, sólo para desarrollo local.

`supabase/config.toml` fija PostgreSQL 17, Auth local, Realtime y un límite de Storage de 50 MiB.

## Modelo persistente

| Área | Tablas principales | Regla autoritativa |
| --- | --- | --- |
| Identidad y acceso | `profiles`, `user_roles`, `room_members`, `rooms` | La identidad procede de `auth.uid()`; los roles privilegiados los asigna el servidor. |
| Participación | `chat_messages`, `scene_proposals`, `votes`, `reactions` | RLS limita lectura por sala y oculta contenido pendiente o rechazado salvo al autor o moderador. |
| Publicidad y subastas | `advertiser_profiles`, `advertisements`, `auctions`, `bids` | `place_bid` bloquea la subasta, valida anuncio/autor y toma la identidad de Auth. |
| Créditos | `credit_accounts`, `credit_ledger_entries`, `credit_purchases` | Saldos disponibles y reservados no pueden ser negativos; el ledger sólo admite nuevos asientos. |
| Programación y video | `generation_jobs`, `generated_clips`, `playback_queue_items` | La proporción base es cuatro turnos comunitarios por uno patrocinado; toda salida requiere aprobación humana. |
| Moderación | `moderation_decisions`, `content_reports`, `appeals`, `audit_events` | Las decisiones y la auditoría no tienen escritura directa desde el navegador. |
| Pagos y operación | `subscriptions`, `stripe_events`, `feature_flags`, `analytics_events`, `idempotency_keys` | Los eventos externos se concilian en servidor y se deduplican antes de modificar créditos. |

## Seguridad y límites de confianza

Todas las tablas de `public` tienen RLS habilitado y parten de privilegios revocados. El navegador sólo recibe permisos acotados para leer estado visible, editar su nombre/avatar, votar, reaccionar y reportar. No puede insertar pujas, asientos contables, decisiones de moderación ni suscripciones. `profiles.stripe_customer_id` y `bids.idempotency_key` quedan fuera de los grants de columnas públicos.

Las funciones `security definer` fijan `search_path=''`. Sólo `place_bid` se concede a `authenticated`; las operaciones de dinero, cierre, generación, moderación y Stripe quedan para `service_role`, que debe permanecer exclusivamente en el servidor. El bucket `generated-clips` es privado y no define políticas de carga desde el navegador.

## Contabilidad y concurrencia

`private.ledger_move` bloquea la cuenta con `FOR UPDATE`, valida la clave de idempotencia y escribe saldo y asiento en la misma transacción. Reservar mueve créditos de disponible a reservado; ser superado los libera; cerrar consume únicamente la reserva ganadora. Los triggers `immutable_ledger` e `immutable_audit` rechazan actualizaciones y borrados, por lo que correcciones y reembolsos se expresan con asientos compensatorios.

`place_bid`, `close_auction` y `cancel_auction` bloquean primero la subasta. El cierre recorre las cuentas en orden estable, consume una vez al ganador y libera al resto. Una puja tardía extiende el plazo como máximo hasta `max_ends_at`. Estas propiedades están expresadas en SQL y cubiertas por pruebas estáticas; requieren PostgreSQL real para demostrar bloqueos y RLS en ejecución.

## Programación, generación y pagos

`select_community_proposal` puntúa votos, espera y diversidad de autor. `enqueue_approved_generation` aplica la proporción 4:1 y no permite que un patrocinio salte un turno comunitario. La reserva de presupuesto ocurre antes de llamar al proveedor. El trabajo sólo puede recorrer las transiciones declaradas, y `finish_generation_job` exige una decisión humana aprobatoria y una ruta privada ligada a sala y trabajo.

`apply_stripe_event` recibe un payload ya verificado y normalizado por la ruta Next.js. Deduplica tanto el evento como la compra, concede créditos sólo para pagos confirmados y procesa reembolsos acumulados mediante compensaciones. Si una devolución no puede aplicarse sin saldo negativo, marca la compra para revisión y suspende la cuenta.

Los triggers de Realtime publican únicamente una señal privada `state_changed`; el cliente debe volver a consultar datos protegidos por RLS. Presence y eventos efímeros usan otro topic para impedir que el navegador suplante cambios autoritativos.

## Cómo validarlo en PostgreSQL

En un entorno local desechable con Supabase CLI y `psql`:

```sh
supabase start
supabase db reset
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invariants.sql
```

`invariants.sql` se ejecuta dentro de una transacción que termina en `ROLLBACK`. Comprueba privilegios, RLS, Storage privado, idempotencia, sobregiro, inmutabilidad, reservas, extensión tardía, cierre, programación y conciliación de reembolsos. Esos comandos son el procedimiento pendiente; **no se ejecutaron en esta entrega**.
