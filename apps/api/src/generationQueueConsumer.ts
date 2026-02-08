import { createDiaryRepository, createDiaryRevisionRepository, createUserRepository } from "@future-diary/db";
import { upsertVectorizeSearchDocumentsWithWorkersAi } from "@future-diary/vector";
import { acquireDraftGenerationLock, releaseDraftGenerationLock } from "./draftGenerationLock";
import { generateFutureDiaryDraft } from "./futureDiaryDraftGeneration";
import { isGenerationQueueMessage, type GenerationQueueMessage } from "./queueMessages";
import { enqueueGenerationMessage, type QueueProducerBindings } from "./queueProducer";
import { sha256Hex } from "./safetyIdentifier";
import { getWorkersAiEmbeddingModel } from "./vectorize";

export type GenerationQueueConsumerEnv = QueueProducerBindings & {
  APP_ENV?: string;
  DB?: D1Database;
  AI?: Ai;
  VECTOR_INDEX?: Vectorize;
  AI_EMBEDDING_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  GENERATION_LOCK?: DurableObjectNamespace;
};

const lockKeyForDraft = (userId: string, date: string): string => `draft:${userId}:${date}`;

const truncateErrorMessage = (message: string, maxChars: number): string =>
  message.length <= maxChars ? message : message.slice(0, maxChars) + "...";

const isRetryableError = (error: unknown): boolean => {
  // Keep it simple: almost all failures here are transient (network/AI/Vectorize).
  // We still cap attempts in the queue consumer.
  if (error instanceof Error) {
    return true;
  }

  return typeof error === "string";
};

const retryMessage = (message: { retry: (opts?: { delaySeconds?: number }) => void }, delaySeconds: number): void => {
  try {
    message.retry({ delaySeconds });
  } catch {
    message.retry();
  }
};

const getAttemptCount = (message: unknown): number => {
  const maybe = message as { attempts?: unknown; deliveryCount?: unknown };
  const attempts = typeof maybe.attempts === "number" ? maybe.attempts : null;
  const deliveryCount = typeof maybe.deliveryCount === "number" ? maybe.deliveryCount : null;
  const derived = attempts ?? deliveryCount;
  return typeof derived === "number" && Number.isFinite(derived) ? derived : 1;
};

