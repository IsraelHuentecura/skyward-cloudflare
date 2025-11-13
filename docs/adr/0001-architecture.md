# ADR 0001: Compliance Q&A Agent Architecture

## Status
Accepted

## Context

We need to build a small backend service that simulates an agent capable of
reading and reasoning over a curated set of Chilean legal documents. The agent
must be accessible through an HTTP API, orchestrate multiple tools, and run
asynchronously so that long running analyses do not block clients. The
challenge encourages the usage of Cloudflare Workers and Workers AI to keep
runtime costs low and to take advantage of the edge-native environment.

Key requirements include:

- The API must expose an endpoint to create a question run and an endpoint to
  retrieve the result later.
- Runs must log structured reasoning steps, tool usage, and minimal metrics.
- Requests and responses must be validated with JSON Schema.
- The agent must rely exclusively on the documents provided through public
  URLs.
- The codebase should follow strong modularity and composability principles so
  that we can extend or modify the pipeline during the live follow-up session.

The Worker environment has specific constraints: limited CPU time, no native
filesystem, and the need to keep bundles small. Durable Objects provide
low-latency strongly consistent storage that is well suited for orchestrating
long-lived asynchronous workflows. Workers AI offers access to hosted models
for text generation and embeddings without leaving Cloudflare's network.

## Decision

We will implement the service as a Cloudflare Worker using the modules
syntax. A Durable Object (`RunCoordinator`) will own the lifecycle of each
agent run. The Worker entry point will expose two HTTP routes:

- `POST /question` to create a new run and trigger asynchronous processing.
- `GET /runs/:id` to fetch the latest status, answer, reasoning steps, and
  metrics.

Upon receiving a question the Worker will:

1. Validate the payload against a JSON Schema using `ajv`.
2. Generate a run identifier and create a new record in the Durable Object
   storage with status `pending`.
3. Kick off the analysis inside the Durable Object without waiting for its
   completion (`void state.blockConcurrencyWhile`).

Inside the Durable Object we will model the agent run as a pipeline of
composable services:

- **AiSearchClient** keeps the authorised documents synchronised with a
  Cloudflare AI Search (AutoRAG) index. The managed service downloads the PDFs,
  parses them, and creates embeddings on Cloudflare's infrastructure. We store
  a fingerprint of the document list so that we only trigger a re-index when the
  catalogue changes.
- **AiSearchClient** also runs semantic queries; AI Search returns relevant
  passages with scores and metadata that we log as part of the reasoning trail.
- **ComplianceAnalyzer** calls a Workers AI text generation model
  (`@cf/meta/llama-3-8b-instruct`) with a structured prompt that requests
  obligations in JSON form together with rationales and optional target
  mappings.
- **Validator** ensures that the model's JSON response matches the output
  schema. If the validation fails we fall back to a friendly error message.

Tool executions are encapsulated inside a `ToolRunner` abstraction that tracks
latency, success/failure, and the number of invocations. Each stage of the
pipeline appends a `ReasoningStep` record that is persisted as part of the run
state for observability.

The Durable Object keeps the run status up to date (`pending`, `running`,
`completed`, `failed`) so the Worker can serve consistent results via the
`GET /runs/:id` route. All state is serialised to JSON, making it portable for
future migrations (e.g., to D1 or R2) if we outgrow Durable Objects.

## Consequences

- **Pros**
  - Durable Objects provide a simple way to model asynchronous runs without an
    external database.
  - Workers AI keeps all inference traffic within Cloudflare reducing latency
    and simplifying authentication.
  - The modular pipeline allows us to add more tools (e.g., policy matching,
    retrieval plugins) with minimal changes.
  - AI Search removes the need to bundle PDF parsers or vector stores inside
    the Worker, while the fingerprint guard prevents unnecessary re-indexes.

- **Cons**
  - We depend on AI Search; if the API changes the client must be updated
    quickly (defensive validations are in place to fail fast).
  - Durable Object storage is limited in size; we may need to spill to KV/R2 if
    the number of indexed documents grows substantially.
  - Workers AI model availability can change; we should keep configuration
    flexible to swap models or fall back to alternative providers.

## Alternatives Considered

- **Synchronous Worker without Durable Objects**: rejected because long
  running runs could exceed the request time limits and there would be no easy
  way to resume after a client disconnects.

- **External database (D1/Postgres)**: not necessary for the scope of the
  exercise; Durable Objects already offer the consistency guarantees we need
  without additional infrastructure.

- **Pre-extracted text committed to the repository**: rejected to avoid drift
  between the authoritative legal PDFs and the text used for reasoning. AI
  Search already handles parsing and chunking without bringing extra binaries
  into the Worker bundle.

