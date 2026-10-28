# Integraciones de servidor

Estado: código y pruebas aisladas, sin credenciales ni transacciones externas. Las rutas de pagos/generación requieren `APP_MODE=production`; la sala demo se bloquea en ese modo. Falta conectar la UI a un repositorio persistente antes de operar con usuarios reales.

## Autenticación y permisos

`lib/supabase/server.ts` valida un bearer con `auth.getUser()`, comprueba el perfil y suspensión, y consulta roles/miembros para permisos de moderación. No acepta el rol, saldo, customer ni precio suministrados por el cliente. Las claves privilegiadas sólo se importan desde módulos `server-only`. `lib/supabase/browser.ts` prepara Auth con la publishable key. `GET /api/auth/session` devuelve la sesión verificada.

Las mutaciones reales utilizan `Idempotency-Key` (16–100 caracteres alfanuméricos, `_` o `-`) y JSON con esquema estricto. Las respuestas son no-store. No hay automatización de alta de cuentas de pago.

## Stripe sandbox

- `POST /api/payments/checkout`: `{offer:'membership'|'credits'}`. Resuelve Price y customer en servidor, valida importe/divisa/modalidad y crea Checkout con métodos dinámicos. No se especifica `payment_method_types`.
- `POST /api/payments/portal`: devuelve una URL de Customer Portal para el customer del usuario validado.
- `POST /api/payments/webhook`: raw body + `Stripe-Signature`. Rechaza eventos live y firmas inválidas; verifica la fuente Stripe antes de conciliar en SQL.

La compra de créditos sólo se concede al confirmar una sesión **complete/paid** de modo `payment`, tanto en `checkout.session.completed` como en `checkout.session.async_payment_succeeded`. Las mensualidades se conceden mediante facturas pagadas. Los movimientos y eventos son idempotentes en PostgreSQL. Los reembolsos usan compensaciones; no modifican asientos anteriores. Las páginas success/cancel sólo informan.

Configurar Prices de sandbox consistentes con `lib/payments/catalog.ts`, customer portal y webhooks de Checkout, invoices, suscripciones y `charge.refunded`. Usar claves restringidas compatibles con los recursos necesarios. No configurar impuestos automáticos sin registros fiscales aplicables.

Documentación oficial: [Checkout](https://docs.stripe.com/payments/checkout), [fulfillment](https://docs.stripe.com/checkout/fulfillment), [webhooks](https://docs.stripe.com/webhooks), [sandboxes](https://docs.stripe.com/sandboxes), [Customer Portal](https://docs.stripe.com/customer-management).

## fal.ai

Contrato verificado mediante el conector MCP de fal y en la documentación oficial del [modelo H3 Max](https://fal.ai/models/minimax/h3-max/text-to-video/api) y la [Queue API](https://fal.ai/docs/documentation/model-apis/inference/queue):

```json
{
  "prompt": "Una escena visual aprobada",
  "duration": 5,
  "resolution": "768P",
  "aspect_ratio": "16:9",
  "prompt_expansion_mode": "disabled",
  "enable_safety_checker": true
}
```

Modelo: `minimax/h3-max/text-to-video`. Envío: `https://queue.fal.run/minimax/h3-max/text-to-video`. Las URLs de estado/resultado/cancelación usan el identificador raíz `minimax/h3-max` y el `request_id`, como exige fal para endpoints con subrutas.

La configuración usa 5 segundos, 768P, 16:9, expansión desactivada y safety checker activo. El 19 de octubre de 2026 fal mostraba una tarifa promocional de 0,052 USD por segundo en 768P (0,26 USD por clip); la tarifa estándar anunciada para después del 31 de octubre es 0,08 USD por segundo (0,40 USD por clip). El presupuesto usa 0,40 USD por defecto para no subestimar el gasto y permite actualizarlo mediante `FAL_ESTIMATED_CLIP_USD` después de revisar el precio vigente.

El proveedor aplica timeout por solicitud, circuit breaker y hasta tres intentos para lecturas transitorias. **No reenvía automáticamente un POST ambiguo**, que podría haber sido aceptado y cobrado. Una cancelación solicitada no implica que el proveedor no pueda terminar o cobrar. Los costos son estimados, no una promesa de precio.

- `POST /api/generation`: `{proposalId}`. Requiere moderador de la sala y RPC de encolado.
- `GET /api/generation/:jobId`: estado/preview de moderación.
- `POST /api/generation/:jobId`: `{action:'start'|'poll'|'cancel'|'approve'|'reject',reason?}`. Reclama el trabajo y presupuesto en SQL; modera; envía; consulta; copia a Storage privado; retiene la salida en `processing_output` hasta revisión humana.
- `GET /api/generation/clips/:clipId`: evalúa visibilidad con RLS y entrega una URL firmada durante cinco minutos.

La descarga sólo acepta hosts HTTPS de `fal.media`, sin credenciales ni puertos extra, sin redirecciones, MP4 con firma de archivo y máximo 50 MB. El bucket `generated-clips` es privado. Ninguna URL del cliente puede convertirse directamente en clip público.

El conector MCP se usa desde Codex para descubrir el modelo, validar su esquema y comprobar disponibilidad. La aplicación llama la Queue API desde el servidor con `FAL_KEY`, porque las credenciales OAuth del MCP no deben copiarse ni exponerse al runtime de Next.js. H3 Max Director no está implementado: activar su flag devuelve un error controlado, nunca cambia silenciosamente de proveedor.

## Moderación

Políticas locales separadas por chat/propuesta/publicidad/enlaces/archivos. Con `OPENAI_API_KEY` se usa [Moderations](https://platform.openai.com/docs/api-reference/moderations) con `omni-moderation-latest`. Un error del servicio no se trata como aprobación. Sin la clave, el flujo real exige una decisión humana de texto registrada. La salida audiovisual siempre necesita revisión humana en este MVP.

## Supabase y Realtime

Aplicar las migraciones versionadas y el seed sólo en un entorno nuevo de desarrollo. Las identidades de seed no son cuentas de producción. Auth real crea perfiles mediante trigger. `connectRoomRealtime` conecta canales privados para cambios autoritativos y presencia/efímeros; la reconexión invalida snapshots antiguos. Los clientes no insertan ledger, ganadores, decisiones ni suscripciones.

Ver [Auth](https://supabase.com/docs/guides/auth), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Broadcast from Database](https://supabase.com/docs/guides/realtime/broadcast) y [Storage privado](https://supabase.com/docs/guides/storage/buckets/fundamentals).
