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
    sectionText?: string;
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

export interface DocumentMetadata {
  id: string;
  title: string;
  url: string;
  language: string;
  topics: string[];
}

export interface DocumentRecord {
  metadata: DocumentMetadata;
  text: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  position: number;
  text: string;
  heading?: string;
  embedding: number[];
}

export interface RankedChunk extends DocumentChunk {
  score: number;
}

export interface AgentContext {
  env: Env;
  storage: DurableObjectStorage;
}

import type { Env } from "../env";
