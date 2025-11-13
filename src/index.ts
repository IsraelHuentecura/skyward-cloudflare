import Ajv from "ajv";
import questionSchema from "../schemas/question-request.schema.json" assert { type: "json" };
import type { Env } from "./env";
import type { QuestionPayload, RunRecord } from "./agent/types";
import { executeAgentRun } from "./agent/pipeline";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateQuestion = ajv.compile<QuestionPayload>(questionSchema as any);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/question") {
      return await handleQuestion(request, env);
    }

    if (request.method === "GET" && url.pathname.startsWith("/runs/")) {
      const runId = url.pathname.split("/")[2];
      if (!runId) {
        return jsonResponse({ error: "Identificador inválido" }, 400);
      }
      return await handleRunStatus(runId, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleQuestion(request: Request, env: Env): Promise<Response> {
  let payload: QuestionPayload;
  try {
    payload = (await request.json()) as QuestionPayload;
  } catch (error) {
    return jsonResponse({ error: "Body inválido" }, 400);
  }

  if (!validateQuestion(payload)) {
    return jsonResponse({ error: "Validación fallida", details: validateQuestion.errors }, 400);
  }

  const runId = crypto.randomUUID().replace(/-/g, "");
  const stub = env.RUN_COORDINATOR.get(env.RUN_COORDINATOR.idFromName(runId));
  const initResponse = await stub.fetch("https://run/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, payload }),
  });

  if (!initResponse.ok) {
    const body = await initResponse.text();
    return jsonResponse({ error: "No se pudo crear la ejecución", details: body }, 500);
  }

  return jsonResponse({ runId }, 202);
}

async function handleRunStatus(runId: string, env: Env): Promise<Response> {
  const stub = env.RUN_COORDINATOR.get(env.RUN_COORDINATOR.idFromName(runId));
  const response = await stub.fetch("https://run/status", { method: "GET" });
  if (response.status === 404) {
    return jsonResponse({ error: "Ejecución no encontrada" }, 404);
  }
  const data = (await response.json()) as RunRecord;
  return jsonResponse(data, 200);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export class RunCoordinator {
  private run?: RunRecord;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/init") {
      const body = (await request.json()) as { runId: string; payload: QuestionPayload };
      return await this.initialize(body.runId, body.payload);
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const run = await this.getRun();
      if (!run) {
        return new Response("Not Found", { status: 404 });
      }
      return jsonResponse(run, 200);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async initialize(runId: string, payload: QuestionPayload): Promise<Response> {
    const existing = await this.getRun();
    if (existing) {
      return jsonResponse(existing, 200);
    }

    const now = new Date().toISOString();
    const run: RunRecord = {
      id: runId,
      question: payload.question,
      targets: payload.targets,
      metadata: payload.metadata,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      reasoning: [],
      metrics: { toolCalls: [] },
    };

    await this.saveRun(run);

    this.state.waitUntil(this.execute(payload));

    return jsonResponse(run, 201);
  }

  private async execute(payload: QuestionPayload): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const run = await this.getRun();
      if (!run) {
        return;
      }
      const start = Date.now();
      run.status = "running";
      run.startedAt = new Date().toISOString();
      run.updatedAt = run.startedAt;
      await this.saveRun(run);

      try {
        const { answer, reasoning, toolRunner } = await executeAgentRun(payload, {
          env: this.env,
          storage: this.state.storage,
        });

        run.status = "completed";
        run.completedAt = new Date().toISOString();
        run.updatedAt = run.completedAt;
        run.answer = answer;
        run.reasoning = reasoning;
        run.metrics = {
          totalLatencyMs: Date.now() - start,
          toolCalls: toolRunner.metrics,
        };
        await this.saveRun(run);
      } catch (error) {
        run.status = "failed";
        run.updatedAt = new Date().toISOString();
        run.error = error instanceof Error ? error.message : String(error);
        run.metrics.totalLatencyMs = Date.now() - start;
        await this.saveRun(run);
      }
    });
  }

  private async getRun(): Promise<RunRecord | undefined> {
    if (!this.run) {
      this.run = await this.state.storage.get<RunRecord>("run");
    }
    return this.run;
  }

  private async saveRun(run: RunRecord): Promise<void> {
    this.run = run;
    await this.state.storage.put("run", run);
  }
}
