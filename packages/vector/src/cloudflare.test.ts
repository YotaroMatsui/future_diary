import { describe, expect, test } from "bun:test";
import {
  createWorkersAiVectorizeSearchPort,
  embedTextsWithWorkersAi,
  upsertVectorizeSearchDocumentsWithWorkersAi,
} from "./cloudflare";

describe("packages/vector cloudflare adapter", () => {
  test("embedTextsWithWorkersAi parses { data, shape } output", async () => {
    const ai = {
      run: async () => ({
        shape: [1, 3],
        data: [[0.1, 0.2, 0.3]],
      }),
    } as unknown as Ai;

    const embedding = await embedTextsWithWorkersAi({
      ai,
      model: "@cf/baai/bge-m3",
      texts: ["hello"],
    });

    expect(embedding.dimension).toBe(3);
    expect(embedding.vectors).toEqual([[0.1, 0.2, 0.3]]);
  });

  test("embedTextsWithWorkersAi parses { response, shape } output", async () => {
    const ai = {
      run: async () => ({
        shape: [1, 2],
        response: [[1, 2]],
      }),
    } as unknown as Ai;

    const embedding = await embedTextsWithWorkersAi({
      ai,
      model: "@cf/baai/bge-m3",
      texts: ["hello"],
    });

    expect(embedding.dimension).toBe(2);
    expect(embedding.vectors).toEqual([[1, 2]]);
  });

  test("createWorkersAiVectorizeSearchPort uses namespace=userId and filters by beforeDate", async () => {
    const ai = {
      run: async () => ({
        shape: [1, 2],
        data: [[1, 0]],
      }),
    } as unknown as Ai;

    const vectorIndex = {
      describe: async () => ({
        vectorCount: 0,
        dimensions: 2,
        processedUpToDatetime: 0,
        processedUpToMutation: 0,
      }),
      query: async (_values: number[], options?: VectorizeQueryOptions) => {
        expect(options?.namespace).toBe("user-1");
        return {
          matches: [
            {
              id: "e1",
              score: 0.9,
              metadata: { date: "2026-02-06", text: "past" },
            },
            {
              id: "e2",
              score: 0.8,
              metadata: { date: "2026-02-08", text: "future" },
            },
          ],
          count: 2,
        };
      },
    } as unknown as Vectorize;

    const port = createWorkersAiVectorizeSearchPort({
      ai,
      embeddingModel: "@cf/baai/bge-m3",
      vectorIndex,
    });

    const results = await port.search({
      userId: "user-1",
      query: "seed",
      topK: 10,
      beforeDate: "2026-02-07",
    });

    expect(results.map((r) => r.id)).toEqual(["e1"]);
  });

  test("upsertVectorizeSearchDocumentsWithWorkersAi writes namespace + metadata", async () => {
    const ai = {
      run: async () => ({
        shape: [2, 2],
        data: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      }),
    } as unknown as Ai;

    let upserted: VectorizeVector[] = [];

    const vectorIndex = {
      describe: async () => ({
        vectorCount: 0,
        dimensions: 2,
        processedUpToDatetime: 0,
        processedUpToMutation: 0,
      }),
      upsert: async (vectors: VectorizeVector[]) => {
        upserted = vectors;
        return { mutationId: "mutation-1" };
      },
    } as unknown as Vectorize;

    const result = await upsertVectorizeSearchDocumentsWithWorkersAi({
      ai,
      embeddingModel: "@cf/baai/bge-m3",
      vectorIndex,
      namespace: "user-1",
      maxMetadataTextChars: 5,
      documents: [
        { id: "e1", date: "2026-02-06", text: "abcdefg" },
        { id: "e2", date: "2026-02-05", text: "hello" },
      ],
    });

    expect(result.mutationId).toBe("mutation-1");
    expect(result.indexedCount).toBe(2);
    expect(result.embeddingDimension).toBe(2);
    expect(upserted.map((v) => v.namespace)).toEqual(["user-1", "user-1"]);
    expect(upserted.map((v) => v.id)).toEqual(["e1", "e2"]);
    expect(upserted[0]?.metadata).toEqual({ date: "2026-02-06", text: "abcde" });
  });
});

