import type { Ai } from "@cloudflare/workers-types";

export interface Env {
  AI: Ai;
  RUN_COORDINATOR: DurableObjectNamespace;
}
