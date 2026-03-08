import {
  createGoogleCalendarConnectionRepository,
  type GoogleCalendarConnection,
  type GoogleCalendarConnectionRepository,
} from "@future-diary/db";

const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleCalendarApiBase = "https://www.googleapis.com/calendar/v3";
const googleCalendarListEndpoint = `${googleCalendarApiBase}/users/me/calendarList`;
const defaultCalendarScope = "https://www.googleapis.com/auth/calendar.readonly";
const maxCalendarsToFetch = 64;

export class GoogleCalendarError extends Error {
  readonly type: string;
  readonly status: number;

  constructor(type: string, message: string, status = 502) {
    super(message);
    this.name = "GoogleCalendarError";
    this.type = type;
    this.status = status;
  }
}

export type GoogleCalendarBindings = {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEventItem = {
  status?: string;
  summary?: string;
  location?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
  };
};

type GoogleCalendarListItem = {
  id?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  accessRole?: string;
};

type GoogleCalendarListResponse = {
  items?: GoogleCalendarListItem[];
  nextPageToken?: string;
};

type GoogleApiErrorReason = {
  reason?: string;
  message?: string;
};

type GoogleApiErrorDetail = {
  reason?: string;
  metadata?: {
    service?: string;
  };
};

type GoogleApiErrorResponse = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: GoogleApiErrorReason[];
    details?: GoogleApiErrorDetail[];
  };
};

const parseIsoDate = (isoDate: string): { year: number; month: number; day: number } | null => {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
};

const shiftIsoDate = (isoDate: string, days: number): string | null => {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    return null;
  }

  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return shifted.toISOString().slice(0, 10);
};

const buildDateWindow = (date: string): { timeMin: string; timeMax: string } => {
  const prevDate = shiftIsoDate(date, -1);
  const nextNextDate = shiftIsoDate(date, 2);
  if (!prevDate || !nextNextDate) {
    return {
      timeMin: `${date}T00:00:00.000Z`,
      timeMax: `${date}T23:59:59.999Z`,
    };
  }

  return {
    timeMin: `${prevDate}T00:00:00.000Z`,
    timeMax: `${nextNextDate}T00:00:00.000Z`,
  };
};

const assertGoogleClientId = (env: GoogleCalendarBindings): string => {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    throw new GoogleCalendarError("MISSING_BINDING", "GOOGLE_OAUTH_CLIENT_ID is required", 500);
  }

  return clientId;
};

const parseTokenResponse = async (response: Response): Promise<GoogleTokenResponse> => {
  return (await response.json().catch(() => null)) as GoogleTokenResponse;
};

const toTokenExpiryIso = (expiresInSeconds: number | undefined): string => {
  const seconds = typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
    ? expiresInSeconds
    : 3600;

  return new Date(Date.now() + seconds * 1000).toISOString();
};

const parseGoogleApiErrorResponse = async (response: Response): Promise<GoogleApiErrorResponse | null> => {
  return (await response.json().catch(() => null)) as GoogleApiErrorResponse | null;
};

const isCalendarApiDisabledError = (status: number, error: GoogleApiErrorResponse | null): boolean => {
  if (status !== 403) {
    return false;
  }

  const reason = error?.error?.errors?.find((item) => item.reason?.trim())?.reason?.trim();
  if (reason === "accessNotConfigured") {
    return true;
  }

  const details = error?.error?.details ?? [];
  return details.some(
    (detail) => detail.reason === "SERVICE_DISABLED" && detail.metadata?.service === "calendar-json.googleapis.com",
  );
};

const toGoogleApiErrorMessage = (fallback: string, error: GoogleApiErrorResponse | null): string => {
  const apiMessage = error?.error?.message?.trim();
  return apiMessage && apiMessage.length > 0 ? apiMessage : fallback;
};

const throwGoogleCalendarFetchError = (params: {
  status: number;
  fallbackMessage: string;
  error: GoogleApiErrorResponse | null;
}): never => {
  if (isCalendarApiDisabledError(params.status, params.error)) {
    throw new GoogleCalendarError(
      "GOOGLE_CALENDAR_API_DISABLED",
      toGoogleApiErrorMessage(
        "Google Calendar API is disabled for the configured Google Cloud project. Enable calendar-json.googleapis.com.",
        params.error,
      ),
      502,
    );
  }

  throw new GoogleCalendarError(
    "GOOGLE_CALENDAR_FETCH_FAILED",
    toGoogleApiErrorMessage(params.fallbackMessage, params.error),
    params.status === 401 ? 401 : 502,
  );
};

