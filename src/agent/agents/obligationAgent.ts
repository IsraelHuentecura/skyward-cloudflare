import Ajv from "ajv";
import agentOutputSchema from "../../../schemas/agent-output.schema.json" assert { type: "json" };
import type {
  AgentAnswer,
  AgentArtifacts,
  AgentModuleResult,
  Obligation,
  QuestionPayload,
  RetrievalResult,
  StructuredQuestion,
} from "../types";
import { BaseAgent, type AgentDependencies } from "./baseAgent";

const OBLIGATION_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateAnswer = ajv.compile(agentOutputSchema as any);

interface ObligationAgentResponse {
  summary: string;
  obligations: Array<{
    id: string;
    description: string;
    source: {
      documentId: string;
      reference: string;
      excerpt?: string;
      score?: number;
      attributes?: Record<string, unknown>;
    };
    rationale: string;
    actions?: string[];
    targets?: Array<{ name: string; confidence: number; justification: string }>;
    priority?: "low" | "medium" | "high" | "critical";
  }>;
  disclaimers?: string[];
}

export class ObligationAgent extends BaseAgent {
  constructor(deps: AgentDependencies) {
    super("obligation-agent", deps);
  }

  async run(payload: QuestionPayload, artifacts: AgentArtifacts): Promise<AgentModuleResult> {
    const structured = artifacts.structuredQuestion;
    const retrieval = artifacts.retrieval;
    const answer = await this.generateAnswer(payload, structured, retrieval);

    return {
      artifacts: { answer },
      reasoning: {
        stage: "analysis",
        summary: `Se generaron ${answer.obligations.length} obligaciones estructuradas`,
        details: {
          obligations: answer.obligations.map((ob) => ob.id),
          disclaimerCount: answer.disclaimers?.length ?? 0,
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async generateAnswer(
    payload: QuestionPayload,
    structured?: StructuredQuestion,
    retrieval?: RetrievalResult
  ): Promise<AgentAnswer> {
    const context = retrieval?.chunks
      .map(
        (chunk, index) =>
          `### Contexto ${index + 1}\nDocumento: ${chunk.title}\nReferencia: ${chunk.documentId}\nPuntaje: ${chunk.score}\n${chunk.excerpt}`
      )
      .join("\n\n") ?? "Sin contexto recuperado";

    const systemPrompt = `Eres el ObligationsAgent. Analizas resultados de Cloudflare AI Search sobre leyes chilenas.
Devuelve JSON válido siguiendo este esquema:
{
  "summary": string,
  "obligations": [
    {
      "id": string,
      "description": string,
      "source": {
        "documentId": string,
        "reference": string,
        "excerpt": string,
        "score": number,
        "attributes": object
      },
      "rationale": string,
      "actions": string[],
      "targets": [{ "name": string, "confidence": number, "justification": string }],
      "priority": "low"|"medium"|"high"|"critical"
    }
  ],
  "disclaimers": string[]
}`;

    const userPrompt = `Pregunta del usuario: ${payload.question}\n\nPlan del ChatAgent: ${structured?.plan?.join("; ") ?? "(sin plan)"}\n\nContexto recuperado:\n${context}\n\nConsidera los objetivos o targets: ${(payload.targets ?? []).join(", ") || "(no entregados)"}.`;

    const response = await this.tools.track(
      "obligation-agent",
      async () =>
        this.context.env.AI.run(OBLIGATION_MODEL as any, {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: false,
        }),
      { model: OBLIGATION_MODEL, contextChunks: retrieval?.chunks.length ?? 0 }
    );

    const parsed = this.parseResponse(response, retrieval);

    return parsed;
  }

  private parseResponse(raw: any, retrieval?: RetrievalResult): AgentAnswer {
    const text = typeof raw === "string" ? raw : raw?.response ?? raw?.result ?? "";
    try {
      const parsed = JSON.parse(text) as ObligationAgentResponse;
      if (!validateAnswer(parsed)) {
        throw new Error("Respuesta del modelo no cumple el esquema");
      }
      return {
        summary: parsed.summary ?? "",
        obligations: (parsed.obligations ?? []).map((item) => this.hydrateObligation(item, retrieval)),
        disclaimers: parsed.disclaimers,
      };
    } catch (error) {
      return {
        summary: "No se pudo parsear la respuesta del modelo.",
        obligations: [],
        disclaimers: [
          "Verificar manualmente la respuesta del modelo.",
          error instanceof Error ? error.message : String(error),
        ],
      };
    }
  }

  private hydrateObligation(item: ObligationAgentResponse["obligations"][number], retrieval?: RetrievalResult): Obligation {
    const fallback = retrieval?.chunks.find((chunk) => chunk.documentId === item.source.documentId);
    return {
      id: item.id,
      description: item.description,
      source: {
        documentId: item.source.documentId,
        reference: item.source.reference,
        score: item.source.score ?? fallback?.score,
        excerpt: item.source.excerpt ?? fallback?.excerpt,
        attributes: item.source.attributes ?? fallback?.attributes,
      },
      rationale: item.rationale,
      actions: item.actions,
      targets: item.targets,
      priority: item.priority,
    };
  }
}
