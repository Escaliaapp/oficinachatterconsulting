# Activación del panel de Conectores

Esta versión es para la oficina de un propietario. No es todavía una plataforma multiempresa.

## Preparación única antes del despliegue

1. Ejecutar `supabase/migrations/202610280001_chatter_connectors.sql` en el editor SQL del proyecto Supabase existente. Crea la tabla privada, deduplicación Apollo y exclusión mutua para Diego.
2. Crear `CHATTER_CONNECTOR_ENCRYPTION_KEY` en Vercel, con 64 caracteres hexadecimales aleatorios (32 bytes). Generarla localmente con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Guardarla como secreto en Production. No compartirla en capturas. Conservar una copia segura: cambiarla sin recifrar hará ilegibles las claves guardadas.
3. Para el cron de Vercel, definir `CRON_SECRET` con un secreto aleatorio. El endpoint conserva compatibilidad con `CHATTER_CRON_SECRET` para Telegram. Vercel envía automáticamente CRON_SECRET como Bearer; no envía CHATTER_CRON_SECRET.
4. Desplegar todos los cambios juntos, una sola vez. Abrir Conectores con sesión del propietario.

Las credenciales anteriores de Vercel se usan como respaldo, sin copiarlas al navegador. ON/OFF requiere la migración; guardar claves nuevas requiere además la clave de cifrado. Los cambios posteriores de conectores desde la oficina no requieren redeploy.

## Comportamiento

- OpenRouter, Apollo, Google Places y GoHighLevel tienen controles operativos. Las claves se cifran con AES-256-GCM, asociadas al identificador del conector. El navegador recibe solo estado y booleanos, nunca secretos guardados.
- Telegram y Supabase siguen siendo servicios base configurados en el servidor. Higgsfield, Gmail, Ads y MCP se muestran como integraciones pendientes.
- OFF impide nuevas llamadas a la herramienta, no cancela solicitudes enviadas ni suscripciones del proveedor.
- Probar acceso en OpenRouter y Apollo solo consulta autenticación. No genera contenido, busca personas ni crea contactos; tampoco garantiza permisos de todos los endpoints.
- Diego usa una sola fuente por ejecución. En Telegram y cron prefiere Apollo si está habilitado; desde la oficina se elige la fuente. Google envía al CRM solo si GoHighLevel está habilitado. Apollo conserva perfiles sin enriquecimiento, pendientes de revisión.
- El límite es de 10 prospectos guardados en las últimas 24 horas (o un valor menor configurado en DIEGO_DAILY_LIMIT), no una garantía de 10 personas nuevas ni un límite monetario del proveedor. Duplicados y filtros restrictivos pueden reducir el resultado.
- La exclusión mutua impide dos ejecuciones simultáneas de Diego. Tras diez minutos, una tarea abandonada se marca fallida; nunca se reenvía automáticamente al CRM. Revisar resultados antes de crear otra.
- Apollo usa cargos, industria, empleados y ubicación, con hasta tres búsquedas por palabras clave soportadas por la API pública. No equivale exactamente al filtro de etiquetas/descripción social de la web de Apollo. Corregida la palabra «desarrollos».
- El gasto se muestra como no medido. No se generan imágenes ni se enriquecen correos/teléfonos en esta versión. No hay aprobaciones para herramientas de generación porque todavía no están implementadas.

## Validación después del despliegue

1. Verificar acceso denegado a /api/chatter/connectors sin sesión y que las respuestas autenticadas no contienen claves.
2. Probar autenticación de Apollo/OpenRouter desde Conectores; OFF, recargar y comprobar persistencia.
3. Crear una tarea desde Tareas. Seleccionar una fuente apagada: debe rechazarse sin consultar al proveedor ni sacar la tarea de la cola.
4. Activar una fuente y ejecutar una tarea al decidir consumir la cuota. Revisar el resumen y los prospectos guardados. Un fallo debe indicar la etapa y terminar como Fallida.
5. La integración productiva debe probarse con credenciales reales del propietario; las pruebas locales no acreditan disponibilidad o permisos de los proveedores.
