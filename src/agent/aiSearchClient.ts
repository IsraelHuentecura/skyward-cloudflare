import type { Ai } from "@cloudflare/workers-types";
import type { DocumentMetadata, SearchResult } from "./types";
import { createStepId, ToolRunner } from "./tooling";

interface AiSearchIndexResponse {
  index: string;
  status: string;
  documentsIngested?: number;
}

interface AiSearchQueryHit {
  id: string;
  document_id: string;
  score: number;
  reference?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  title?: string;
  url?: string;
}

interface AiSearchQueryResponse {
  results: AiSearchQueryHit[];
}

export class AiSearchClient {
  constructor(
    private readonly ai: Ai,
    private readonly storage: DurableObjectStorage,
    private readonly indexName: string,
    private readonly documents: DocumentMetadata[]
  ) {}

  get index(): string {
    return this.indexName;
  }

  async ensureIndex(toolRunner: ToolRunner): Promise<void> {
    const fingerprint = await computeFingerprint(this.documents);
    const cacheKey = `ai-search:index:${this.indexName}:fingerprint`;
    const cachedFingerprint = await this.storage.get<string>(cacheKey);
    if (cachedFingerprint === fingerprint) {
      return;
    }

    await toolRunner.track(
      createStepId("ai-search-sync"),
      async () => {
        const response = await this.ai.run("@cf/ai-search/index", {
          index: this.indexName,
          documents: this.documents.map((doc) => ({
            id: doc.id,
            url: doc.url,
            title: doc.title,
            metadata: {
              language: doc.language,
              topics: doc.topics,
            },
          })),
        });
        if (!isAiSearchIndexResponse(response)) {
          throw new Error("Respuesta inesperada del indexador de IA Search");
        }
        if (response.status !== "ready" && response.status !== "indexed") {
          throw new Error(`El indexador no quedó listo: ${response.status}`);
        }
        return response;
      },
      { index: this.indexName, documents: this.documents.length }
    );

    await this.storage.put(cacheKey, fingerprint);
  }

  async query(question: string, toolRunner: ToolRunner, topK = 8): Promise<SearchResult[]> {
    const response = await toolRunner.track(
      createStepId("ai-search-query"),
      async () => {
        const result = await this.ai.run("@cf/ai-search/query", {
          index: this.indexName,
          query: question,
          topK,
        });
        if (!isAiSearchQueryResponse(result)) {
          throw new Error("Respuesta inesperada de IA Search al consultar");
        }
        return result;
      },
      { index: this.indexName, topK }
    );

    return response.results.map<SearchResult>((hit, position) => {
      const snippet =
        hit.text ??
        (typeof hit.metadata?.snippet === "string" ? (hit.metadata.snippet as string) : undefined) ??
        "";
      return {
        id: hit.id ?? `${hit.document_id}-${position}`,
        documentId: hit.document_id,
        score: hit.score,
        reference: hit.reference,
        snippet: snippet.trim(),
        title: (hit.metadata?.title as string | undefined) ?? hit.title,
        url: (hit.metadata?.url as string | undefined) ?? hit.url,
        metadata: hit.metadata,
      };
    });
  }
}

function isAiSearchIndexResponse(value: unknown): value is AiSearchIndexResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Record<string, unknown>;
  return typeof data.index === "string" && typeof data.status === "string";
}

function isAiSearchQueryResponse(value: unknown): value is AiSearchQueryResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.results)) {
    return false;
  }
  return data.results.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const hit = item as Record<string, unknown>;
    return typeof hit.document_id === "string" && typeof hit.score === "number";
  });
}

async function computeFingerprint(documents: DocumentMetadata[]): Promise<string> {
  const encoder = new TextEncoder();
  const payload = encoder.encode(JSON.stringify(documents));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
