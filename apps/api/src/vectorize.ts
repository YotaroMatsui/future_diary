import { upsertVectorizeSearchDocumentsWithWorkersAi } from "@future-diary/vector";

export type VectorizeBindings = {
  AI?: Ai;
  VECTOR_INDEX?: Vectorize;
  AI_EMBEDDING_MODEL?: string;
};

export const getWorkersAiEmbeddingModel = (env: VectorizeBindings): string =>
  env.AI_EMBEDDING_MODEL ?? "@cf/baai/bge-m3";

export const buildVectorSearchQuery = (
  sourceEntries: Array<{ generatedText: string; finalText: string | null }>,
): string | null => {
  const seed = sourceEntries
    .slice(0, 3)
    .map((entry) => (entry.finalText ?? entry.generatedText).trim())
    .filter((text) => text.length > 0)
    .join("\n\n");

  return seed.length > 0 ? seed : null;
};

export const mergeFragments = <T extends { id: string }>(
  primary: readonly T[],
  secondary: readonly T[],
  limit: number,
): readonly T[] => {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const item of primary) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  for (const item of secondary) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged.slice(0, limit);
};

export const getOptionalExecutionContext = (context: unknown): ExecutionContext | undefined => {
  if (typeof context !== "object" || context === null) {
    return undefined;
  }

  try {
    return (context as { executionCtx: ExecutionContext }).executionCtx;
  } catch {
    return undefined;
  }
};

export const queueVectorizeUpsert = (params: {
  executionCtx: ExecutionContext | undefined;
  env: VectorizeBindings;
  safetyIdentifier: string;
  userId: string;
  entry: { id: string; date: string; text: string };
}): void => {
  if (!params.executionCtx?.waitUntil) {
    return;
  }

  if (!params.env.AI || !params.env.VECTOR_INDEX) {
    return;
  }

  const embeddingModel = getWorkersAiEmbeddingModel(params.env);

  params.executionCtx.waitUntil(
    upsertVectorizeSearchDocumentsWithWorkersAi({
      ai: params.env.AI,
      embeddingModel,
      vectorIndex: params.env.VECTOR_INDEX,
      namespace: params.userId,
      documents: [params.entry],
    }).catch((error) => {
      console.warn("Vectorize upsert failed", {
        safetyIdentifier: params.safetyIdentifier,
        entryId: params.entry.id,
        date: params.entry.date,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
};

export const queueVectorizeUpsertMany = (params: {
  executionCtx: ExecutionContext | undefined;
  env: VectorizeBindings;
  safetyIdentifier: string;
  userId: string;
  entries: readonly { id: string; date: string; text: string }[];
}): void => {
  if (!params.executionCtx?.waitUntil) {
    return;
  }

  if (!params.env.AI || !params.env.VECTOR_INDEX) {
    return;
  }

  const entriesToIndex = params.entries.filter((entry) => entry.text.trim().length > 0);
  if (entriesToIndex.length === 0) {
    return;
  }

  const embeddingModel = getWorkersAiEmbeddingModel(params.env);

  params.executionCtx.waitUntil(
    upsertVectorizeSearchDocumentsWithWorkersAi({
      ai: params.env.AI,
      embeddingModel,
      vectorIndex: params.env.VECTOR_INDEX,
      namespace: params.userId,
      documents: entriesToIndex,
    }).catch((error) => {
      console.warn("Vectorize upsert failed", {
        safetyIdentifier: params.safetyIdentifier,
        count: entriesToIndex.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
};

