import type { AgentArtifacts, AgentContext, AgentModuleResult, QuestionPayload } from "../types";
import { ToolRunner } from "../tooling";

export interface AgentModule {
  readonly name: string;
  run(payload: QuestionPayload, artifacts: AgentArtifacts): Promise<AgentModuleResult>;
}

export interface AgentDependencies {
  context: AgentContext;
  tools: ToolRunner;
}

export abstract class BaseAgent implements AgentModule {
  readonly name: string;
  protected readonly context: AgentContext;
  protected readonly tools: ToolRunner;

  constructor(name: string, deps: AgentDependencies) {
    this.name = name;
    this.context = deps.context;
    this.tools = deps.tools;
  }

  abstract run(payload: QuestionPayload, artifacts: AgentArtifacts): Promise<AgentModuleResult>;
}
