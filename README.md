# Skyward Compliance Agent

> Agente de preguntas y respuestas sobre cumplimiento normativo chileno ejecutado en Cloudflare Workers.

## Visión General

Este proyecto implementa un servicio HTTP que orquesta un agente asíncrono para leer,
indexar y razonar sobre un conjunto curado de leyes chilenas. El agente se apoya en:

- **Cloudflare Workers** para exponer una API ligera y escalable.
- **Durable Objects** para coordinar ejecuciones largas sin depender del ciclo de vida
  de la petición HTTP inicial.
- **Workers AI** para generar embeddings semánticos (BGE Base) y razonar con un modelo
  de lenguaje (Llama 3 8B Instruct).
- **pdf.js** para extraer texto directamente desde los PDF publicados por los organismos
  chilenos (se usan únicamente los enlaces entregados en el desafío).

El pipeline aplica principios SOLID mediante clases especializadas por responsabilidad:
repositorio de documentos, indexador, ruteador de preguntas, analizador de cumplimiento y
capas de métricas/herramientas.

## Arquitectura

El flujo de trabajo está documentado en el ADR [`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md).
En resumen:

1. `POST /question` valida la solicitud con JSON Schema y crea un identificador ULID.
2. El Worker inicializa un `RunCoordinator` (Durable Object) que persiste el estado y lanza
   la ejecución en segundo plano.
3. El DO descarga los PDF, extrae texto, genera embeddings y selecciona los fragmentos más
   relevantes mediante similaridad coseno.
4. El analizador arma un prompt estructurado y consulta a Workers AI para obtener un JSON
   con obligaciones, mapeos a objetivos y racionales.
5. `GET /runs/:id` devuelve el estado de la ejecución (pendiente, corriendo, completada o
   fallida) junto con la respuesta, métricas y trazas de razonamiento.

## Requisitos Previos

- Node.js 20+
- `pnpm`, `npm` o `yarn` (se usa `npm` en los ejemplos)
- Cuenta de Cloudflare con acceso a Workers, Durable Objects y Workers AI
- `wrangler` autenticado (`npx wrangler login`)

## Configuración

Instale dependencias:

```bash
npm install
```

Cree un archivo `.dev.vars` (opcional) si desea sobreescribir configuraciones locales.
Para producción no es necesario; Workers AI se autentica automáticamente.

## Ejecución en modo desarrollo

```bash
npm run dev
```

`wrangler` levantará un entorno local (Miniflare) con Durable Objects. Durante el primer
run el agente descargará y procesará los PDF. Dependiendo de la red y los modelos
seleccionados el proceso puede tardar varios minutos.

### Disparar una pregunta

```bash
curl -sS -X POST http://127.0.0.1:8787/question \
  -H 'content-type: application/json' \
  -d '{
        "question": "Si tengo una empresa de software medioambiental para salmoneras, en el sur de Chile, ¿cómo cumplo con la ley de protección de datos personales?",
        "targets": ["Plataforma SaaS", "Operaciones en terreno"]
      }'
```

Respuesta esperada:

```json
{
  "runId": "01J123456789ABCDEFXYZ"
}
```

### Consultar el estado de la ejecución

```bash
curl -sS http://127.0.0.1:8787/runs/01J123456789ABCDEFXYZ
```

La respuesta incluirá el estado, la salida del agente, las métricas de herramientas y los
pasos de razonamiento.

## Despliegue

```bash
npm run deploy
```

El despliegue registrará la Durable Object `RunCoordinator` y expondrá la API en la URL
asignada por Cloudflare.

## Esquemas JSON

- [`schemas/question-request.schema.json`](schemas/question-request.schema.json):
  valida la forma de las preguntas recibidas.
- [`schemas/agent-output.schema.json`](schemas/agent-output.schema.json):
  asegura que la respuesta del modelo cumpla con la estructura esperada.

## Métricas y Observabilidad

Cada herramienta que el agente invoca reporta latencia, éxito o error y metadatos. Estos
registros se incluyen en `run.metrics.toolCalls`. Además, `run.reasoning` documenta las
etapas clave del pipeline para facilitar auditorías.

## Limitaciones y Trabajo Futuro

- El parsing de PDF se ejecuta on-demand dentro del Worker. Para documentos más extensos se
  recomienda procesarlos previamente y almacenarlos en R2/KV.
- Workers AI puede evolucionar o cambiar modelos; los identificadores se centralizan en
  `ComplianceAnalyzer` y `SectionIndexer` para facilitar sustituciones.
- El matching de objetivos usa solamente razonamiento del LLM. En futuras iteraciones se
  puede incorporar una capa simbólica o reglas específicas por industria.

## Referencias

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
