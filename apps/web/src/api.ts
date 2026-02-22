export interface HealthResponse {
  ok: boolean;
  env: string;
  service: string;
}

const isLikelyLocalApiUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  return parsed.port === "8787" && (hostname === "127.0.0.1" || hostname === "localhost");
};

const toNetworkErrorMessage = (url: string, error: unknown): string => {
  const reason = error instanceof Error ? error.message : "Network request failed";
  if (!isLikelyLocalApiUrl(url)) {
    return reason;
  }

  return [
    reason,
    `Request URL: ${url}`,
    "Local API is unreachable. Run `make dev-api` and confirm `http://127.0.0.1:8787/health`.",
  ].join("\n");
};

export const fetchHealth = async (baseUrl: string): Promise<HealthResponse> => {
  const url = `${baseUrl}/health`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(toNetworkErrorMessage(url, error));
  }

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

type RequestOptions = {
  accessToken?: string;
};

const buildAuthHeaders = (options?: RequestOptions): Record<string, string> => {
  if (!options?.accessToken) {
    return {};
  }

  return {
    authorization: `Bearer ${options.accessToken}`,
  };
};

const postJson = async <TResponse>(url: string, payload: unknown, options?: RequestOptions): Promise<TResponse> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...buildAuthHeaders(options),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(toNetworkErrorMessage(url, error));
  }

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

const getJson = async <TResponse>(url: string, options?: RequestOptions): Promise<TResponse> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: buildAuthHeaders(options),
    });
  } catch (error) {
    throw new Error(toNetworkErrorMessage(url, error));
  }

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

export type DraftGenerationStatus = "created" | "processing" | "failed" | "completed";

export type DiaryEntry = {
  id: string;
  userId: string;
  date: string;
  status: DiaryStatus;
  generationStatus: DraftGenerationStatus;
  generationError: string | null;
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
    keywords: readonly string[];
  };
  meta: {
    userId: string;
    entryId: string;
    status: DiaryStatus;
    generationStatus: DraftGenerationStatus;
    generationError: string | null;
    cached: boolean;
    source: "llm" | "deterministic" | "fallback" | "cached" | "queued";
    generation?: {
      source: "llm" | "deterministic" | "fallback" | null;
      userModel: UserModel | null;
      keywords: readonly string[];
      sourceFragmentIds: readonly string[];
    };
    pollAfterMs: number;
  };
};

export const fetchFutureDiaryDraft = async (
  baseUrl: string,
  accessToken: string,
  payload: { date: string; timezone: string },
) => await postJson<FutureDiaryDraftResponse>(`${baseUrl}/v1/future-diary/draft`, payload, { accessToken });

export type AuthSessionCreateResponse = {
  ok: true;
  deprecated?: boolean;
  accessToken: string;
  user: {
    id: string;
    timezone: string;
    authProvider?: "legacy" | "google";
  };
  session?: {
    kind: "legacy" | "google";
    expiresAt: string | null;
  };
};

export const createAuthSession = async (baseUrl: string, payload: { timezone: string }) =>
  await postJson<AuthSessionCreateResponse>(`${baseUrl}/v1/auth/session`, payload);

export type GoogleAuthStartResponse = {
  ok: true;
  authorizationUrl: string;
  stateExpiresAt: string;
};

export const startGoogleAuth = async (baseUrl: string, payload: { redirectUri: string }) =>
  await postJson<GoogleAuthStartResponse>(`${baseUrl}/v1/auth/google/start`, payload);

export type GoogleAuthExchangeResponse = {
  ok: true;
  accessToken: string;
  user: {
    id: string;
    timezone: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    authProvider: "google";
  };
  session: {
    kind: "google";
    expiresAt: string;
  };
  migrated: boolean;
};

export const exchangeGoogleAuth = async (
  baseUrl: string,
  payload: {
    code: string;
    state: string;
    redirectUri: string;
    timezone: string;
    legacyAccessToken?: string;
  },
) => await postJson<GoogleAuthExchangeResponse>(`${baseUrl}/v1/auth/google/exchange`, payload);

