import Ajv, { type JSONSchemaType } from "ajv";
import type { Ai } from "@cloudflare/workers-types";
import outputSchema from "../../schemas/agent-output.schema.json" assert { type: "json" };
import type { AgentAnswer, DocumentChunk, QuestionPayload } from "./types";
import { createStepId, ToolRunner } from "./tooling";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateOutput = ajv.compile<AgentAnswer>(outputSchema as unknown as JSONSchemaType<AgentAnswer>);

export class ComplianceAnalyzer {
  constructor(private readonly ai: Ai) {}

  async analyze(
    question: QuestionPayload,
    context: DocumentChunk[],
    toolRunner: ToolRunner
  ): Promise<AgentAnswer> {
    const prompt = buildPrompt(question, context);
    const response = await toolRunner.track(createStepId("llm-analyze"), async () => {
      const result = await this.ai.run("@cf/meta/llama-3-8b-instruct", {
        messages: [
          {
            role: "system",
            content:
              "Eres un asistente legal que ayuda a mapear obligaciones regulatorias en Chile. Siempre devuelves JSON válido conforme al esquema proporcionado.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1200,
        temperature: 0.2,
        top_p: 0.9,
      });
      if (!("response" in result)) {
        throw new Error("La respuesta del modelo no contiene texto");
      }
      return result.response as string;
    }, { contextChunks: context.map((chunk) => ({ documentId: chunk.documentId, position: chunk.position })) });

    const parsed = parseJson(response);
    if (!validateOutput(parsed)) {
      throw new Error(`La respuesta del modelo no cumple con el esquema: ${ajv.errorsText(validateOutput.errors)}`);
    }
    return parsed;
  }
}

function buildPrompt(question: QuestionPayload, context: DocumentChunk[]): string {
  const targetsText = question.targets && question.targets.length > 0
    ? `\nObjetivos a mapear: ${question.targets.join(", ")}`
    : "";
  const contextText = context
    .map(
      (chunk, index) =>
        `\n[Fuente ${index + 1}]\nDocumento: ${chunk.documentId}\nPosicion: ${chunk.position}\nTexto: ${chunk.text}`
    )
    .join("\n");
  return `Pregunta: ${question.question}${targetsText}\n\nAnaliza las fuentes y devuelve un JSON con los siguientes campos: summary, obligations (lista de obligaciones con id, description, source.documentId, source.reference, source.sectionText, rationale, actions opcionales, targets opcionales {name, confidence, justification}, priority opcional), y disclaimers opcional. Responde exclusivamente con JSON válido.\n\nFuentes:${contextText}`;
}

function parseJson(raw: string): AgentAnswer {
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
      const inner = trimmed.replace(/^```json\n?/i, "").replace(/```$/i, "");
      return JSON.parse(inner);
    }
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]!);
    }
    throw error;
  }
}
