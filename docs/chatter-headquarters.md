# Chatter AI Headquarters

Oficina virtual de **Chatter Consulting**, en español mexicano. Esta entrega corresponde a la **Fase 1: oficina jugable**. Los diez empleados, sus biografías y las actividades del prototipo son ficticios. La escena representa geometría 3D interactiva; la imagen de referencia no se utiliza como fondo plano.

## Inicio local

Requiere Node.js 22 o posterior, npm y un navegador con WebGL. Desde la raíz del repositorio:

```sh
npm ci
npm run dev
```

Abre [Chatter Headquarters](http://127.0.0.1:3000). La aplicación anterior permanece en [Talktoad](http://127.0.0.1:3000/talktoad), junto con sus componentes, rutas API y documentación. Chatter no necesita claves API, una base de datos ni variables de entorno para esta fase.

Para ejecutar la versión optimizada:

```sh
npm run build
npm start
```

El servidor escucha en `127.0.0.1`. No se ha configurado un despliegue público para Chatter.

## Qué probar

1. Explora la oficina con los controles de zoom, rotación y restablecimiento de cámara. Observa recepción, despachos, escritorios, sala de juntas, cafetería, descanso y futbolito.
2. Selecciona un empleado en la escena o en la lista del equipo. Consulta su identidad ficticia, biografía, estado, herramientas previstas e historial de actividad.
3. Usa una acción local para enviar a un empleado al café, a trabajar, a descansar, a conversar, a reunirse o a jugar. Una reunión individual también convoca a Hermes si está habilitado.
4. Abre una conversación social. Los participantes comparten un identificador de conversación; sus mensajes y movimientos pertenecen a la simulación.
5. Pausa la oficina y comprueba que se detienen el reloj simulado y los desplazamientos. Reanuda o cambia entre velocidades 1×, 2× y 4×.
6. Edita un perfil y recarga la página. La identidad y el estado guardados se reconstruyen desde el almacenamiento local de ese navegador.

## Arquitectura

La interfaz, el comportamiento y la representación 3D están separados. Los comandos modifican un estado de dominio; el escenario consume ese estado y anima a los personajes. Así, la misma representación podrá reaccionar a eventos de tareas reales en una fase posterior.

| Módulo | Responsabilidad |
| --- | --- |
| `app/page.tsx` | Entrada de Chatter en `/`. |
| `components/chatter/` | Panel, perfiles y representación de la oficina mediante React Three Fiber, Drei y Three.js. |
| `lib/chatter/types.ts` | Contratos de empleado, estado operacional, evento y acción. |
| `lib/chatter/employees.ts` | Diez identidades ficticias, departamentos y biografías iniciales. |
| `lib/chatter/layout.ts` | Plano compartido, huellas de muebles y paredes, puntos de interacción y navegación. |
| `lib/chatter/simulation.ts` | Máquina de estados pura, rutinas, desplazamientos, reuniones y conversaciones. |
| `lib/chatter/persistence.ts` | Serialización versionada, validación de datos guardados y actualización de perfiles. |
| `tests/chatter.test.ts` | Pruebas del dominio, navegación, estados y persistencia. |

El motor no depende de React ni de un proveedor de IA. `stepSimulation(state, deltaSeconds)` avanza el tiempo; `commandAgent(state, employeeId, action)` aplica acciones; `setAgentEnabled` pausa o reactiva un personaje. Estas funciones devuelven un estado nuevo y no modifican el recibido.

La navegación utiliza un grafo de visibilidad alrededor de obstáculos con un margen para el cuerpo de los personajes. Cada segmento se valida contra el mismo plano utilizado por el escenario. Las mesas y paredes bloquean el paso; los asientos son destinos de interacción. Los personajes son provisionales y su animación procedural puede sustituirse por modelos GLB/GLTF conservando el contrato `EmployeeRuntime`.

El escenario agrupa la geometría estática por material, limita la resolución de renderizado y actualiza las sombras con menor frecuencia. Al pausar se dibuja bajo demanda. Estas medidas reducen el trabajo gráfico; el rendimiento final depende del dispositivo y no se ha certificado una tasa de cuadros específica.

Las rutinas cotidianas son locales: trabajo, investigación, desplazamiento, conversación, reunión y descanso. Las conversaciones reservan espacios para dos participantes y el registro conserva hasta cien eventos. No se ejecutan modelos, herramientas externas ni operaciones comerciales al producir una actividad visual.

`applyOfficeEvent` es un primer punto de integración para `TASK_STARTED`, `AGENT_MEETING_REQUESTED`, `AGENT_BREAK_REQUESTED` y `AGENT_PAUSED`. Es un adaptador de eventos visuales, **no un backend de agentes**. La futura ejecución de tareas deberá seguir funcionando aunque la animación se pause o el navegador se desconecte.

## Persistencia y límites de esta fase

- El estado se conserva en `localStorage`, bajo la clave versionada `chatter-headquarters:v1`. Incluye perfiles, posiciones, rutas, actividad, eventos, pausa, velocidad y selección.
- La restauración valida identidades, estados y rutas. Recupera valores predeterminados si los datos están dañados, son de una versión incompatible o contienen posiciones dentro de obstáculos.
- Los datos pertenecen al origen y navegador actuales; no se sincronizan entre dispositivos ni constituyen una base de datos del servidor. Borrar el almacenamiento del sitio elimina la sesión local. No almacenes información real de clientes ni credenciales en esta fase.
- **Al cerrar el navegador no se ejecutan trabajos en segundo plano.** La próxima visita recupera el último estado guardado, sin inventar actividad ocurrida durante la ausencia. Los temporizadores también pueden ralentizarse en una pestaña oculta.
- No hay todavía agentes de IA, chat conectado a un modelo, RAG, cron persistente, herramientas API/MCP, autenticación de Chatter, correo ni aprobaciones de operaciones reales.
- Las herramientas de los perfiles son capacidades previstas y se identifican como no conectadas. No se reutiliza ni se presupone una infraestructura externa de Hermes; en esta entrega es un personaje y coordinador simulado.
- Los Chatter Credits permanecen en cero. Caminar, conversar o simular trabajo nunca otorga créditos. Los indicadores iniciales de rendimiento son datos de demostración, no resultados verificados.
- La oficina, las rutinas y el chat guionizado se ejecutan localmente, sin cuotas de intentos, extensiones de prueba ni consumo de APIs. Conectar modelos o proveedores en fases futuras tendrá condiciones y costos propios; esta entrega no presupone IA externa gratuita o ilimitada.
- Los componentes y servicios existentes de Talktoad pertenecen a esa aplicación anterior; su presencia no habilita automáticamente servicios equivalentes para Chatter.

## Plan por fases

| Fase | Entrega | Criterio de avance |
| --- | --- | --- |
| **1 · Oficina jugable** | Escena 3D, diez empleados, cámara, perfiles, acciones, navegación y guardado local. | Recorrer la oficina, observar estados y movimientos, seleccionar y editar perfiles, recuperar la sesión. |
| **2 · Cerebro multiagente** | Identidad operacional por empleado, Hermes coordinador, tareas y chat persistentes, adaptadores de modelos y eventos en vivo. | El backend es la fuente de verdad; una tarea real actualiza al mismo empleado visible y se recupera tras una reconexión. |
| **3 · Operación autónoma** | PostgreSQL, cola persistente, cron con `America/Mazatlan`, memoria y conocimiento con fuentes, manifiestos API/MCP, permisos y aprobaciones. | Un worker ejecuta y reintenta trabajos con deduplicación aunque no haya un navegador abierto; toda acción externa de riesgo exige autorización. |
| **4 · Gestión empresarial** | Créditos por entregables verificados, notificaciones configurables, costos, calidad, rankings y evaluaciones. | Un resultado aprobado genera una sola acreditación y una sola notificación; los costos y la auditoría son consultables. |
| **5 · Vida social avanzada** | Relaciones, horarios, grupos, reuniones espontáneas y modelos animados definitivos. | La simulación social conserva identidad, evita bucles y permanece separada del consumo de IA y de los resultados profesionales. |

Para la Fase 2 conviene mantener este dominio visual detrás de un consumidor de eventos WebSocket/SSE. El nuevo backend deberá añadir autenticación, control de acceso, almacenamiento por cliente, idempotencia, presupuestos y una cola duradera antes de habilitar integraciones reales. Las credenciales deberán permanecer cifradas en el servidor. El esquema futuro debe distinguir explícitamente eventos sociales simulados, coordinación profesional y resultados verificados de herramientas.

## Verificación

Pruebas exclusivas del motor de Chatter:

```sh
npx tsx --test tests/chatter.test.ts
```

Resultado ejecutado: **12 pruebas aprobadas**. Cubren diez identidades completas; 400 recorridos entre escritorios y destinos sociales; llegada a destinos; reuniones con Hermes; pausa general e individual; velocidad; conversaciones vinculadas; persistencia y datos corruptos; ausencia de créditos por simulación; adaptación de eventos e invariantes durante una sesión prolongada. También comprueban identificadores únicos al repetir comandos con la oficina pausada y liberación del compañero cuando se desactiva a un participante.

Comandos de comprobación del repositorio completo:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Verificación realizada el 27 de octubre de 2026: **55/55 pruebas del repositorio**, **2/2 flujos E2E existentes**, comprobación de tipos, lint y build de producción aprobados. Los flujos `npm run test:e2e` pertenecen a Talktoad y no sustituyen una comprobación visual del canvas de Chatter.

En el navegador se comprobaron los diez personajes, selección y edición de perfiles, envío al café, pausa individual, reunión de tres participantes, pausa general, cámara y navegación entre vistas. El perfil editado, la pausa y los mensajes se recuperaron después de recargar. Una conversación social de Luna con Diego abrió los mensajes correspondientes a esos participantes. La vista móvil de 390 px se revisó sin desbordamiento horizontal; la navegación final no registró errores de consola.

Las pruebas puras verifican el plano y la máquina de estados. La revisión visual se realizó en el navegador disponible; no certifica todos los dispositivos WebGL, una tasa de cuadros específica ni una auditoría completa de accesibilidad.