export const exchangeGoogleCalendarAuthorizationCode = async (params: {
  env: GoogleCalendarBindings;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string;
  scope: string;
}> => {
  const clientId = assertGoogleClientId(params.env);
  const clientSecret = params.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

  const body = new URLSearchParams();
  body.set("code", params.code);
  body.set("client_id", clientId);
  body.set("redirect_uri", params.redirectUri);
  body.set("grant_type", "authorization_code");
  body.set("code_verifier", params.codeVerifier);

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(googleTokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (error) {
    throw new GoogleCalendarError(
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
      error instanceof Error ? error.message : "Google token exchange request failed",
      502,
    );
  }

  const tokenJson = await parseTokenResponse(tokenResponse);
  if (!tokenResponse.ok) {
    throw new GoogleCalendarError(
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
      tokenJson.error_description ?? `Google token exchange failed (${tokenResponse.status})`,
      401,
    );
  }

  const accessToken = tokenJson.access_token?.trim();
  if (!accessToken) {
    throw new GoogleCalendarError("GOOGLE_TOKEN_EXCHANGE_FAILED", "Google access token is missing", 401);
  }

  return {
    accessToken,
    refreshToken: tokenJson.refresh_token?.trim() || null,
    accessTokenExpiresAt: toTokenExpiryIso(tokenJson.expires_in),
    scope: tokenJson.scope?.trim() || defaultCalendarScope,
  };
};

export const refreshGoogleCalendarAccessToken = async (params: {
  env: GoogleCalendarBindings;
  refreshToken: string;
}): Promise<{
  accessToken: string;
  accessTokenExpiresAt: string;
  scope: string;
}> => {
  const clientId = assertGoogleClientId(params.env);
  const clientSecret = params.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

  const body = new URLSearchParams();
  body.set("refresh_token", params.refreshToken);
  body.set("client_id", clientId);
  body.set("grant_type", "refresh_token");

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(googleTokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (error) {
    throw new GoogleCalendarError(
      "GOOGLE_TOKEN_REFRESH_FAILED",
      error instanceof Error ? error.message : "Google token refresh request failed",
      502,
    );
  }

  const tokenJson = await parseTokenResponse(tokenResponse);
  if (!tokenResponse.ok) {
    throw new GoogleCalendarError(
      "GOOGLE_TOKEN_REFRESH_FAILED",
      tokenJson.error_description ?? `Google token refresh failed (${tokenResponse.status})`,
      401,
    );
  }

  const accessToken = tokenJson.access_token?.trim();
  if (!accessToken) {
    throw new GoogleCalendarError("GOOGLE_TOKEN_REFRESH_FAILED", "Google access token is missing", 401);
  }

  return {
    accessToken,
    accessTokenExpiresAt: toTokenExpiryIso(tokenJson.expires_in),
    scope: tokenJson.scope?.trim() || defaultCalendarScope,
  };
};

const shouldRefreshToken = (expiresAt: string, nowMs = Date.now()): boolean => {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  const refreshSkewMs = 60_000;
  return expiresAtMs - refreshSkewMs <= nowMs;
};

export const ensureActiveGoogleCalendarConnection = async (params: {
  env: GoogleCalendarBindings;
  userId: string;
  repository: GoogleCalendarConnectionRepository;
}): Promise<GoogleCalendarConnection | null> => {
  const existing = await params.repository.findByUserId(params.userId);
  if (!existing) {
    return null;
  }

  if (!shouldRefreshToken(existing.accessTokenExpiresAt)) {
    return existing;
  }

  const refreshed = await refreshGoogleCalendarAccessToken({
    env: params.env,
    refreshToken: existing.refreshToken,
  });

  return await params.repository.upsertConnection({
    userId: existing.userId,
    accessToken: refreshed.accessToken,
    refreshToken: existing.refreshToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
    scope: refreshed.scope,
  });
};

const formatTimeLabel = (isoDateTime: string, timeZone: string): string | null => {
  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
};

const toEventLine = (event: GoogleCalendarEventItem, timeZone: string): string | null => {
  if (event.status === "cancelled") {
    return null;
  }

  const title = event.summary?.trim() || "(無題予定)";
  const location = event.location?.trim();
  const locationSuffix = location ? ` @${location}` : "";

  if (event.start?.date) {
    return `終日 ${title}${locationSuffix}`;
  }

  const startTime = event.start?.dateTime ? formatTimeLabel(event.start.dateTime, timeZone) : null;
  const endTime = event.end?.dateTime ? formatTimeLabel(event.end.dateTime, timeZone) : null;

  if (!startTime) {
    return `${title}${locationSuffix}`;
  }

  const range = endTime ? `${startTime}-${endTime}` : startTime;
  return `${range} ${title}${locationSuffix}`;
};

const toEventSortKey = (event: GoogleCalendarEventItem): number => {
  if (event.start?.dateTime) {
    const parsed = Date.parse(event.start.dateTime);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (event.start?.date) {
    const parsed = Date.parse(`${event.start.date}T00:00:00Z`);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Number.MAX_SAFE_INTEGER;
};

const toIsoDateInTimeZone = (at: Date, timeZone: string): string | null => {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);

    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (!year || !month || !day) {
      return null;
    }

    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
};

const toIsoDateFromDateTime = (isoDateTime: string, timeZone: string): string | null => {
  const parsedMs = Date.parse(isoDateTime);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return toIsoDateInTimeZone(new Date(parsedMs), timeZone) ?? new Date(parsedMs).toISOString().slice(0, 10);
};

const eventOverlapsLocalDate = (event: GoogleCalendarEventItem, date: string, timeZone: string): boolean => {
  if (event.status === "cancelled") {
    return false;
  }

  if (event.start?.date) {
    const startDate = event.start.date;
    const endDateExclusive = event.end?.date ?? shiftIsoDate(startDate, 1);
    if (!endDateExclusive) {
      return startDate === date;
    }

    return startDate <= date && date < endDateExclusive;
  }

  const startDateTime = event.start?.dateTime;
  if (!startDateTime) {
    return false;
  }

  const startDate = toIsoDateFromDateTime(startDateTime, timeZone);
  if (!startDate) {
    return false;
  }

  const endDateTime = event.end?.dateTime;
  const endMs = endDateTime ? Date.parse(endDateTime) : Number.NaN;
  const startMs = Date.parse(startDateTime);
  const endDate = Number.isFinite(endMs) && endMs > startMs
    ? toIsoDateInTimeZone(new Date(endMs - 1), timeZone) ?? new Date(endMs - 1).toISOString().slice(0, 10)
    : startDate;

  return startDate <= date && date <= endDate;
};

const fetchVisibleCalendarIds = async (params: {
  accessToken: string;
  maxCalendars: number;
}): Promise<readonly string[]> => {
  const seenIds = new Set<string>();
  const prioritizedIds: string[] = [];
  const regularIds: string[] = [];

  const addCalendarId = (id: string, prioritized: boolean): void => {
    if (seenIds.has(id)) {
      return;
    }
    seenIds.add(id);
    if (prioritized) {
      prioritizedIds.push(id);
      return;
    }
    regularIds.push(id);
  };

  addCalendarId("primary", true);

  let nextPageToken: string | null = null;
  do {
    const url = new URL(googleCalendarListEndpoint);
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showHidden", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("minAccessRole", "reader");
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${params.accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await parseGoogleApiErrorResponse(response);
      throwGoogleCalendarFetchError({
        status: response.status,
        fallbackMessage: `Google Calendar list request failed (${response.status})`,
        error,
      });
    }

    const json = (await response.json().catch(() => null)) as GoogleCalendarListResponse | null;
    const items = Array.isArray(json?.items) ? json.items : [];

    for (const item of items) {
      const id = item.id?.trim();
      if (!id) {
        continue;
      }

      addCalendarId(id, item.primary === true || item.selected === true);
      if (seenIds.size >= Math.max(1, params.maxCalendars)) {
        break;
      }
    }

    const token = json?.nextPageToken?.trim();
    nextPageToken = token && seenIds.size < Math.max(1, params.maxCalendars) ? token : null;
  } while (nextPageToken);

  return [...prioritizedIds, ...regularIds].slice(0, Math.max(1, params.maxCalendars));
};

const fetchCalendarEventsById = async (params: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timezone: string;
  maxResults: number;
}): Promise<readonly GoogleCalendarEventItem[]> => {
  const eventsEndpoint = `${googleCalendarApiBase}/calendars/${encodeURIComponent(params.calendarId)}/events`;
  const url = new URL(eventsEndpoint);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", params.timeMin);
  url.searchParams.set("timeMax", params.timeMax);
  url.searchParams.set("timeZone", params.timezone);
  url.searchParams.set("maxResults", String(params.maxResults));

  let eventsResponse: Response;
  try {
    eventsResponse = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${params.accessToken}`,
      },
    });
  } catch (error) {
    throw new GoogleCalendarError(
      "GOOGLE_CALENDAR_FETCH_FAILED",
      error instanceof Error ? error.message : "Google Calendar events request failed",
      502,
    );
  }

  if (!eventsResponse.ok) {
    const error = await parseGoogleApiErrorResponse(eventsResponse);
    throwGoogleCalendarFetchError({
      status: eventsResponse.status,
      fallbackMessage: `Google Calendar events request failed (${eventsResponse.status})`,
      error,
    });
  }

  const json = (await eventsResponse.json().catch(() => null)) as { items?: GoogleCalendarEventItem[] } | null;
  return Array.isArray(json?.items) ? json.items : [];
};

export const fetchGoogleCalendarScheduleLines = async (params: {
  accessToken: string;
  date: string;
  timezone: string;
  maxResults?: number;
}): Promise<readonly string[]> => {
  const { timeMin, timeMax } = buildDateWindow(params.date);
  const maxResults = params.maxResults ?? 20;
  const calendarFetchMaxResults = Math.max(50, Math.min(250, maxResults * 6));

  let calendarIds: readonly string[] = ["primary"];
  try {
    calendarIds = await fetchVisibleCalendarIds({
      accessToken: params.accessToken,
      maxCalendars: maxCalendarsToFetch,
    });
  } catch {
    // Fallback to primary if calendar list call fails (for transient/network reasons).
    // Authentication errors are still surfaced by the primary events call below.
    calendarIds = ["primary"];
  }

  const mergedItems: GoogleCalendarEventItem[] = [];
  const fetchResults = await Promise.all(
    calendarIds.map(async (calendarId) => {
      try {
        const items = await fetchCalendarEventsById({
          accessToken: params.accessToken,
          calendarId,
          timeMin,
          timeMax,
          timezone: params.timezone,
          maxResults: calendarFetchMaxResults,
        });
        return { calendarId, items } as const;
      } catch (error) {
        return { calendarId, error } as const;
      }
    }),
  );

  for (const result of fetchResults) {
    if ("error" in result) {
      if (result.calendarId === "primary") {
        throw result.error;
      }
      // Ignore non-primary calendar fetch failures and continue.
      continue;
    }
    mergedItems.push(...result.items);
  }

  const lines = mergedItems
    .filter((item) => eventOverlapsLocalDate(item, params.date, params.timezone))
    .sort((left, right) => toEventSortKey(left) - toEventSortKey(right))
    .map((item) => toEventLine(item, params.timezone))
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .filter((line, index, arr) => arr.indexOf(line) === index)
    .slice(0, maxResults);

  return lines;
};

export const loadGoogleCalendarScheduleLines = async (params: {
  env: GoogleCalendarBindings;
  db: D1Database;
  userId: string;
  date: string;
  timezone: string;
}): Promise<readonly string[]> => {
  const connectionRepo = createGoogleCalendarConnectionRepository(params.db);
  const connection = await ensureActiveGoogleCalendarConnection({
    env: params.env,
    userId: params.userId,
    repository: connectionRepo,
  });

  if (!connection) {
    return [];
  }

  return await fetchGoogleCalendarScheduleLines({
    accessToken: connection.accessToken,
    date: params.date,
    timezone: params.timezone,
  });
};
