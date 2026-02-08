import { upsertVectorizeSearchDocumentsWithWorkersAi } from "@future-diary/vector";
import { Hono } from "hono";
import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const reindexCursorSchema = z.object({
  userId: z.string().min(1),
  date: dateSchema,
});

const reindexRequestSchema = z.object({
  userId: z.string().min(1).optional(),
  cursor: reindexCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
  dryRun: z.boolean().optional().default(false),
});

type WorkerBindings = {
  APP_ENV?: string;
  JOBS_TOKEN?: string;
  DB?: D1Database;
  AI?: Ai;
  VECTOR_INDEX?: Vectorize;
  AI_EMBEDDING_MODEL?: string;
};

type DiaryEntryRow = {
  id: string;
  user_id: string;
  date: string;
  generated_text: string;
  final_text: string | null;
};

type ReindexCursor = z.infer<typeof reindexCursorSchema>;

const getEmbeddingModel = (env: WorkerBindings): string => env.AI_EMBEDDING_MODEL ?? "@cf/baai/bge-m3";

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  if (size <= 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const requireJobsToken = (request: Request, env: WorkerBindings):
  | { ok: true }
  | { ok: false; status: 401 | 500; error: { type: string; message: string } } => {
  const configured = env.JOBS_TOKEN;
  if (!configured) {
    return {
      ok: false,
      status: 500,
      error: { type: "MISSING_SECRET", message: "Secret 'JOBS_TOKEN' is required" },
    };
  }

  const provided = request.headers.get("x-jobs-token");
  if (!provided || provided !== configured) {
    return {
      ok: false,
      status: 401,
      error: { type: "UNAUTHORIZED", message: "Invalid jobs token" },
    };
  }

  return { ok: true };
};

const listDiaryEntriesForReindex = async (params: {
  db: D1Database;
  userId: string | undefined;
  cursor: ReindexCursor | undefined;
  limit: number;
}): Promise<{
  rows: DiaryEntryRow[];
  nextCursor: ReindexCursor | null;
  hasMore: boolean;
}> => {
  const limit = params.limit;
  const userId = params.userId;
  const cursor = params.cursor;

  const statement = (() => {
    if (userId) {
      if (cursor) {
        return params.db
          .prepare(
            "SELECT id, user_id, date, generated_text, final_text FROM diary_entries WHERE user_id = ? AND date > ? ORDER BY date ASC LIMIT ?",
          )
          .bind(userId, cursor.date, limit);
      }

      return params.db
        .prepare(
          "SELECT id, user_id, date, generated_text, final_text FROM diary_entries WHERE user_id = ? ORDER BY date ASC LIMIT ?",
        )
        .bind(userId, limit);
    }

    if (cursor) {
      return params.db
        .prepare(
          "SELECT id, user_id, date, generated_text, final_text FROM diary_entries WHERE user_id > ? OR (user_id = ? AND date > ?) ORDER BY user_id ASC, date ASC LIMIT ?",
        )
        .bind(cursor.userId, cursor.userId, cursor.date, limit);
    }

    return params.db
      .prepare(
        "SELECT id, user_id, date, generated_text, final_text FROM diary_entries ORDER BY user_id ASC, date ASC LIMIT ?",
      )
      .bind(limit);
  })();

  const response = await statement.all<DiaryEntryRow>();
  const rows = response.results ?? [];
  const hasMore = rows.length === limit;

  const last = rows[rows.length - 1] ?? null;
  const nextCursor =
    hasMore && last
      ? {
          userId: last.user_id,
          date: last.date,
        }
      : null;

  return { rows, nextCursor, hasMore };
};

const app = new Hono<{ Bindings: WorkerBindings }>();

app.get("/health", (context) =>
  context.json({
    ok: true,
    env: context.env?.APP_ENV ?? "development",
    service: "future-diary-jobs",
  }),
);

app.post("/v1/vector/reindex", async (context) => {
  const auth = requireJobsToken(context.req.raw, context.env);
  if (!auth.ok) {
    return context.json({ ok: false, error: auth.error }, auth.status);
  }

  const payload = await context.req.json().catch(() => null);
  const parsed = reindexRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return context.json(
      {
        ok: false,
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    );
  }

  const userId = parsed.data.userId;
  const cursor = parsed.data.cursor;
  const limit = parsed.data.limit;
  const dryRun = parsed.data.dryRun;

  if (userId && cursor && cursor.userId !== userId) {
    return context.json(
      {
        ok: false,
        error: { type: "INVALID_CURSOR", message: "cursor.userId must match userId when userId is specified" },
      },
      400,
    );
  }

  if (!context.env.DB) {
    return context.json(
      { ok: false, error: { type: "MISSING_BINDING", message: "D1 binding 'DB' is required" } },
      500,
    );
  }

  const db = context.env.DB;

  const page = await listDiaryEntriesForReindex({ db, userId, cursor, limit });
  const fetchedCount = page.rows.length;

  const documents = page.rows
    .map((row) => ({
      id: row.id,
      userId: row.user_id,
      date: row.date,
      text: (row.final_text ?? row.generated_text).trim(),
    }))
    .filter((doc) => doc.text.length > 0);

  const skippedEmpty = fetchedCount - documents.length;

  if (dryRun) {
    return context.json({
      ok: true,
      dryRun: true,
      fetchedCount,
      indexableCount: documents.length,
      skippedEmpty,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  }

  if (!context.env.AI || !context.env.VECTOR_INDEX) {
    return context.json(
      {
        ok: false,
        error: { type: "MISSING_BINDING", message: "Bindings 'AI' and 'VECTOR_INDEX' are required" },
      },
      500,
    );
  }

  const embeddingModel = getEmbeddingModel(context.env);

  const grouped = new Map<string, Array<{ id: string; date: string; text: string }>>();
  for (const doc of documents) {
    const list = grouped.get(doc.userId);
    if (list) {
      list.push({ id: doc.id, date: doc.date, text: doc.text });
    } else {
      grouped.set(doc.userId, [{ id: doc.id, date: doc.date, text: doc.text }]);
    }
  }

  const mutationIds: string[] = [];
  let indexedCount = 0;
  let embeddingDimension: number | null = null;

  for (const [namespace, docs] of grouped.entries()) {
    const safetyIdentifier = await sha256Hex(namespace);

    for (const batch of chunk(docs, 20)) {
      try {
        const result = await upsertVectorizeSearchDocumentsWithWorkersAi({
          ai: context.env.AI,
          embeddingModel,
          vectorIndex: context.env.VECTOR_INDEX,
          namespace,
          documents: batch,
        });

        indexedCount += result.indexedCount;
        mutationIds.push(result.mutationId);
        embeddingDimension ??= result.embeddingDimension;
      } catch (error) {
        console.warn("Vector reindex batch failed", {
          safetyIdentifier,
          count: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });

        return context.json(
          {
            ok: false,
            error: { type: "REINDEX_FAILED", message: "Vector reindex failed; see server logs" },
            meta: {
              nextCursor: page.nextCursor,
              hasMore: page.hasMore,
            },
          },
          500,
        );
      }
    }
  }

  return context.json({
    ok: true,
    dryRun: false,
    embeddingModel,
    embeddingDimension,
    fetchedCount,
    indexedCount,
    skippedEmpty,
    mutationIds,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
});

export { app };
export default {
  fetch: app.fetch,
};
