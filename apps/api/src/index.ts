import { createDiaryRepository, createUserRepository } from "@future-diary/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { GenerationQueueMessage } from "./queueMessages";
import { processGenerationQueueBatch } from "./generationQueueConsumer";
import { generateFutureDiaryDraft } from "./futureDiaryDraftGeneration";
import { enqueueGenerationMessage } from "./queueProducer";
import { sha256Hex } from "./safetyIdentifier";
import {
  getOptionalExecutionContext,
  queueVectorizeUpsert,
} from "./vectorize";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const draftRequestSchema = z.object({
  userId: z.string().min(1),
  date: dateSchema,
  timezone: z.string().min(1).default("Asia/Tokyo"),
});

const diaryEntryGetRequestSchema = z.object({
  userId: z.string().min(1),
  date: dateSchema,
});

const diaryEntrySaveRequestSchema = diaryEntryGetRequestSchema.extend({
  body: z.string().trim().min(1).max(20_000),
});

const diaryEntryConfirmRequestSchema = diaryEntryGetRequestSchema;

const diaryEntryListRequestSchema = z.object({
  userId: z.string().min(1),
  onOrBeforeDate: dateSchema.optional().default("9999-12-31"),
  limit: z.number().int().min(1).max(100).optional().default(30),
});

type WorkerBindings = {
  APP_ENV?: string;
  DB?: D1Database;
  AI?: Ai;
  VECTOR_INDEX?: Vectorize;
  AI_EMBEDDING_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  GENERATION_QUEUE?: Queue<GenerationQueueMessage>;
  GENERATION_LOCK?: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: WorkerBindings }>();

app.use(
  "*",
  cors({
    // No auth/cookies yet; allow cross-origin calls from web app (dev: 5173, prod: Pages domain).
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type"],
    maxAge: 600,
  }),
);

app.get("/health", (context) =>
  context.json({
    ok: true,
    env: context.env?.APP_ENV ?? "development",
    service: "future-diary-api",
  }),
);

app.post("/v1/future-diary/draft", async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = draftRequestSchema.safeParse(payload);

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

  if (!context.env?.DB) {
    return context.json(
      {
        ok: false,
        error: {
          type: "MISSING_BINDING",
          message: "D1 binding 'DB' is required",
        },
      },
      500,
    );
  }

  const db = context.env.DB;
  const userId = parsed.data.userId;
  const date = parsed.data.date;
  const timezone = parsed.data.timezone;
  const safetyIdentifier = await sha256Hex(userId);

  const userRepo = createUserRepository(db);
  const diaryRepo = createDiaryRepository(db);

  await userRepo.upsertUser({ id: userId, timezone });

  let entry = await diaryRepo.findByUserAndDate(userId, date);
  const existedBefore = entry !== null;

  if (entry === null) {
    const entryId = crypto.randomUUID();
    await diaryRepo.createDraftGenerationPlaceholderIfMissing({ id: entryId, userId, date });
    entry = await diaryRepo.findByUserAndDate(userId, date);
    if (entry === null) {
      return context.json(
        {
          ok: false,
          error: { type: "PERSIST_FAILED", message: "Draft placeholder could not be persisted" },
        },
        500,
      );
    }
  }

  let source: "cached" | "queued" | "llm" | "deterministic" | "fallback" = "cached";

  if (entry.generationStatus === "failed") {
    await diaryRepo.markDraftGenerationCreated(userId, date);
    entry = (await diaryRepo.findByUserAndDate(userId, date)) ?? entry;
  }

  if (entry.generationStatus !== "completed") {
    source = "queued";

    if (entry.generationStatus === "created" || entry.generationStatus === "failed") {
      const enqueueResult = await enqueueGenerationMessage(context.env, {
        kind: "future_draft_generate",
        userId,
        date,
        timezone,
      });

      if (!enqueueResult.ok) {
        if (enqueueResult.reason !== "MISSING_QUEUE") {
          console.warn("Draft generation enqueue failed; falling back to sync generation", {
            safetyIdentifier,
            reason: enqueueResult.reason,
            message: enqueueResult.message,
          });
        }

        try {
          await diaryRepo.markDraftGenerationProcessing(userId, date);

          const generated = await generateFutureDiaryDraft({
            env: context.env,
            diaryRepo,
            userId,
            date,
            timezone,
            safetyIdentifier,
          });

          source = generated.source;
          entry = (await diaryRepo.completeDraftGeneration(userId, date, generated.draft.body)) ?? entry;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("Sync draft generation failed", { safetyIdentifier, message });
          await diaryRepo.markDraftGenerationFailed(userId, date, message);
          entry = (await diaryRepo.findByUserAndDate(userId, date)) ?? entry;
        }
      }
    }
  }

  return context.json({
    ok: true,
    draft: {
      title: `${date} の未来日記`,
      body: entry.finalText ?? entry.generatedText,
      sourceFragmentIds: [],
    },
    meta: {
      userId,
      entryId: entry.id,
      status: entry.status,
      generationStatus: entry.generationStatus,
      generationError: entry.generationError,
      cached: existedBefore,
      source,
      pollAfterMs: entry.generationStatus === "completed" ? 0 : 1500,
    },
  });
});

