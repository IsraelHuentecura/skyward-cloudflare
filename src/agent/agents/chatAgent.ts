import type { AgentArtifacts, AgentModuleResult, QuestionPayload, StructuredQuestion } from "../types";
import { BaseAgent, type AgentDependencies } from "./baseAgent";

const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

interface ChatAgentResponse {
  normalized_question: string;
  summary: string;
  focus_areas: string[];
  assumptions: string[];
  plan: string[];
}

export class ChatAgent extends BaseAgent {
  constructor(deps: AgentDependencies) {
    super("chat-agent", deps);
  }

  async run(payload: QuestionPayload, artifacts: AgentArtifacts): Promise<AgentModuleResult> {
    const system = `Eres un analista de cumplimiento que prepara preguntas para un equipo multi-agente.
Devuelve JSON con las claves: normalized_question, summary, focus_areas, assumptions, plan.`;

    const prompt = `Pregunta original:\n${payload.question}\n\n` +
      `Si el usuario entregó objetivos o "targets", inclúyelos dentro de focus_areas.`;

    const response = await this.tools.track(
      "chat-agent",
      async () =>
        this.context.env.AI.run(CHAT_MODEL as any, {
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          stream: false,
        }),
      { model: CHAT_MODEL }
    );

    const structured = this.parseResponse(response);

    return {
      artifacts: {
        structuredQuestion: structured,
      },
      reasoning: {
        stage: "question-analysis",
        summary: "La pregunta fue normalizada y se generó un plan de investigación",
        details: {
          normalizedQuestion: structured.normalizedQuestion,
          summary: structured.summary,
          focusAreas: structured.focusAreas,
          assumptions: structured.assumptions,
          plan: structured.plan,
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  private parseResponse(raw: unknown): StructuredQuestion {
    const text = typeof raw === "string" ? raw : (raw as any)?.response ?? "";
    try {
      const parsed = JSON.parse(text) as ChatAgentResponse;
      return this.normalize(parsed);
    } catch (error) {
      return {
        normalizedQuestion: text || "",
        summary: "No se pudo parsear la respuesta del modelo; se usará la pregunta original",
        focusAreas: [],
        assumptions: [],
        plan: ["Revisar documentos relacionados en AI Search", "Extraer obligaciones"],
      };
    }
  }

  private normalize(input: ChatAgentResponse): StructuredQuestion {
    return {
      normalizedQuestion: input.normalized_question || input.summary || "",
      summary: input.summary || input.normalized_question || "",
      focusAreas: input.focus_areas ?? [],
      assumptions: input.assumptions ?? [],
      plan: input.plan?.length ? input.plan : ["Consultar AI Search", "Analizar obligaciones"],
    };
  }
}
