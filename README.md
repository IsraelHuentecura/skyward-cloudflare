# Skyward Compliance Agent

> API de cumplimiento modular basada en múltiples agentes que aprovecha Cloudflare AI Search y Workers AI.

## Visión general

Este repositorio implementa una API HTTP que coordina agentes especializados para responder
preguntas de cumplimiento normativo sobre leyes chilenas. La solución está pensada como un
laboratorio para el desafío de Skyward y prioriza la claridad arquitectónica por sobre una
implementación completa.

Componentes principales:

- **Cloudflare Workers** expone la API y actúa como orquestador sin servidor.
- **Durable Objects** persisten el estado de cada ejecución (`RunCoordinator`) y permiten
  asincronía: un análisis puede tomar minutos y sobrevivir a desconexiones del cliente.
- **Cloudflare AI Search** (binding `env.AI`) centraliza la indexación de los PDFs entregados,
  maneja chunking, ranking y reranking (`aiSearch`/`search`).
- **Workers AI** proporciona modelos de lenguaje para razonar y producir salidas estructuradas.
- **Agentes colaborativos** (`ChatAgent`, `KnowledgeAgent`, `ObligationAgent`) encapsulan cada
  responsabilidad y comparten telemetría a través de un `ToolRunner`.

La arquitectura está documentada en el ADR [`docs/adr/0002-multi-agent-architecture.md`](docs/adr/0002-multi-agent-architecture.md).

## Estructura del repositorio

```
├── docs/adr/                    # Registro de decisiones arquitectónicas
├── schemas/                     # Esquemas JSON de entrada/salida
├── src/
│   ├── agent/
│   │   ├── agents/              # Agentes especializados (chat, knowledge, obligation)
│   │   ├── pipeline.ts          # Orquestador multi-agente
│   │   ├── tooling.ts           # Métricas de herramientas
│   │   └── types.ts             # Tipos compartidos
│   ├── config/
│   │   └── aiSearch.ts          # Configuración del binding AI Search
│   ├── env.d.ts                 # Tipado de bindings del Worker
│   └── index.ts                 # Punto de entrada HTTP y Durable Object
├── package.json
└── wrangler.toml
```

## Configuración previa

1. **Provisionar AI Search**
   - Crear una instancia de AI Search desde el dashboard (`Compute & AI` → `AI Search`).
   - Ingestar los PDFs entregados mediante la fuente *Website* o mediante carga directa.
   - Registrar el nombre del índice (por ejemplo, `compliance-chile`).
2. **Configurar el binding de Workers AI**
   - En `wrangler.toml` ya existe la sección `[ai]` con `binding = "AI"`.
   - Ajustar `src/config/aiSearch.ts` para utilizar el identificador de AI Search y modelos deseados.
3. **Instalar dependencias**

```bash
npm install
```

4. **Autenticarse con Cloudflare**

```bash
npx wrangler login
```

Para ejecutar la indexación y búsquedas reales se recomienda usar `wrangler dev --remote`, ya que
las bindings de AI Search no están disponibles en el runtime de Miniflare.

## Ejecución en modo desarrollo

```bash
npm run dev -- --remote
```

`wrangler` desplegará el Worker en un entorno remoto de Cloudflare y expondrá la API en
`https://<subdominio>.workers.dev` o en `127.0.0.1:8787` mediante `--remote`. Cada solicitud crea
una ejecución asincrónica almacenada en el Durable Object correspondiente.

## Uso de la API

### Crear una ejecución

```bash
curl -sS -X POST http://127.0.0.1:8787/question \
  -H 'content-type: application/json' \
  -d '{
        "question": "Si tengo una empresa de software medioambiental para salmoneras en el sur de Chile, ¿cómo cumplo con la ley de protección de datos personales?",
        "targets": ["Plataforma SaaS", "Operaciones en terreno"],
        "metadata": { "sector": "salmonicultura" }
      }'
```

Respuesta esperada:

```json
{
  "runId": "<identificador>"
}
```

### Consultar el estado

```bash
curl -sS http://127.0.0.1:8787/runs/<identificador>
```

El payload incluye:

- `status`: `pending` | `running` | `completed` | `failed`.
- `answer`: resumen, obligaciones, asignaciones a objetivos y disclaimers.
- `reasoning`: etapas registradas por cada agente (recepción, análisis de pregunta, retrieval,
  generación de obligaciones, errores si los hubiera).
- `metrics`: latencia total y lista de herramientas utilizadas (modelo usado, instancia de AI Search,
  éxito o error, timestamps).

## Cómo funciona el pipeline

1. **ChatAgent** normaliza la pregunta usando un modelo conversacional de Workers AI y genera un
   plan de investigación.
2. **KnowledgeAgent** consulta `env.AI.autorag(<instance>).aiSearch()` siguiendo la documentación de
   Cloudflare AI Search (reescritura de consulta, `ranking_options.score_threshold`, reranking con
   `@cf/baai/bge-reranker-base`, filtros opcionales a partir de `metadata`).
3. **ObligationAgent** combina el plan y los fragmentos recuperados para pedir a un modelo de
   lenguaje que entregue un JSON válido. La respuesta se valida con
   [`schemas/agent-output.schema.json`](schemas/agent-output.schema.json) antes de almacenarse.
4. El `ToolRunner` registra cada invocación (`chat-agent`, `ai-search`, `obligation-agent`) con
   latencia, éxito y metadatos. Estos datos terminan en `run.metrics.toolCalls`.

Si un agente falla, se documenta el error en `reasoning` y el pipeline se detiene, dejando un
mensaje de fallback en la respuesta.

## Despliegue

```bash
npm run deploy
```

El comando registrará la Durable Object `RunCoordinator` (ver sección `[migrations]` en
`wrangler.toml`) y expondrá la API en el subdominio de Workers configurado.

## Esquemas JSON

- [`schemas/question-request.schema.json`](schemas/question-request.schema.json) valida la entrada
de `POST /question` mediante `ajv`.
- [`schemas/agent-output.schema.json`](schemas/agent-output.schema.json) se utiliza dentro de
  `ObligationAgent` para validar la respuesta del modelo.

## Observabilidad y métricas

Cada paso agrega un `ReasoningStep` con `stage`, `summary`, `details` y `timestamp`. Las métricas de
herramientas incluyen el modelo usado, éxito/fracaso, latencia y metadatos específicos (por ejemplo
la instancia de AI Search consultada). Esto facilita auditar el comportamiento del sistema y medir
costos.

## Limitaciones conocidas

- Se asume que la indexación de los PDFs está disponible en AI Search; este proyecto no cubre el
  pipeline de ingestión.
- Los modelos configurados (`@cf/meta/llama-3.1-8b-instruct*`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
  pueden variar según disponibilidad. Ajuste `src/config/aiSearch.ts` y las constantes de los agentes
  si se requieren alternativas.
- Para pruebas locales sin acceso a AI Search se deben mockear los bindings (no incluidos).

## Recursos

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/usage/workers-binding/)
- [Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
