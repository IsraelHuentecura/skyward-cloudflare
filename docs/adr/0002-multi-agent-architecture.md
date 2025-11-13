# ADR 0002: Multi-Agent Architecture with Cloudflare AI Search

## Status
Accepted

## Context

The original prototype relied on bespoke PDF parsing and embedding logic that
ran entirely inside the Durable Object. While functional, that design required
significant maintenance effort (manual text extraction, custom chunking, model
selection) and duplicated capabilities that are already available through
Cloudflare AI Search. The challenge brief explicitly encourages a modular,
multi-agent solution that leans on Cloudflare's platform features to orchestrate
retrieval, reasoning, and compliance analysis.

We also want to enable multiple specialised agents—`ChatAgent`,
`KnowledgeAgent`, and `ObligationAgent`—that collaborate to deliver structured
answers. Each agent needs access to shared state, observability hooks, and the
ability to call Workers AI or AI Search tools while respecting execution time
limits. The new architecture must preserve asynchronous execution via Durable
Objects and keep JSON Schema validation in place.

## Decision

We are replacing the bespoke document indexing pipeline with a multi-agent
orchestrator that delegates to platform-native services:

- **Cloudflare AI Search Binding** — The Worker uses the AI binding configured in
  `wrangler.toml` to call `env.AI.autorag(<rag_id>).aiSearch()` and
  `search()` as described in the Workers AI Search documentation. Indexing,
  chunking, reranking, and metadata filtering are handled by AI Search.
- **Agent Orchestrator** — A new orchestrator coordinates specialised agents
  that share a tool runner for telemetry and push structured reasoning steps to
  the run record.
  - `ChatAgent` normalises the incoming question, identifies focus areas, and
    proposes sub-tasks using a chat-oriented Workers AI model.
  - `KnowledgeAgent` queries AI Search with the normalised question, optionally
    applying reranking and metadata filters per request metadata.
  - `ObligationAgent` uses a text generation model to transform retrieved
    context into obligations mapped to user targets with confidence scores.
- **Shared Artifacts** — Each agent reads/writes named artifacts (e.g.
  `normalizedQuestion`, `retrieval`) in a shared bag. This makes it trivial to
  add future agents without rewriting existing ones.
- **Durable Object Execution** — The `RunCoordinator` Durable Object keeps the
  asynchronous workflow, persists artifacts, tool metrics, and final answers, and
  exposes status via `GET /runs/:id`.

The orchestrator is implemented in `src/agent/pipeline.ts` and individual agents
live in `src/agent/agents`. The codebase now assumes that legal documents are
indexed by an AI Search instance referenced by `AI_SEARCH_INSTANCE_ID` defined in
configuration.

## Consequences

- **Pros**
  - Delegating retrieval to AI Search removes custom indexing code and aligns
    with Cloudflare's recommended approach for document-heavy workloads.
  - Specialised agents make the pipeline easier to extend (e.g., adding a
    `RiskAgent` later) and clarify responsibilities.
  - Tool usage is still tracked in one place, so observability requirements are
    satisfied.
  - Prompt logic is consolidated in agent modules, keeping the Worker entry
    point lean.
- **Cons**
  - The solution now depends on an external AI Search instance being provisioned
    and populated with the provided legal documents.
  - AI Search bindings are only available on live Workers; local testing requires
    stubbing or using `wrangler dev --remote`.
  - Latency is driven by AI Search and model inference; we must monitor costs and
    limits for large question volumes.

## Alternatives Considered

- **Keep bespoke indexing** — Rejected because it duplicates AI Search features
  and complicates maintenance.
- **Single agent with large prompt** — Rejected as it hides intermediate
  reasoning steps, makes observability harder, and limits modularity.
- **External workflow engine** — Not needed; Durable Objects already satisfy the
  asynchronous execution requirement without extra infrastructure.
