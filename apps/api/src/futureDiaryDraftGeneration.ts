import {
  buildFallbackFutureDiaryDraft,
  buildFutureDiaryDraft,
  buildFutureDiaryDraftLlmSystemPrompt,
  buildFutureDiaryDraftLlmUserPrompt,
  futureDiaryDraftBodyJsonSchema,
} from "@future-diary/core";
import type { DiaryRepository } from "@future-diary/db";
import { createWorkersAiVectorizeSearchPort, searchRelevantFragments } from "@future-diary/vector";
import { z } from "zod";
import { requestOpenAiStructuredOutputText } from "./openaiResponses";
import { buildVectorSearchQuery, getWorkersAiEmbeddingModel, mergeFragments } from "./vectorize";

type VectorizeBindings = {
  AI?: Ai;
  VECTOR_INDEX?: Vectorize;
  AI_EMBEDDING_MODEL?: string;
};

type OpenAiBindings = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
};

export type DraftGenerationEnv = VectorizeBindings & OpenAiBindings;

export type DraftGenerationSource = "llm" | "deterministic" | "fallback";

export type GeneratedDraft = {
  source: DraftGenerationSource;
  draft: {
    title: string;
    body: string;
    sourceFragmentIds: readonly string[];
  };
  sourceEntriesToIndex: readonly { id: string; date: string; text: string }[];
};

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

export const generateFutureDiaryDraft = async (params: {
  env: DraftGenerationEnv;
  diaryRepo: DiaryRepository;
  userId: string;
  date: string;
  timezone: string;
  safetyIdentifier: string;
}): Promise<GeneratedDraft> => {
  const userId = params.userId;
  const date = params.date;
  const timezone = params.timezone;
  const diaryRepo = params.diaryRepo;

  const sourceEntries = await diaryRepo.listRecentByUserBeforeDate(userId, date, 20);
  const sourceEntriesToIndex = sourceEntries.slice(0, 5).map((entry) => ({
    id: entry.id,
    date: entry.date,
    text: entry.finalText ?? entry.generatedText,
  }));

  const fallbackFragments = sourceEntries.map((entry, index) => ({
    id: entry.id,
    date: entry.date,
    relevance: 1 - index / Math.max(sourceEntries.length, 1),
    text: entry.finalText ?? entry.generatedText,
  }));

  let recentFragments: readonly (typeof fallbackFragments)[number][] = fallbackFragments;

  if (params.env.AI && params.env.VECTOR_INDEX) {
    const query = buildVectorSearchQuery(sourceEntries);

    if (query) {
      try {
        const port = createWorkersAiVectorizeSearchPort({
          ai: params.env.AI,
          embeddingModel: getWorkersAiEmbeddingModel(params.env),
          vectorIndex: params.env.VECTOR_INDEX,
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
          safetyIdentifier: params.safetyIdentifier,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const llmFragments = recentFragments.slice(0, 5).map((fragment) => ({
    ...fragment,
    text: truncateForPrompt(fragment.text, 600),
  }));

  let source: DraftGenerationSource = "deterministic";
  let draft: { title: string; body: string; sourceFragmentIds: readonly string[] } | null = null;

  const openAiApiKey = params.env.OPENAI_API_KEY;
  const openAiBaseUrl = params.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const openAiModel = params.env.OPENAI_MODEL ?? "gpt-4o-mini";

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
      safetyIdentifier: params.safetyIdentifier,
    });

    if (!llmResult.ok) {
      console.warn("OpenAI draft generation failed", {
        safetyIdentifier: params.safetyIdentifier,
        error: llmResult.error,
      });
    } else {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(llmResult.value) as unknown;
      } catch {
        console.warn("OpenAI output_text was not valid JSON", {
          safetyIdentifier: params.safetyIdentifier,
          length: llmResult.value.length,
        });
        parsedJson = null;
      }

      const parsedBody = futureDiaryDraftBodySchema.safeParse(parsedJson);
      if (!parsedBody.success) {
        console.warn("OpenAI JSON output did not match schema", {
          safetyIdentifier: params.safetyIdentifier,
          issues: parsedBody.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
        });
      } else {
        source = "llm";
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
      source = "deterministic";
      draft = draftResult.value;
    } else if (draftResult.error.type === "NO_SOURCE") {
      source = "fallback";
      draft = buildFallbackFutureDiaryDraft({ date, styleHints: defaultStyleHints });
    } else {
      // invalid style hints etc: treat as unexpected but expose as error to retry.
      throw new Error(draftResult.error.message);
    }
  }

  return {
    source,
    draft,
    sourceEntriesToIndex,
  };
};

