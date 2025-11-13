import type { AgentArtifacts, AgentModuleResult, QuestionPayload, RetrievalChunk, RetrievalResult } from "../types";
import { BaseAgent, type AgentDependencies } from "./baseAgent";
import { AI_SEARCH_CONFIG } from "../../config/aiSearch";

interface AiSearchBinding {
  aiSearch(input: Record<string, unknown>): Promise<any>;
  search(input: Record<string, unknown>): Promise<any>;
}

export class KnowledgeAgent extends BaseAgent {
  constructor(deps: AgentDependencies) {
    super("knowledge-agent", deps);
  }

  async run(payload: QuestionPayload, artifacts: AgentArtifacts): Promise<AgentModuleResult> {
    const structured = artifacts.structuredQuestion;
    const query = structured?.normalizedQuestion ?? payload.question;
    const binding = (this.context.env.AI as any).autorag(AI_SEARCH_CONFIG.instance) as AiSearchBinding;

    const metadataFilters = this.buildFilters(payload);

    const response = await this.tools.track(
      "ai-search",
      async () =>
        binding.aiSearch({
          query,
          model: AI_SEARCH_CONFIG.generationModel,
          rewrite_query: true,
          max_num_results: AI_SEARCH_CONFIG.maxResults,
          ranking_options: {
            score_threshold: AI_SEARCH_CONFIG.scoreThreshold,
          },
          reranking: {
            enabled: true,
            model: AI_SEARCH_CONFIG.rerankerModel,
          },
          filters: metadataFilters,
          stream: false,
        }),
      {
        instance: AI_SEARCH_CONFIG.instance,
        maxResults: AI_SEARCH_CONFIG.maxResults,
      }
    );

    const retrieval = this.parseResponse(response, query);

    return {
      artifacts: { retrieval },
      reasoning: {
        stage: "retrieval",
        summary: `Se recuperaron ${retrieval.chunks.length} fragmentos relevantes de AI Search`,
        details: {
          query: retrieval.query,
          reranker: retrieval.reranker,
          model: retrieval.model,
          documentIds: retrieval.chunks.map((chunk) => chunk.documentId),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  private buildFilters(payload: QuestionPayload): Record<string, unknown> | undefined {
    if (!payload.metadata || Object.keys(payload.metadata).length === 0) {
      return undefined;
    }

    return {
      type: "and",
      filters: Object.entries(payload.metadata).map(([key, value]) => ({
        type: "term",
        key,
        value,
      })),
    };
  }

  private parseResponse(raw: any, queryFallback: string): RetrievalResult {
    const result = raw?.result ?? raw;
    const responseQuery = result?.search_query ?? queryFallback;
    const chunks = (result?.data ?? []).map((item: any) => this.mapChunk(item));
    return {
      query: responseQuery,
      model: result?.model ?? result?.response_model,
      reranker: result?.reranking?.model,
      chunks,
    };
  }

  private mapChunk(item: any): RetrievalChunk {
    const content = item?.content?.[0]?.text ?? "";
    return {
      id: item?.file_id ?? crypto.randomUUID(),
      documentId: item?.file_id ?? "unknown",
      title: item?.filename ?? "",
      excerpt: content,
      score: item?.score ?? 0,
      attributes: item?.attributes,
    };
  }
}
