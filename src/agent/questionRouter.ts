import type { Ai } from "@cloudflare/workers-types";
import type { DocumentChunk, RankedChunk } from "./types";
import { createStepId, ToolRunner } from "./tooling";

export class QuestionRouter {
  constructor(private readonly ai: Ai) {}

  async embedQuestion(question: string, toolRunner: ToolRunner): Promise<number[]> {
    const response = await toolRunner.track(createStepId("embed-question"), async () => {
      const result = await this.ai.run("@cf/baai/bge-base-en-v1.5", {
        text: question,
      });
      if (!("data" in result) || !Array.isArray(result.data)) {
        throw new Error("Respuesta inesperada del modelo de embeddings");
      }
      const embedding = result.data[0]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error("No se obtuvo embedding para la pregunta");
      }
      return embedding as number[];
    });
    return response;
  }

  rankChunks(questionEmbedding: number[], chunks: DocumentChunk[]): RankedChunk[] {
    const ranked = chunks
      .map((chunk) => {
        const score = cosineSimilarity(questionEmbedding, chunk.embedding);
        return { ...chunk, score };
      })
      .filter((chunk) => Number.isFinite(chunk.score))
      .sort((a, b) => b.score - a.score);
    return ranked;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const normA = Math.sqrt(a.reduce((acc, val) => acc + val * val, 0));
  const normB = Math.sqrt(b.reduce((acc, val) => acc + val * val, 0));
  if (normA === 0 || normB === 0) {
    return 0;
  }
  const numerator = a.reduce((acc, val, index) => acc + val * (b[index] ?? 0), 0);
  return numerator / (normA * normB + 1e-9);
}
