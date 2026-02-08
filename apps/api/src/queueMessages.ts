export type GenerationQueueMessage =
  | {
      kind: "future_draft_generate";
      userId: string;
      date: string;
      timezone: string;
    }
  | {
      kind: "vectorize_upsert";
      userId: string;
      date: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const isGenerationQueueMessage = (value: unknown): value is GenerationQueueMessage => {
  if (!isRecord(value)) {
    return false;
  }

  const kind = value.kind;
  if (kind === "future_draft_generate") {
    return typeof value.userId === "string" && typeof value.date === "string" && typeof value.timezone === "string";
  }

  if (kind === "vectorize_upsert") {
    return typeof value.userId === "string" && typeof value.date === "string";
  }

  return false;
};

