import type { Ai } from "@cloudflare/workers-types";
import type { DocumentChunk, DocumentMetadata, DocumentRecord } from "./types";
import { createStepId, ToolRunner } from "./tooling";

interface SectionIndex {
  documentId: string;
  chunks: DocumentChunk[];
}

export class SectionIndexer {
  constructor(private readonly storage: DurableObjectStorage, private readonly ai: Ai) {}

  async ensureIndex(
    metadata: DocumentMetadata,
    document: DocumentRecord,
    toolRunner: ToolRunner
  ): Promise<SectionIndex> {
    const cacheKey = `doc:${metadata.id}:chunks`;
    const cached = await this.storage.get<SectionIndex>(cacheKey);
    if (cached) {
      return cached;
    }

    const rawChunks = chunkDocument(document.text, metadata.id);
    const chunksWithEmbeddings: DocumentChunk[] = [];
    for (const chunk of rawChunks) {
      const embedding = await toolRunner.track(createStepId("embed-chunk"), async () => {
        const response = await this.ai.run("@cf/baai/bge-base-en-v1.5", {
          text: chunk.text,
        });
        if (!("data" in response) || !Array.isArray(response.data)) {
          throw new Error("La respuesta de embeddings no tiene el formato esperado");
        }
        const vector = response.data[0]?.embedding;
        if (!Array.isArray(vector)) {
          throw new Error("Embedding vacio");
        }
        return vector as number[];
      }, { documentId: metadata.id, chunkId: chunk.id });
      chunksWithEmbeddings.push({ ...chunk, embedding });
    }

    const index: SectionIndex = { documentId: metadata.id, chunks: chunksWithEmbeddings };
    await this.storage.put(cacheKey, index);
    return index;
  }
}

function chunkDocument(text: string, documentId: string): Omit<DocumentChunk, "embedding">[] {
  const maxLength = 1200;
  const lines = text.split(/\n+/);
  const chunks: Omit<DocumentChunk, "embedding">[] = [];
  let buffer: string[] = [];
  let position = 0;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    buffer.push(line.trim());
    if (buffer.join(" ").length >= maxLength) {
      chunks.push({
        id: `${documentId}-${position}`,
        documentId,
        position,
        text: buffer.join(" "),
      });
      buffer = [];
      position++;
    }
  }

  if (buffer.length > 0) {
    chunks.push({
      id: `${documentId}-${position}`,
      documentId,
      position,
      text: buffer.join(" "),
    });
  }

  return chunks;
}
