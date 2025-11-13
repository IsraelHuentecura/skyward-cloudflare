import type { ToolCallMetric } from "./types";

export class ToolRunner {
  private readonly _metrics: ToolCallMetric[] = [];

  get metrics(): ToolCallMetric[] {
    return this._metrics;
  }

  async track<T>(tool: string, executor: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    const start = Date.now();
    try {
      const result = await executor();
      this._metrics.push({
        tool,
        latencyMs: Date.now() - start,
        success: true,
        timestamp: new Date().toISOString(),
        metadata,
      });
      return result;
    } catch (error) {
      this._metrics.push({
        tool,
        latencyMs: Date.now() - start,
        success: false,
        timestamp: new Date().toISOString(),
        metadata,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export function createStepId(prefix: string): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${prefix}-${suffix}`;
}
