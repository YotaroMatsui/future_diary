import {
  createAuthSessionRepository,
  createDiaryRepository,
  createDiaryRevisionRepository,
  createUserRepository,
} from "@future-diary/db";
import { defaultUserModel, parseUserModelInput, parseUserModelJson, serializeUserModelJson } from "@future-diary/core";
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
  date: dateSchema,
  timezone: z.string().min(1).default("Asia/Tokyo"),
});

const diaryEntryGetRequestSchema = z.object({
  date: dateSchema,
});

const diaryEntrySaveRequestSchema = diaryEntryGetRequestSchema.extend({
  body: z.string().trim().min(1).max(20_000),
});

const diaryEntryConfirmRequestSchema = diaryEntryGetRequestSchema;

const diaryEntryListRequestSchema = z.object({
  onOrBeforeDate: dateSchema.optional().default("9999-12-31"),
  limit: z.number().int().min(1).max(100).optional().default(30),
});

const diaryEntryDeleteRequestSchema = z.object({
  date: dateSchema,
});

const authSessionCreateRequestSchema = z.object({
  timezone: z.string().min(1).default("Asia/Tokyo"),
});

const userModelUpdateRequestSchema = z.object({
  model: z.unknown(),
});

type WorkerBindings = {
  APP_ENV?: string;
  CORS_ALLOW_ORIGINS?: string;
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

type AuthContext = {
  userId: string;
  sessionId: string;
};

const app = new Hono<{ Bindings: WorkerBindings; Variables: { auth: AuthContext } }>();

const defaultCorsAllowOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"] as const;

const parseCorsAllowOrigins = (raw: string | undefined): readonly string[] =>
  (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

app.use(
  "*",
  cors({
    origin: (origin, context) => {
      if (!origin) {
        return null;
      }

      const configuredOrigins = parseCorsAllowOrigins(context.env?.CORS_ALLOW_ORIGINS);
      const allowlist =
        configuredOrigins.length > 0
          ? configuredOrigins
          : context.env?.APP_ENV === "production"
            ? []
            : defaultCorsAllowOrigins;

      return allowlist.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type", "authorization"],
    maxAge: 600,
  }),
);

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const generateAccessToken = (byteLength = 32): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64UrlEncode(bytes);
};

const parseBearerToken = (headerValue: string | undefined | null): string | null => {
  if (!headerValue) {
    return null;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
};

const requireAuth = async (context: any, next: any): Promise<Response | void> => {
  const db = context.env?.DB as D1Database | undefined;

  if (!db) {
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

  const token = parseBearerToken(context.req.header("authorization"));
  if (!token) {
    return context.json(
      {
        ok: false,
        error: {
          type: "UNAUTHORIZED",
          message: "Authorization: Bearer <token> is required",
        },
      },
      401,
    );
  }

  const tokenHash = await sha256Hex(token);
  const sessionRepo = createAuthSessionRepository(db);
  const session = await sessionRepo.findByTokenHash(tokenHash);

  if (!session) {
    return context.json(
      {
        ok: false,
        error: {
          type: "UNAUTHORIZED",
          message: "Invalid or expired token",
        },
      },
      401,
    );
  }

  context.set("auth", { userId: session.userId, sessionId: session.id } satisfies AuthContext);

  const executionCtx = getOptionalExecutionContext(context);
  if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(sessionRepo.touchSession(session.id).catch(() => undefined));
  } else {
    await sessionRepo.touchSession(session.id).catch(() => undefined);
  }

  return await next();
};
app.get("/health", (context) =>
  context.json({
    ok: true,
    env: context.env?.APP_ENV ?? "development",
    service: "future-diary-api",
  }),
);

app.post("/v1/auth/session", async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = authSessionCreateRequestSchema.safeParse(payload);

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
  const timezone = parsed.data.timezone;
  const userId = crypto.randomUUID();

  const accessToken = generateAccessToken();
  const tokenHash = await sha256Hex(accessToken);

  const userRepo = createUserRepository(db);
  const sessionRepo = createAuthSessionRepository(db);

  await userRepo.upsertUser({ id: userId, timezone });
  await sessionRepo.createSession({ id: crypto.randomUUID(), userId, tokenHash });

  return context.json({
    ok: true,
    accessToken,
    user: {
      id: userId,
      timezone,
    },
  });
});

app.get("/v1/auth/me", requireAuth, async (context) => {
  const auth = context.get("auth") as AuthContext;

  const db = context.env?.DB as D1Database | undefined;
  if (!db) {
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

  const userRepo = createUserRepository(db);
  const user = await userRepo.findById(auth.userId);

  if (!user) {
    return context.json(
      {
        ok: false,
        error: {
          type: "UNAUTHORIZED",
          message: "User was not found",
        },
      },
      401,
    );
  }

  return context.json({
    ok: true,
    user: {
      id: user.id,
      timezone: user.timezone,
    },
  });
});

app.post("/v1/auth/logout", requireAuth, async (context) => {
  const auth = context.get("auth") as AuthContext;

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

  const sessionRepo = createAuthSessionRepository(context.env.DB);
  await sessionRepo.deleteSession(auth.sessionId);

  return context.json({ ok: true });
});

app.post("/v1/future-diary/draft", requireAuth, async (context) => {
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
  const auth = context.get("auth") as AuthContext;
  const userId = auth.userId;
  const date = parsed.data.date;
  const timezone = parsed.data.timezone;
  const safetyIdentifier = await sha256Hex(userId);

  const userRepo = createUserRepository(db);
  const diaryRepo = createDiaryRepository(db);
  const diaryRevisionRepo = createDiaryRevisionRepository(db);

  await userRepo.upsertUser({ id: userId, timezone });
  const user = await userRepo.findById(userId);
  const parsedModel = parseUserModelJson(user?.preferencesJson);
  const userModel = parsedModel.ok ? parsedModel.value : defaultUserModel;

  if (!parsedModel.ok) {
    console.warn("User model parse failed; falling back to default", {
      safetyIdentifier,
      errorType: parsedModel.error.type,
      message: parsedModel.error.message,
    });
  }

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
            userModel,
            userId,
            date,
            timezone,
            safetyIdentifier,
          });

          source = generated.source;
          const completed = await diaryRepo.completeDraftGeneration(userId, date, generated.draft.body);
          if (!completed) {
            throw new Error("Draft generation completed but could not be persisted");
          }

          entry = completed;

          try {
            await diaryRevisionRepo.appendRevision({
              id: crypto.randomUUID(),
              entryId: entry.id,
              kind: "generated",
              body: generated.draft.body,
            });
          } catch (error) {
            console.warn("Sync draft generation revision append failed", {
              safetyIdentifier,
              message: error instanceof Error ? error.message : String(error),
            });
          }

          const enqueueVectorize = await enqueueGenerationMessage(context.env, { kind: "vectorize_upsert", userId, date });

          if (!enqueueVectorize.ok) {
            const executionCtx = getOptionalExecutionContext(context);

            if (context.env.AI && context.env.VECTOR_INDEX && executionCtx?.waitUntil) {
              queueVectorizeUpsert({
                executionCtx,
                env: context.env,
                safetyIdentifier,
                userId,
                entry: {
                  id: entry.id,
                  date: entry.date,
                  text: entry.finalText ?? entry.generatedText,
                },
              });
            }
          }
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

app.get("/v1/user/model", requireAuth, async (context) => {
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
  const auth = context.get("auth") as AuthContext;

  const userRepo = createUserRepository(db);
  const user = await userRepo.findById(auth.userId);

  if (!user) {
    return context.json(
      {
        ok: false,
        error: { type: "UNAUTHORIZED", message: "User was not found" },
      },
      401,
    );
  }

  const parsed = parseUserModelJson(user.preferencesJson);

  return context.json({
    ok: true,
    model: parsed.ok ? parsed.value : defaultUserModel,
    parseError: parsed.ok ? null : parsed.error,
  });
});

app.post("/v1/user/model", requireAuth, async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = userModelUpdateRequestSchema.safeParse(payload);

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

  const auth = context.get("auth") as AuthContext;
  const userModel = parseUserModelInput(parsed.data.model);
  if (!userModel.ok) {
    return context.json(
      {
        ok: false,
        error: {
          type: userModel.error.type,
          message: userModel.error.message,
        },
      },
      400,
    );
  }

  const userRepo = createUserRepository(context.env.DB);
  const updated = await userRepo.setPreferencesJson(auth.userId, serializeUserModelJson(userModel.value));

  if (!updated) {
    return context.json(
      {
        ok: false,
        error: { type: "UNAUTHORIZED", message: "User was not found" },
      },
      401,
    );
  }

  return context.json({
    ok: true,
    model: userModel.value,
  });
});

app.post("/v1/user/model/reset", requireAuth, async (context) => {
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

  const auth = context.get("auth") as AuthContext;
  const userRepo = createUserRepository(context.env.DB);
  const updated = await userRepo.setPreferencesJson(auth.userId, "{}");

  if (!updated) {
    return context.json(
      {
        ok: false,
        error: { type: "UNAUTHORIZED", message: "User was not found" },
      },
      401,
    );
  }

  return context.json({ ok: true, model: defaultUserModel });
});

app.post("/v1/diary/entry/get", requireAuth, async (context) => {
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
  const auth = context.get("auth") as AuthContext;
  const userId = auth.userId;
  const diaryRepo = createDiaryRepository(db);
  const entry = await diaryRepo.findByUserAndDate(userId, parsed.data.date);

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

app.post("/v1/diary/entry/save", requireAuth, async (context) => {
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
  const auth = context.get("auth") as AuthContext;
  const userId = auth.userId;
  const diaryRepo = createDiaryRepository(db);
  const diaryRevisionRepo = createDiaryRevisionRepository(db);
  const entry = await diaryRepo.updateFinalText(userId, parsed.data.date, parsed.data.body);

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

  await diaryRevisionRepo.appendRevision({
    id: crypto.randomUUID(),
    entryId: entry.id,
    kind: "saved",
    body: parsed.data.body,
  });

  const enqueueVectorize = await enqueueGenerationMessage(context.env, {
    kind: "vectorize_upsert",
    userId,
    date: entry.date,
  });

  const executionCtx = getOptionalExecutionContext(context);

  if (!enqueueVectorize.ok && context.env.AI && context.env.VECTOR_INDEX && executionCtx?.waitUntil) {
    const safetyIdentifier = await sha256Hex(userId);

    queueVectorizeUpsert({
      executionCtx,
      env: context.env,
      safetyIdentifier,
      userId,
      entry: {
        id: entry.id,
        date: entry.date,
        text: entry.finalText ?? entry.generatedText,
      },
    });
  }

  return context.json({
    ok: true,
    entry,
    body: entry.finalText ?? entry.generatedText,
  });
});

app.post("/v1/diary/entry/confirm", requireAuth, async (context) => {
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
  const auth = context.get("auth") as AuthContext;
  const userId = auth.userId;
  const diaryRepo = createDiaryRepository(db);
  const diaryRevisionRepo = createDiaryRevisionRepository(db);

  const existing = await diaryRepo.findByUserAndDate(userId, parsed.data.date);

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

  const entry = await diaryRepo.confirmEntry(userId, parsed.data.date);

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

  await diaryRevisionRepo.appendRevision({
    id: crypto.randomUUID(),
    entryId: entry.id,
    kind: "confirmed",
    body: entry.finalText ?? entry.generatedText,
  });

  const enqueueVectorizeConfirm = await enqueueGenerationMessage(context.env, {
    kind: "vectorize_upsert",
    userId,
    date: entry.date,
  });

  const executionCtx = getOptionalExecutionContext(context);

  if (!enqueueVectorizeConfirm.ok && context.env.AI && context.env.VECTOR_INDEX && executionCtx?.waitUntil) {
    const safetyIdentifier = await sha256Hex(userId);

    queueVectorizeUpsert({
      executionCtx,
      env: context.env,
      safetyIdentifier,
      userId,
      entry: {
        id: entry.id,
        date: entry.date,
        text: entry.finalText ?? entry.generatedText,
      },
    });
  }

  return context.json({
    ok: true,
    entry,
    body: entry.finalText ?? entry.generatedText,
  });
});

app.post("/v1/diary/entries/list", requireAuth, async (context) => {
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
  const auth = context.get("auth") as AuthContext;
  const userId = auth.userId;
  const diaryRepo = createDiaryRepository(db);
  const entries = await diaryRepo.listRecentByUserOnOrBeforeDate(
    userId,
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

app.post("/v1/diary/entry/delete", requireAuth, async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = diaryEntryDeleteRequestSchema.safeParse(payload);

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

  const auth = context.get("auth") as AuthContext;
  const diaryRepo = createDiaryRepository(context.env.DB);
  const deleted = await diaryRepo.deleteByUserAndDate(auth.userId, parsed.data.date);

  return context.json({
    ok: true,
    deleted,
  });
});

app.post("/v1/user/delete", requireAuth, async (context) => {
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
  const auth = context.get("auth") as AuthContext;

  const diaryRepo = createDiaryRepository(db);
  const sessionRepo = createAuthSessionRepository(db);
  const userRepo = createUserRepository(db);

  await diaryRepo.deleteByUser(auth.userId);
  await sessionRepo.deleteByUserId(auth.userId);
  await userRepo.deleteUser(auth.userId);

  return context.json({ ok: true });
});

export { app };
export { DraftGenerationLock } from "./draftGenerationLock";
export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch<unknown>, env: WorkerBindings, ctx: ExecutionContext) => {
    await processGenerationQueueBatch(batch, env, ctx);
  },
};
