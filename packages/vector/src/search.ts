import type { SourceFragment } from "@future-diary/core";

export interface VectorSearchRequest {
  userId: string;
  query: string;
  topK: number;
  beforeDate?: string;
}

export interface VectorSearchResult {
  id: string;
  date: string;
  relevance: number;
  text: string;
}

export interface VectorSearchPort {
  search(request: VectorSearchRequest): Promise<readonly VectorSearchResult[]>;
}

export const searchRelevantFragments = async (
  port: VectorSearchPort,
  request: VectorSearchRequest,
): Promise<readonly SourceFragment[]> => {
  const results = await port.search(request);

  return results
    .filter((item) => item.text.trim().length > 0)
    .sort((left, right) => right.relevance - left.relevance)
    .map((item) => ({
      id: item.id,
      date: item.date,
      relevance: item.relevance,
      text: item.text,
    }));
};
