export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface ToolCallMetric {
  tool: string;
  latencyMs: number;
  success: boolean;
  timestamp: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

export interface ReasoningStep {
  stage: string;
  summary: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface AgentAnswer {
  summary: string;
  obligations: Obligation[];
  disclaimers?: string[];
}

export interface Obligation {
  id: string;
  description: string;
  source: {
    documentId: string;
    reference: string;
    score?: number;
    attributes?: Record<string, unknown>;
    excerpt?: string;
  };
  rationale: string;
  actions?: string[];
  targets?: TargetMatch[];
  priority?: "low" | "medium" | "high" | "critical";
}

export interface TargetMatch {
  name: string;
  confidence: number;
  justification: string;
}

export interface RunRecord {
  id: string;
  question: string;
  targets?: string[];
  metadata?: Record<string, unknown>;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  answer?: AgentAnswer;
  reasoning: ReasoningStep[];
  metrics: {
    totalLatencyMs?: number;
    toolCalls: ToolCallMetric[];
  };
  error?: string;
}

export interface QuestionPayload {
  question: string;
  targets?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentContext {
  env: Env;
  storage: DurableObjectStorage;
}

export interface StructuredQuestion {
  normalizedQuestion: string;
  summary: string;
  focusAreas: string[];
  assumptions: string[];
  plan: string[];
}

export interface RetrievalChunk {
  id: string;
  documentId: string;
  title: string;
  excerpt: string;
  score: number;
  attributes?: Record<string, unknown>;
}

export interface RetrievalResult {
  query: string;
  model?: string;
  reranker?: string;
  chunks: RetrievalChunk[];
}

export interface AgentArtifacts {
  structuredQuestion?: StructuredQuestion;
  retrieval?: RetrievalResult;
  answer?: AgentAnswer;
}

export interface AgentModuleResult {
  artifacts?: Partial<AgentArtifacts>;
  reasoning: ReasoningStep;
}

import type { Env } from "../env";
