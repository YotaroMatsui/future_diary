import {
  buildFallbackFutureDiaryDraft,
  buildFutureDiaryDraft,
  buildFutureDiaryDraftLlmSystemPrompt,
  buildFutureDiaryDraftLlmUserPrompt,
  futureDiaryDraftBodyJsonSchema,
} from "@future-diary/core";
import { createAuthSessionRepository, createDiaryRepository, createUserRepository } from "@future-diary/db";
import { createWorkersAiVectorizeSearchPort, searchRelevantFragments } from "@future-diary/vector";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { requestOpenAiStructuredOutputText } from "./openaiResponses";
import {
  buildVectorSearchQuery,
  getOptionalExecutionContext,
  getWorkersAiEmbeddingModel,
  mergeFragments,
  queueVectorizeUpsert,
  queueVectorizeUpsertMany,
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

const defaultStyleHints = {
  openingPhrases: ["今日は無理をせず、少しずつ整えていく一日にしたい。"],
  closingPhrases: ["夜に事実を追記して、確定日記にする。"],
  maxParagraphs: 2,
} as const;

const futureDiaryDraftBodySchema = z.object({
  body: z.string().trim().min(1),
});

const truncateForPrompt = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : text.slice(0, maxChars) + "...";

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

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
  const executionCtx = getOptionalExecutionContext(context);

  const userRepo = createUserRepository(db);
  const diaryRepo = createDiaryRepository(db);

  await userRepo.upsertUser({ id: userId, timezone });

  const existingEntry = await diaryRepo.findByUserAndDate(userId, date);
  if (existingEntry) {
    return context.json({
      ok: true,
      draft: {
        title: `${date} の未来日記`,
        body: existingEntry.finalText ?? existingEntry.generatedText,
        sourceFragmentIds: [],
      },
      meta: {
        userId,
        entryId: existingEntry.id,
        status: existingEntry.status,
        cached: true,
        source: "cached",
      },
    });
  }

  const sourceEntries = await diaryRepo.listRecentByUserBeforeDate(userId, date, 20);
  const fallbackFragments = sourceEntries.map((entry, index) => ({
    id: entry.id,
    date: entry.date,
    relevance: 1 - index / Math.max(sourceEntries.length, 1),
    text: entry.finalText ?? entry.generatedText,
  }));

  queueVectorizeUpsertMany({
    executionCtx,
    env: context.env,
    safetyIdentifier,
    userId,
    entries: sourceEntries.slice(0, 5).map((entry) => ({
      id: entry.id,
      date: entry.date,
      text: entry.finalText ?? entry.generatedText,
    })),
  });

  let recentFragments: readonly (typeof fallbackFragments)[number][] = fallbackFragments;

  if (context.env.AI && context.env.VECTOR_INDEX) {
    const query = buildVectorSearchQuery(sourceEntries);

    if (query) {
      try {
        const port = createWorkersAiVectorizeSearchPort({
          ai: context.env.AI,
          embeddingModel: getWorkersAiEmbeddingModel(context.env),
          vectorIndex: context.env.VECTOR_INDEX,
        });

        const vectorFragments = await searchRelevantFragments(port, {
          userId,
          query,
          topK: 10,
          beforeDate: date,
        });

        recentFragments = mergeFragments(vectorFragments, fallbackFragments, 10);
      } catch (error) {
        console.warn("Vectorize retrieval failed; falling back to recency fragments", {
          safetyIdentifier,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const llmFragments = recentFragments.slice(0, 5).map((fragment) => ({
    ...fragment,
    text: truncateForPrompt(fragment.text, 600),
  }));

  let draftSource: "llm" | "deterministic" | "fallback" = "deterministic";
  let draft: { title: string; body: string; sourceFragmentIds: readonly string[] } | null = null;

  const openAiApiKey = context.env.OPENAI_API_KEY;
  const openAiBaseUrl = context.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const openAiModel = context.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (openAiApiKey) {
    const systemPrompt = buildFutureDiaryDraftLlmSystemPrompt();
    const userPrompt = buildFutureDiaryDraftLlmUserPrompt({
      date,
      userTimezone: timezone,
      recentFragments: llmFragments,
      styleHints: defaultStyleHints,
    });

    const llmResult = await requestOpenAiStructuredOutputText({
      fetcher: fetch,
      baseUrl: openAiBaseUrl,
      apiKey: openAiApiKey,
      model: openAiModel,
      systemPrompt,
      userPrompt,
      jsonSchemaName: "future_diary_draft_body",
      jsonSchema: futureDiaryDraftBodyJsonSchema,
      timeoutMs: 12_000,
      maxOutputTokens: 700,
      temperature: 0.7,
      safetyIdentifier,
    });

    if (!llmResult.ok) {
      console.warn("OpenAI draft generation failed", {
        safetyIdentifier,
        error: llmResult.error,
      });
    } else {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(llmResult.value) as unknown;
      } catch {
        console.warn("OpenAI output_text was not valid JSON", {
          safetyIdentifier,
          length: llmResult.value.length,
        });
        parsedJson = null;
      }

      const parsedBody = futureDiaryDraftBodySchema.safeParse(parsedJson);
      if (!parsedBody.success) {
        console.warn("OpenAI JSON output did not match schema", {
          safetyIdentifier,
          issues: parsedBody.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
        });
      } else {
        draftSource = "llm";
        draft = {
          title: `${date} の未来日記`,
          body: parsedBody.data.body,
          sourceFragmentIds: llmFragments.map((fragment) => fragment.id),
        };
      }
    }
  }

  if (draft === null) {
    const draftResult = buildFutureDiaryDraft({
      date,
      userTimezone: timezone,
      recentFragments,
      styleHints: defaultStyleHints,
    });

    if (draftResult.ok) {
      draftSource = "deterministic";
      draft = draftResult.value;
    } else if (draftResult.error.type === "NO_SOURCE") {
      draftSource = "fallback";
      draft = buildFallbackFutureDiaryDraft({ date, styleHints: defaultStyleHints });
    } else {
      return context.json(
        {
          ok: false,
          error: draftResult.error,
        },
        500,
      );
    }
  }

  const newEntryId = crypto.randomUUID();
  await diaryRepo.createDraftIfMissing({
    id: newEntryId,
    userId,
    date,
    generatedText: draft.body,
  });

  const persistedEntry = await diaryRepo.findByUserAndDate(userId, date);
  if (!persistedEntry) {
    return context.json(
      {
        ok: false,
        error: {
          type: "PERSIST_FAILED",
          message: "Draft was generated but could not be persisted",
        },
      },
      500,
    );
  }

  const inserted = persistedEntry.id === newEntryId;

  queueVectorizeUpsert({
    executionCtx,
    env: context.env,
    safetyIdentifier,
    userId,
    entry: {
      id: persistedEntry.id,
      date: persistedEntry.date,
      text: persistedEntry.finalText ?? persistedEntry.generatedText,
    },
  });

  return context.json({
    ok: true,
    draft: {
      title: `${date} の未来日記`,
      body: persistedEntry.finalText ?? persistedEntry.generatedText,
      sourceFragmentIds: inserted ? draft.sourceFragmentIds : [],
    },
    meta: {
      userId,
      entryId: persistedEntry.id,
      status: persistedEntry.status,
      cached: !inserted,
      source: inserted ? draftSource : "cached",
    },
  });
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

  const executionCtx = getOptionalExecutionContext(context);

  if (context.env.AI && context.env.VECTOR_INDEX && executionCtx?.waitUntil) {
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

  const executionCtx = getOptionalExecutionContext(context);

  if (context.env.AI && context.env.VECTOR_INDEX && executionCtx?.waitUntil) {
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
export default {
  fetch: app.fetch,
};
