import {
  buildFallbackFutureDiaryDraft,
  buildFutureDiaryDraft,
  buildFutureDiaryDraftLlmSystemPrompt,
  buildFutureDiaryDraftLlmUserPrompt,
  futureDiaryDraftBodyJsonSchema,
} from "@future-diary/core";
import { createDiaryRepository, createUserRepository } from "@future-diary/db";
import { Hono } from "hono";
import { z } from "zod";
import { requestOpenAiStructuredOutputText } from "./openaiResponses";

const draftRequestSchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).default("Asia/Tokyo"),
});

type WorkerBindings = {
  APP_ENV?: string;
  DB?: D1Database;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
};

const app = new Hono<{ Bindings: WorkerBindings }>();

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
        body: existingEntry.generatedText,
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
      body: persistedEntry.generatedText,
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

export { app };

export default {
  fetch: app.fetch,
};
