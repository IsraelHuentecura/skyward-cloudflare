# ADR 0001: Compliance Q&A Agent Architecture

## Status
Superseded by [ADR 0002](./0002-multi-agent-architecture.md)

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
2. Generate a run identifier (ULID) and create a new record in the Durable
   Object storage with status `pending`.
3. Kick off the analysis inside the Durable Object without waiting for its
   completion (`void state.blockConcurrencyWhile`).

Inside the Durable Object we will model the agent run as a pipeline of
composable services:

- **DocumentRepository** fetches PDF sources from the allowed URLs and caches
  extracted plain text in the Durable Object storage to avoid repeated work.
  Extraction uses `pdfjs-dist` which is compatible with the Worker runtime.
- **SectionIndexer** splits each document into semantic sections and generates
  embeddings with Workers AI (`@cf/baai/bge-base-en-v1.5`). The embeddings are
  cached so that future runs can reuse them.
- **QuestionRouter** selects the most relevant document sections using cosine
  similarity between the question embedding and the indexed chunks.
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
  - Caching extracted text and embeddings inside the Durable Object minimises
    repeated compute.

- **Cons**
  - PDF parsing on Workers has CPU costs; large documents may require
    streaming or offloading to R2 + scheduled preprocessors in the future.
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
  between the authoritative legal PDFs and the text used for reasoning. Fetching
  and caching on-demand keeps the pipeline closer to production expectations.

