export interface AiSearchConfig {
  instance: string;
  generationModel: string;
  rerankerModel: string;
  maxResults: number;
  scoreThreshold: number;
}

export const AI_SEARCH_CONFIG: AiSearchConfig = {
  instance: "compliance-chile", // configure with your AI Search instance name
  generationModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  rerankerModel: "@cf/baai/bge-reranker-base",
  maxResults: 6,
  scoreThreshold: 0.25,
};
