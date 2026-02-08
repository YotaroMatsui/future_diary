import type { GenerationQueueMessage } from "./queueMessages";

export type QueueProducerBindings = {
  GENERATION_QUEUE?: Queue<GenerationQueueMessage>;
};

export const enqueueGenerationMessage = async (
  env: QueueProducerBindings,
  message: GenerationQueueMessage,
): Promise<{ ok: true } | { ok: false; reason: "MISSING_QUEUE" | "SEND_FAILED"; message: string }> => {
  if (!env.GENERATION_QUEUE) {
    return { ok: false, reason: "MISSING_QUEUE", message: "Queue binding 'GENERATION_QUEUE' is required" };
  }

  try {
    await env.GENERATION_QUEUE.send(message);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "SEND_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