app.post("/v1/diary/entry/get", async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = diaryEntryGetRequestSchema.safeParse(payload);

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

  if (!context.env?.DB) {
    return context.json(
      {
        ok: false,
        error: {
          type: "MISSING_BINDING",
          message: "D1 binding 'DB' is required",
        },
      },
      500,
    );
  }

  const db = context.env.DB;
  const diaryRepo = createDiaryRepository(db);
  const entry = await diaryRepo.findByUserAndDate(parsed.data.userId, parsed.data.date);

  if (entry === null) {
    return context.json(
      {
        ok: false,
        error: {
          type: "NOT_FOUND",
          message: "Diary entry was not found",
        },
      },
      404,
    );
  }

  return context.json({
    ok: true,
    entry,
    body: entry.finalText ?? entry.generatedText,
  });
});

app.post("/v1/diary/entry/save", async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = diaryEntrySaveRequestSchema.safeParse(payload);

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

  if (!context.env?.DB) {
    return context.json(
      {
        ok: false,
        error: {
          type: "MISSING_BINDING",
          message: "D1 binding 'DB' is required",
        },
      },
      500,
    );
  }

  const db = context.env.DB;
  const diaryRepo = createDiaryRepository(db);
  const entry = await diaryRepo.updateFinalText(parsed.data.userId, parsed.data.date, parsed.data.body);

  if (entry === null) {
    return context.json(
      {
        ok: false,
        error: {
          type: "NOT_FOUND",
          message: "Diary entry was not found",
        },
      },
      404,
    );
  }

  const enqueueVectorize = await enqueueGenerationMessage(context.env, {
    kind: "vectorize_upsert",
    userId: parsed.data.userId,
    date: parsed.data.date,
  });

  if (!enqueueVectorize.ok) {
    const executionCtx = getOptionalExecutionContext(context);

    if (context.env.AI && context.env.VECTOR_INDEX && executionCtx?.waitUntil) {
      const safetyIdentifier = await sha256Hex(parsed.data.userId);

      queueVectorizeUpsert({
        executionCtx,
        env: context.env,
        safetyIdentifier,
        userId: parsed.data.userId,
        entry: {
          id: entry.id,
          date: entry.date,
          text: entry.finalText ?? entry.generatedText,
        },
      });
    }
  }

  return context.json({
    ok: true,
    entry,
    body: entry.finalText ?? entry.generatedText,
  });
});

app.post("/v1/diary/entry/confirm", async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = diaryEntryConfirmRequestSchema.safeParse(payload);

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

  if (!context.env?.DB) {
    return context.json(
      {
        ok: false,
        error: {
          type: "MISSING_BINDING",
          message: "D1 binding 'DB' is required",
        },
      },
      500,
    );
  }

  const db = context.env.DB;
  const diaryRepo = createDiaryRepository(db);
  const existing = await diaryRepo.findByUserAndDate(parsed.data.userId, parsed.data.date);

  if (existing === null) {
    return context.json(
      {
        ok: false,
        error: {
          type: "NOT_FOUND",
          message: "Diary entry was not found",
        },
      },
      404,
    );
  }

  if (existing.generationStatus !== "completed" && existing.finalText === null) {
    return context.json(
      {
        ok: false,
        error: {
          type: "GENERATION_INCOMPLETE",
          message: "Draft generation is not completed yet",
        },
      },
      409,
    );
  }

  const entry = await diaryRepo.confirmEntry(parsed.data.userId, parsed.data.date);

  if (entry === null) {
    return context.json(
      {
        ok: false,
        error: {
          type: "NOT_FOUND",
          message: "Diary entry was not found",
        },
      },
      404,
    );
  }

  const enqueueVectorizeConfirm = await enqueueGenerationMessage(context.env, {
    kind: "vectorize_upsert",
    userId: parsed.data.userId,
    date: parsed.data.date,
  });

  if (!enqueueVectorizeConfirm.ok) {
    const executionCtx = getOptionalExecutionContext(context);

    if (context.env.AI && context.env.VECTOR_INDEX && executionCtx?.waitUntil) {
      const safetyIdentifier = await sha256Hex(parsed.data.userId);

      queueVectorizeUpsert({
        executionCtx,
        env: context.env,
        safetyIdentifier,
        userId: parsed.data.userId,
        entry: {
          id: entry.id,
          date: entry.date,
          text: entry.finalText ?? entry.generatedText,
        },
      });
    }
  }

  return context.json({
    ok: true,
    entry,
    body: entry.finalText ?? entry.generatedText,
  });
});

app.post("/v1/diary/entries/list", async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = diaryEntryListRequestSchema.safeParse(payload);

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

  if (!context.env?.DB) {
    return context.json(
      {
        ok: false,
        error: {
          type: "MISSING_BINDING",
          message: "D1 binding 'DB' is required",
        },
      },
      500,
    );
  }

  const db = context.env.DB;
  const diaryRepo = createDiaryRepository(db);
  const entries = await diaryRepo.listRecentByUserOnOrBeforeDate(
    parsed.data.userId,
    parsed.data.onOrBeforeDate,
    parsed.data.limit,
  );

  return context.json({
    ok: true,
    entries: entries.map((entry) => ({
      ...entry,
      body: entry.finalText ?? entry.generatedText,
    })),
  });
});

export { app };
export { DraftGenerationLock } from "./draftGenerationLock";
export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch<unknown>, env: WorkerBindings, ctx: ExecutionContext) => {
    await processGenerationQueueBatch(batch, env, ctx);
  },
};
