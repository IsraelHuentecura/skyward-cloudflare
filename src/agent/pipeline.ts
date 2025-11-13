import type {
  AgentAnswer,
  AgentArtifacts,
  AgentContext,
  AgentModuleResult,
  QuestionPayload,
  ReasoningStep,
} from "./types";
import { ToolRunner } from "./tooling";
import type { AgentModule } from "./agents/baseAgent";
import { ChatAgent } from "./agents/chatAgent";
import { KnowledgeAgent } from "./agents/knowledgeAgent";
import { ObligationAgent } from "./agents/obligationAgent";

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
  const artifacts: AgentArtifacts = {};

  reasoning.push({
    stage: "question",
    summary: "Pregunta recibida",
    details: { question: payload.question, targets: payload.targets, metadata: payload.metadata },
    timestamp: new Date().toISOString(),
  });

  const agents: AgentModule[] = [
    new ChatAgent({ context, tools: toolRunner }),
    new KnowledgeAgent({ context, tools: toolRunner }),
    new ObligationAgent({ context, tools: toolRunner }),
  ];

  for (const agent of agents) {
    const result = await runAgent(agent, payload, artifacts);
    reasoning.push(result.reasoning);
    if (result.artifacts) {
      Object.assign(artifacts, result.artifacts);
    }
    if (result.reasoning.stage.endsWith("-error")) {
      break;
    }
  }

  const answer: AgentAnswer =
    artifacts.answer ?? ({ summary: "No se pudo generar una respuesta", obligations: [] } satisfies AgentAnswer);

  return { answer, reasoning, toolRunner };
}

async function runAgent(
  agent: AgentModule,
  payload: QuestionPayload,
  artifacts: AgentArtifacts
): Promise<AgentModuleResult> {
  try {
    return await agent.run(payload, artifacts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      reasoning: {
        stage: `${agent.name}-error`,
        summary: `El agente ${agent.name} falló`,
        details: { message },
        timestamp: new Date().toISOString(),
      },
    };
  }
}