export type AuthMeResponse = {
  ok: true;
  user: {
    id: string;
    timezone: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    authProvider: "legacy" | "google";
    migrationRequired: boolean;
  };
  session: {
    kind: "legacy" | "google";
    expiresAt: string | null;
  };
};

export const fetchAuthMe = async (baseUrl: string, accessToken: string) =>
  await getJson<AuthMeResponse>(`${baseUrl}/v1/auth/me`, { accessToken });

export type UserModel = {
  version: 1;
  intent: string;
  styleHints: {
    openingPhrases: readonly string[];
    closingPhrases: readonly string[];
    maxParagraphs: number;
  };
  preferences: {
    avoidCopyingFromFragments: boolean;
  };
};

export type UserModelGetResponse = {
  ok: true;
  model: UserModel;
  parseError: { type: string; message: string } | null;
};

export const fetchUserModel = async (baseUrl: string, accessToken: string) =>
  await getJson<UserModelGetResponse>(`${baseUrl}/v1/user/model`, { accessToken });

export type UserModelUpdateResponse = {
  ok: true;
  model: UserModel;
};

export const updateUserModel = async (baseUrl: string, accessToken: string, model: UserModel) =>
  await postJson<UserModelUpdateResponse>(`${baseUrl}/v1/user/model`, { model }, { accessToken });

export type UserModelResetResponse = {
  ok: true;
  model: UserModel;
};

export const resetUserModel = async (baseUrl: string, accessToken: string) =>
  await postJson<UserModelResetResponse>(`${baseUrl}/v1/user/model/reset`, {}, { accessToken });

export const logout = async (baseUrl: string, accessToken: string) =>
  await postJson<{ ok: true }>(`${baseUrl}/v1/auth/logout`, {}, { accessToken });

export type DiaryEntryGetResponse = {
  ok: true;
  entry: DiaryEntry;
  body: string;
};

export const fetchDiaryEntry = async (baseUrl: string, accessToken: string, payload: { date: string }) =>
  await postJson<DiaryEntryGetResponse>(`${baseUrl}/v1/diary/entry/get`, payload, { accessToken });

export type DiaryEntrySaveResponse = {
  ok: true;
  entry: DiaryEntry;
  body: string;
};

export const saveDiaryEntry = async (baseUrl: string, accessToken: string, payload: { date: string; body: string }) =>
  await postJson<DiaryEntrySaveResponse>(`${baseUrl}/v1/diary/entry/save`, payload, { accessToken });

export type DiaryEntryConfirmResponse = {
  ok: true;
  entry: DiaryEntry;
  body: string;
};

export const confirmDiaryEntry = async (baseUrl: string, accessToken: string, payload: { date: string }) =>
  await postJson<DiaryEntryConfirmResponse>(`${baseUrl}/v1/diary/entry/confirm`, payload, { accessToken });

export type DiaryEntryWithBody = DiaryEntry & {
  body: string;
};

export type DiaryEntriesListResponse = {
  ok: true;
  entries: DiaryEntryWithBody[];
};

export const listDiaryEntries = async (
  baseUrl: string,
  accessToken: string,
  payload: { onOrBeforeDate?: string; limit?: number },
) => await postJson<DiaryEntriesListResponse>(`${baseUrl}/v1/diary/entries/list`, payload, { accessToken });

export type DiaryEntryDeleteResponse = {
  ok: true;
  deleted: boolean;
};

export const deleteDiaryEntry = async (baseUrl: string, accessToken: string, payload: { date: string }) =>
  await postJson<DiaryEntryDeleteResponse>(`${baseUrl}/v1/diary/entry/delete`, payload, { accessToken });

export const deleteUser = async (baseUrl: string, accessToken: string) =>
  await postJson<{ ok: true }>(`${baseUrl}/v1/user/delete`, {}, { accessToken });
