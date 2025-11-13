import { getDocument, GlobalWorkerOptions, version } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentMetadata, DocumentRecord } from "./types";
import { createStepId, ToolRunner } from "./tooling";

(GlobalWorkerOptions as unknown as { workerSrc: string | undefined }).workerSrc = undefined;

export class DocumentRepository {
  constructor(private readonly storage: DurableObjectStorage) {}

  async getDocument(metadata: DocumentMetadata, toolRunner: ToolRunner): Promise<DocumentRecord> {
    const cacheKey = `doc:${metadata.id}:text`;
    const cached = await this.storage.get<string>(cacheKey);
    if (cached) {
      return { metadata, text: cached };
    }

    const stepId = createStepId("fetch-document");
    const arrayBuffer = await toolRunner.track(stepId, async () => {
      const response = await fetch(metadata.url);
      if (!response.ok) {
        throw new Error(`No se pudo descargar ${metadata.id}: ${response.status}`);
      }
      return await response.arrayBuffer();
    }, { documentId: metadata.id, url: metadata.url });

    const text = await toolRunner.track(createStepId("parse-pdf"), async () => {
      return await extractTextFromPdf(arrayBuffer);
    }, { documentId: metadata.id });

    await this.storage.put(cacheKey, text);
    return { metadata, text };
  }
}

async function extractTextFromPdf(data: ArrayBuffer): Promise<string> {
  const loadingTask = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  try {
    let combined = `# Fuente PDF (pdf.js ${version})\n`;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      combined += `\n\n[Pagina ${pageNumber}]\n${pageText}`;
    }
    return combined;
  } finally {
    await pdf.cleanup();
  }
}
