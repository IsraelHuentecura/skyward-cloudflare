import type { AgentAnswer, AgentContext, DocumentChunk, DocumentMetadata, QuestionPayload, ReasoningStep } from "./types";
import { ToolRunner } from "./tooling";
import { DocumentRepository } from "./documentRepository";
import { SectionIndexer } from "./sectionIndexer";
import { QuestionRouter } from "./questionRouter";
import { ComplianceAnalyzer } from "./complianceAnalyzer";
import { DOCUMENTS } from "../config/documents";

export interface AgentRunResult {
  answer: AgentAnswer;
  reasoning: ReasoningStep[];
  toolRunner: ToolRunner;
}

export async function executeAgentRun(
  payload: QuestionPayload,
  context: AgentContext
): Promise<AgentRunResult> {
  const reasoning: ReasoningStep[] = [];
  const toolRunner = new ToolRunner();
  const documentRepository = new DocumentRepository(context.storage);
  const indexer = new SectionIndexer(context.storage, context.env.AI);
  const router = new QuestionRouter(context.env.AI);
  const analyzer = new ComplianceAnalyzer(context.env.AI);

  reasoning.push({
    stage: "question",
    summary: "Pregunta recibida",
    details: { question: payload.question, targets: payload.targets },
    timestamp: new Date().toISOString(),
  });

  const documents: DocumentMetadata[] = DOCUMENTS;
  const chunks: DocumentChunk[] = [];

  for (const metadata of documents) {
    const doc = await documentRepository.getDocument(metadata, toolRunner);
    reasoning.push({
      stage: "document-loaded",
      summary: `Documento ${metadata.id} cargado`,
      details: { title: metadata.title, topics: metadata.topics },
      timestamp: new Date().toISOString(),
    });
    const index = await indexer.ensureIndex(metadata, doc, toolRunner);
    chunks.push(...index.chunks);
  }

  const questionEmbedding = await router.embedQuestion(payload.question, toolRunner);
  const ranked = router.rankChunks(questionEmbedding, chunks);
  const topChunks = ranked.slice(0, 6);

  reasoning.push({
    stage: "retrieval",
    summary: "Se seleccionaron los fragmentos más relevantes",
    details: {
      selected: topChunks.map((chunk) => ({ documentId: chunk.documentId, position: chunk.position, score: chunk.score })),
    },
    timestamp: new Date().toISOString(),
  });

  const answer = await analyzer.analyze(payload, topChunks, toolRunner);

  reasoning.push({
    stage: "analysis",
    summary: "El modelo generó obligaciones y resumen",
    details: { obligationCount: answer.obligations.length },
    timestamp: new Date().toISOString(),
  });

  return { answer, reasoning, toolRunner };
}
