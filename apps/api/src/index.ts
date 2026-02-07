import {
  buildFallbackFutureDiaryDraft,
  buildFutureDiaryDraft,
  buildFutureDiaryDraftLlmSystemPrompt,
  buildFutureDiaryDraftLlmUserPrompt,
  futureDiaryDraftBodyJsonSchema,
} from "@future-diary/core";
import { createDiaryRepository, createUserRepository } from "@future-diary/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { requestOpenAiStructuredOutputText } from "./openaiResponses";

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
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
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

  const sourceEntries = await diaryRepo.listRecentByUserBeforeDate(userId, date, 10);
  const recentFragments = sourceEntries.map((entry, index) => ({
    id: entry.id,
    date: entry.date,
    relevance: 1 - index / Math.max(sourceEntries.length, 1),
    text: entry.finalText ?? entry.generatedText,
  }));

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
    const safetyIdentifier = await sha256Hex(userId);
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
export default {
  fetch: app.fetch,
};