const processFutureDraftGenerate = async (params: {
  env: GenerationQueueConsumerEnv;
  message: GenerationQueueMessage & { kind: "future_draft_generate" };
  rawMessage: unknown;
}): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> => {
  const env = params.env;
  if (!env.DB) {
    throw new Error("D1 binding 'DB' is required");
  }

  const db = env.DB;
  const diaryRepo = createDiaryRepository(db);
  const diaryRevisionRepo = createDiaryRevisionRepository(db);
  const userRepo = createUserRepository(db);

  const userId = params.message.userId;
  const date = params.message.date;
  const timezone = params.message.timezone;
  const safetyIdentifier = await sha256Hex(userId);

  await userRepo.upsertUser({ id: userId, timezone });

  // Ensure an entry row exists so the API can poll status.
  await diaryRepo.createDraftGenerationPlaceholderIfMissing({ id: crypto.randomUUID(), userId, date });
  const existing = await diaryRepo.findByUserAndDate(userId, date);
  if (!existing) {
    throw new Error("Draft placeholder could not be persisted");
  }

  if (existing.generationStatus === "completed") {
    return { ok: true };
  }

  const lockKey = lockKeyForDraft(userId, date);
  const acquired = await acquireDraftGenerationLock({ env, key: lockKey, ttlMs: 10 * 60_000 });

  if (!acquired.ok) {
    console.warn("Draft generation lock acquire failed", { safetyIdentifier, message: acquired.message });
    return { ok: false, retryAfterSeconds: 10 };
  }

  if (!acquired.acquired) {
    return { ok: false, retryAfterSeconds: Math.max(5, Math.ceil((acquired.lockedUntilMs - Date.now()) / 1000)) };
  }

  try {
    await diaryRepo.markDraftGenerationProcessing(userId, date);

    const refreshed = await diaryRepo.findByUserAndDate(userId, date);
    if (refreshed?.generationStatus === "completed") {
      return { ok: true };
    }

    // Keep Vectorize index warm: enqueue upsert for a few recent entries (best-effort).
    const sourceEntries = await diaryRepo.listRecentByUserBeforeDate(userId, date, 5);
    for (const entry of sourceEntries) {
      await enqueueGenerationMessage(env, { kind: "vectorize_upsert", userId, date: entry.date });
    }

    const generated = await generateFutureDiaryDraft({
      env,
      diaryRepo,
      userId,
      date,
      timezone,
      safetyIdentifier,
    });

    const completed = await diaryRepo.completeDraftGeneration(userId, date, generated.draft.body);
    if (!completed) {
      throw new Error("Draft generation completed but could not be persisted");
    }

    try {
      await diaryRevisionRepo.appendRevision({
        id: crypto.randomUUID(),
        entryId: completed.id,
        kind: "generated",
        body: generated.draft.body,
      });
    } catch (error) {
      console.warn("Draft generation revision append failed", {
        safetyIdentifier,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    // Index the generated entry body in the background.
    await enqueueGenerationMessage(env, { kind: "vectorize_upsert", userId, date });

    return { ok: true };
  } catch (error) {
    const attempt = getAttemptCount(params.rawMessage);
    const retryable = isRetryableError(error);
    const maxAttempts = 5;

    const message = truncateErrorMessage(error instanceof Error ? error.message : String(error), 400);

    if (retryable && attempt < maxAttempts) {
      console.warn("Draft generation failed; scheduling retry", { safetyIdentifier, attempt, message });
      await diaryRepo.markDraftGenerationCreatedWithError(userId, date, message);
      return { ok: false, retryAfterSeconds: Math.min(60, 5 * attempt) };
    }

    console.warn("Draft generation failed; giving up", { safetyIdentifier, attempt, message });
    await diaryRepo.markDraftGenerationFailed(userId, date, message);
    return { ok: true };
  } finally {
    await releaseDraftGenerationLock({ env, key: lockKey });
  }
};

const processVectorizeUpsert = async (params: {
  env: GenerationQueueConsumerEnv;
  message: GenerationQueueMessage & { kind: "vectorize_upsert" };
  rawMessage: unknown;
}): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> => {
  const env = params.env;
  if (!env.DB) {
    throw new Error("D1 binding 'DB' is required");
  }

  if (!env.AI || !env.VECTOR_INDEX) {
    return { ok: true };
  }

  const db = env.DB;
  const diaryRepo = createDiaryRepository(db);

  const userId = params.message.userId;
  const date = params.message.date;
  const safetyIdentifier = await sha256Hex(userId);

  const entry = await diaryRepo.findByUserAndDate(userId, date);
  if (!entry) {
    return { ok: true };
  }

  const text = (entry.finalText ?? entry.generatedText).trim();
  if (text.length === 0) {
    return { ok: true };
  }

  try {
    await upsertVectorizeSearchDocumentsWithWorkersAi({
      ai: env.AI,
      embeddingModel: getWorkersAiEmbeddingModel(env),
      vectorIndex: env.VECTOR_INDEX,
      namespace: userId,
      documents: [{ id: entry.id, date: entry.date, text }],
    });
    return { ok: true };
  } catch (error) {
    const attempt = getAttemptCount(params.rawMessage);
    const message = truncateErrorMessage(error instanceof Error ? error.message : String(error), 200);

    console.warn("Vectorize upsert failed", { safetyIdentifier, attempt, entryId: entry.id, date, message });

    if (attempt < 5) {
      return { ok: false, retryAfterSeconds: Math.min(60, 5 * attempt) };
    }

    return { ok: true };
  }
};

export const processGenerationQueueBatch = async (
  batch: MessageBatch<unknown>,
  env: GenerationQueueConsumerEnv,
  _ctx: ExecutionContext,
): Promise<void> => {
  for (const rawMessage of batch.messages) {
    const message = rawMessage as {
      body: unknown;
      ack: () => void;
      retry: (opts?: { delaySeconds?: number }) => void;
    };

    const body = message.body;
    if (!isGenerationQueueMessage(body)) {
      message.ack();
      continue;
    }

    try {
      const result =
        body.kind === "future_draft_generate"
          ? await processFutureDraftGenerate({ env, message: body, rawMessage })
          : await processVectorizeUpsert({ env, message: body, rawMessage });

      if (result.ok) {
        message.ack();
      } else {
        retryMessage(message, result.retryAfterSeconds);
      }
    } catch {
      const attempt = getAttemptCount(rawMessage);
      if (attempt < 5) {
        retryMessage(message, Math.min(60, 5 * attempt));
      } else {
        message.ack();
      }
    }
  }
};
