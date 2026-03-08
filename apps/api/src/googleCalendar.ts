import {
  createGoogleCalendarConnectionRepository,
  type GoogleCalendarConnection,
  type GoogleCalendarConnectionRepository,
} from "@future-diary/db";

const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleCalendarEventsEndpoint = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const defaultCalendarScope = "https://www.googleapis.com/auth/calendar.readonly";

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

const parseTimeZoneOffsetMs = (timeZoneName: string): number | null => {
  const normalized = timeZoneName.trim();
  if (normalized === "GMT" || normalized === "UTC") {
    return 0;
  }

  const match = normalized.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) {
    return null;
  }

  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  return sign * ((hours * 60 + minutes) * 60 * 1000);
};

const getTimeZoneOffsetMs = (at: Date, timeZone: string): number | null => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const name = formatter.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "";
  return parseTimeZoneOffsetMs(name);
};

const toUtcIsoForLocalDateStart = (isoDate: string, timeZone: string): string => {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    return `${isoDate}T00:00:00.000Z`;
  }

  const midnightUtcMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0);
  const initialOffsetMs = getTimeZoneOffsetMs(new Date(midnightUtcMs), timeZone);
  if (initialOffsetMs === null) {
    return new Date(midnightUtcMs).toISOString();
  }

  const candidateMs = midnightUtcMs - initialOffsetMs;
  const resolvedOffsetMs = getTimeZoneOffsetMs(new Date(candidateMs), timeZone) ?? initialOffsetMs;
  return new Date(midnightUtcMs - resolvedOffsetMs).toISOString();
};

const buildDateWindow = (date: string, timezone: string): { timeMin: string; timeMax: string } => {
  const nextDate = shiftIsoDate(date, 1);
  if (!nextDate) {
    return {
      timeMin: `${date}T00:00:00.000Z`,
      timeMax: `${date}T23:59:59.999Z`,
    };
  }

  return {
    timeMin: toUtcIsoForLocalDateStart(date, timezone),
    timeMax: toUtcIsoForLocalDateStart(nextDate, timezone),
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

export const fetchGoogleCalendarScheduleLines = async (params: {
  accessToken: string;
  date: string;
  timezone: string;
  maxResults?: number;
}): Promise<readonly string[]> => {
  const { timeMin, timeMax } = buildDateWindow(params.date, params.timezone);

  const url = new URL(googleCalendarEventsEndpoint);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("timeZone", params.timezone);
  url.searchParams.set("maxResults", String(params.maxResults ?? 20));

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
    throw new GoogleCalendarError(
      "GOOGLE_CALENDAR_FETCH_FAILED",
      `Google Calendar events request failed (${eventsResponse.status})`,
      eventsResponse.status === 401 ? 401 : 502,
    );
  }

  const json = (await eventsResponse.json().catch(() => null)) as { items?: GoogleCalendarEventItem[] } | null;
  const items = Array.isArray(json?.items) ? json.items : [];
  const lines = items
    .map((item) => toEventLine(item, params.timezone))
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .slice(0, 8);

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
