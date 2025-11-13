import type { AgentAnswer, AgentContext, DocumentMetadata, QuestionPayload, ReasoningStep, SearchResult } from "./types";
import { ToolRunner } from "./tooling";
import { ComplianceAnalyzer } from "./complianceAnalyzer";
import { DOCUMENTS } from "../config/documents";
import { AiSearchClient } from "./aiSearchClient";

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
  const analyzer = new ComplianceAnalyzer(context.env.AI);
  const indexName = context.env.AI_SEARCH_INDEX ?? "compliance-autorag";
  const searchClient = new AiSearchClient(context.env.AI, context.storage, indexName, DOCUMENTS);

  reasoning.push({
    stage: "question",
    summary: "Pregunta recibida",
    details: { question: payload.question, targets: payload.targets },
    timestamp: new Date().toISOString(),
  });

  const documents: DocumentMetadata[] = DOCUMENTS;

  await searchClient.ensureIndex(toolRunner);

  reasoning.push({
    stage: "index-sync",
    summary: "Índice IA Search sincronizado",
    details: { index: indexName, documents: documents.map((doc) => doc.id) },
    timestamp: new Date().toISOString(),
  });

  const results: SearchResult[] = await searchClient.query(payload.question, toolRunner, 8);
  const topResults = results.slice(0, 6);

  reasoning.push({
    stage: "retrieval",
    summary: "Se consultó IA Search y se seleccionaron los resultados más relevantes",
    details: {
      selected: topResults.map((result) => ({
        documentId: result.documentId,
        score: result.score,
        reference: result.reference,
      })),
    },
    timestamp: new Date().toISOString(),
  });

  const answer = await analyzer.analyze(payload, topResults, toolRunner);

  reasoning.push({
    stage: "analysis",
    summary: "El modelo generó obligaciones y resumen",
    details: { obligationCount: answer.obligations.length },
    timestamp: new Date().toISOString(),
  });

  return { answer, reasoning, toolRunner };
}
