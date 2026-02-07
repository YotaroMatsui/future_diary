export interface HealthResponse {
  ok: boolean;
  env: string;
  service: string;
}

export const fetchHealth = async (baseUrl: string): Promise<HealthResponse> => {
  const response = await fetch(`${baseUrl}/health`);

  if (!response.ok) {
    throw new Error(`Failed to fetch health: ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toApiErrorMessage = (payload: unknown): string => {
  if (!isRecord(payload)) {
    return "Unexpected API response";
  }

  if (payload.ok === false) {
    if (Array.isArray(payload.errors)) {
      const issues = payload.errors
        .filter((issue) => isRecord(issue))
        .map((issue) => {
          const path = typeof issue.path === "string" ? issue.path : "(unknown)";
          const message = typeof issue.message === "string" ? issue.message : "invalid";
          return `${path}: ${message}`;
        })
        .filter((line) => line.length > 0);

      if (issues.length > 0) {
        return issues.join("\n");
      }
    }

    if (isRecord(payload.error)) {
      const type = typeof payload.error.type === "string" ? payload.error.type : "UNKNOWN";
      const message = typeof payload.error.message === "string" ? payload.error.message : "unknown error";
      return `${type}: ${message}`;
    }
  }

  return "Unexpected API error";
};

const postJson = async <TResponse>(url: string, payload: unknown): Promise<TResponse> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let json: unknown;
  try {
    json = (await response.json()) as unknown;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const details = toApiErrorMessage(json);
    throw new Error(`${response.status} ${response.statusText}\n${details}`.trim());
  }

  return json as TResponse;
};

export type DiaryStatus = "draft" | "confirmed";

export type DiaryEntry = {
  id: string;
  userId: string;
  date: string;
  status: DiaryStatus;
  generatedText: string;
  finalText: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FutureDiaryDraftResponse = {
  ok: true;
  draft: {
    title: string;
    body: string;
    sourceFragmentIds: readonly string[];
  };
  meta: {
    userId: string;
    entryId: string;
    status: DiaryStatus;
    cached: boolean;
    source: "llm" | "deterministic" | "fallback" | "cached";
  };
};

export const fetchFutureDiaryDraft = async (baseUrl: string, payload: { userId: string; date: string; timezone: string }) =>
  await postJson<FutureDiaryDraftResponse>(`${baseUrl}/v1/future-diary/draft`, payload);

export type DiaryEntryGetResponse = {
  ok: true;
  entry: DiaryEntry;
  body: string;
};

export const fetchDiaryEntry = async (baseUrl: string, payload: { userId: string; date: string }) =>
  await postJson<DiaryEntryGetResponse>(`${baseUrl}/v1/diary/entry/get`, payload);

export type DiaryEntrySaveResponse = {
  ok: true;
  entry: DiaryEntry;
  body: string;
};

export const saveDiaryEntry = async (baseUrl: string, payload: { userId: string; date: string; body: string }) =>
  await postJson<DiaryEntrySaveResponse>(`${baseUrl}/v1/diary/entry/save`, payload);

export type DiaryEntryConfirmResponse = {
  ok: true;
  entry: DiaryEntry;
  body: string;
};

export const confirmDiaryEntry = async (baseUrl: string, payload: { userId: string; date: string }) =>
  await postJson<DiaryEntryConfirmResponse>(`${baseUrl}/v1/diary/entry/confirm`, payload);

export type DiaryEntryWithBody = DiaryEntry & {
  body: string;
};

export type DiaryEntriesListResponse = {
  ok: true;
  entries: DiaryEntryWithBody[];
};

export const listDiaryEntries = async (
  baseUrl: string,
  payload: { userId: string; onOrBeforeDate?: string; limit?: number },
) => await postJson<DiaryEntriesListResponse>(`${baseUrl}/v1/diary/entries/list`, payload);
