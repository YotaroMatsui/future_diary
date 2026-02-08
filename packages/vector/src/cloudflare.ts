import type { VectorSearchPort, VectorSearchRequest, VectorSearchResult } from "./search";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeEmbeddingInput = (text: string, maxChars: number): string =>
  text.replace(/\s+/g, " ").trim().slice(0, maxChars);

const toEmbeddingVectors = (output: unknown): { vectors: readonly number[][]; dimension: number } => {
  if (!isRecord(output)) {
    throw new Error("Workers AI embedding output was not an object");
  }

  // Workers AI embedding models return `{ data, shape }` (most models) or `{ response, shape }` (some variants).
  const data = Array.isArray(output.data) ? output.data : Array.isArray(output.response) ? output.response : null;
  if (data === null || data.length === 0) {
    throw new Error("Workers AI embedding output did not include vectors");
  }

  const vectors: number[][] = [];
  for (const item of data) {
    if (!Array.isArray(item) || item.length === 0) {
      throw new Error("Workers AI embedding output contained an invalid vector");
    }
    if (!item.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("Workers AI embedding output contained a non-numeric vector value");
    }
    vectors.push(item);
  }

  const dimension = vectors[0]?.length ?? 0;
  if (dimension <= 0) {
    throw new Error("Workers AI embedding output vector dimension was invalid");
  }

  if (!vectors.every((vector) => vector.length === dimension)) {
    throw new Error("Workers AI embedding output contained mixed-dimension vectors");
  }

  return { vectors, dimension };
};

export const embedTextsWithWorkersAi = async (params: {
  ai: Ai;
  model: string;
  texts: readonly string[];
  maxCharsPerText?: number;
}): Promise<{ vectors: readonly number[][]; dimension: number }> => {
  const maxChars = params.maxCharsPerText ?? 6000;
  const normalized = params.texts.map((text) => normalizeEmbeddingInput(text, maxChars));

  if (normalized.some((text) => text.length === 0)) {
    throw new Error("Embedding input contained empty text");
  }

  const inputText = normalized.length === 1 ? normalized[0] : normalized;
  const output = await params.ai.run(params.model as never, { text: inputText } as never);
  return toEmbeddingVectors(output);
};

export const ensureVectorizeIndexDimensionMatches = async (params: {
  vectorIndex: Vectorize;
  embeddingDimension: number;
}): Promise<void> => {
  const info = await params.vectorIndex.describe();

  if (typeof info.dimensions !== "number" || !Number.isFinite(info.dimensions)) {
    throw new Error("Vectorize describe() did not return dimensions");
  }

  if (info.dimensions !== params.embeddingDimension) {
    throw new Error(
      `Vectorize index dimensions mismatch: index=${info.dimensions} embedding=${params.embeddingDimension}`,
    );
  }
};

const getMetadataString = (metadata: VectorizeMatch["metadata"] | undefined, key: string): string | null => {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
};

const normalizeMetadataText = (text: string, maxChars: number): string =>
  text.replace(/\s+/g, " ").trim().slice(0, maxChars);

export const createWorkersAiVectorizeSearchPort = (params: {
  ai: Ai;
  embeddingModel: string;
  vectorIndex: Vectorize;
  maxQueryChars?: number;
  oversampleFactor?: number;
  enableServerSideDateFilter?: boolean;
}): VectorSearchPort => ({
  async search(request: VectorSearchRequest): Promise<readonly VectorSearchResult[]> {
    const queryText = normalizeEmbeddingInput(request.query, params.maxQueryChars ?? 2000);
    if (queryText.length === 0 || request.topK <= 0) {
      return [];
    }

    const embedding = await embedTextsWithWorkersAi({
      ai: params.ai,
      model: params.embeddingModel,
      texts: [queryText],
      maxCharsPerText: params.maxQueryChars ?? 2000,
    });

    await ensureVectorizeIndexDimensionMatches({
      vectorIndex: params.vectorIndex,
      embeddingDimension: embedding.dimension,
    });

    const oversampledTopK = Math.min(100, Math.max(request.topK, 1) * (params.oversampleFactor ?? 3));

    const baseQueryOptions = {
      topK: oversampledTopK,
      returnMetadata: "all" as const,
      namespace: request.userId,
    };

    const queryOptionsWithFilter =
      request.beforeDate && params.enableServerSideDateFilter !== false
        ? {
            ...baseQueryOptions,
            filter: {
              date: { $lt: request.beforeDate },
            } satisfies VectorizeVectorMetadataFilter,
          }
        : baseQueryOptions;

    const matches = await (async () => {
      try {
        return await params.vectorIndex.query(embedding.vectors[0], queryOptionsWithFilter);
      } catch (error) {
        // Date filtering requires indexed metadata; if it's not configured, retry without server-side filter.
        if (!("filter" in queryOptionsWithFilter)) {
          throw error;
        }
        return await params.vectorIndex.query(embedding.vectors[0], baseQueryOptions);
      }
    })();

    const results = matches.matches
      .map((match) => {
        const date = getMetadataString(match.metadata, "date");
        const text = getMetadataString(match.metadata, "text");
        if (date === null || text === null) {
          return null;
        }
        return {
          id: match.id,
          date,
          relevance: match.score,
          text,
        } satisfies VectorSearchResult;
      })
      .filter((result): result is VectorSearchResult => result !== null);

    const beforeDate = request.beforeDate;
    const filteredByDate = beforeDate ? results.filter((item) => item.date < beforeDate) : results;
    return filteredByDate.slice(0, request.topK);
  },
});

export interface VectorizeSearchDocument {
  id: string;
  date: string;
  text: string;
}

export const upsertVectorizeSearchDocumentsWithWorkersAi = async (params: {
  ai: Ai;
  embeddingModel: string;
  vectorIndex: Vectorize;
  namespace: string;
  documents: readonly VectorizeSearchDocument[];
  maxEmbeddingCharsPerText?: number;
  maxMetadataTextChars?: number;
}): Promise<{ mutationId: string; indexedCount: number; embeddingDimension: number }> => {
  const documentsToIndex = params.documents
    .map((document) => ({
      ...document,
      text: document.text.trim(),
    }))
    .filter((document) => document.text.length > 0);

  if (documentsToIndex.length === 0) {
    throw new Error("No documents to index");
  }

  const embedding = await embedTextsWithWorkersAi({
    ai: params.ai,
    model: params.embeddingModel,
    texts: documentsToIndex.map((document) => document.text),
    maxCharsPerText: params.maxEmbeddingCharsPerText ?? 6000,
  });

  await ensureVectorizeIndexDimensionMatches({
    vectorIndex: params.vectorIndex,
    embeddingDimension: embedding.dimension,
  });

  const maxMetadataTextChars = params.maxMetadataTextChars ?? 1200;

  const vectors: VectorizeVector[] = documentsToIndex.map((document, index) => {
    const values = embedding.vectors[index];
    if (!values) {
      throw new Error("Workers AI embedding output length did not match input texts");
    }

    return {
      id: document.id,
      values,
      namespace: params.namespace,
      metadata: {
        date: document.date,
        text: normalizeMetadataText(document.text, maxMetadataTextChars),
      },
    };
  });

  const mutation = await params.vectorIndex.upsert(vectors);

  return {
    mutationId: mutation.mutationId,
    indexedCount: vectors.length,
    embeddingDimension: embedding.dimension,
  };
};
