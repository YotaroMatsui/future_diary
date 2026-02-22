import { diaryStatusLabel } from "@future-diary/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiaryEntryWithBody, DiaryStatus, DraftGenerationStatus, FutureDiaryDraftResponse, UserModel } from "./api";
import {
  confirmDiaryEntry,
  deleteDiaryEntry,
  deleteUser,
  exchangeGoogleAuth,
  fetchAuthMe,
  fetchFutureDiaryDraft,
  fetchUserModel,
  listDiaryEntries,
  logout,
  resetUserModel,
  saveDiaryEntry,
  startGoogleAuth,
  updateUserModel,
} from "./api";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";
const googleAuthRedirectUriFromEnv =
  typeof import.meta.env.VITE_GOOGLE_AUTH_REDIRECT_URI === "string"
    ? import.meta.env.VITE_GOOGLE_AUTH_REDIRECT_URI.trim()
    : "";

const resolveGoogleAuthRedirectUri = (url: URL): string => {
  if (googleAuthRedirectUriFromEnv.length === 0) {
    return url.origin;
  }

  try {
    new URL(googleAuthRedirectUriFromEnv);
    return googleAuthRedirectUriFromEnv;
  } catch {
    return url.origin;
  }
};

const storageKeys = {
  accessToken: "futureDiary.accessToken",
  timezone: "futureDiary.timezone",
} as const;

const historyPageSize = 30;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthKeyPattern = /^\d{4}-\d{2}$/;
const calendarWeekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const monthLabelFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
});

type CalendarDay = {
  isoDate: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
};

const parseIsoDateParts = (
  isoDate: string,
): { year: number; month: number; day: number } | null => {
  if (!isoDatePattern.test(isoDate)) {
    return null;
  }

  const [yearText, monthText, dayText] = isoDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  return { year, month, day };
};

const formatUtcDateAsIso = (date: Date): string => {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftIsoDate = (isoDate: string, diffDays: number): string | null => {
  const parsed = parseIsoDateParts(isoDate);
  if (!parsed) {
    return null;
  }

  const utcDate = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (Number.isNaN(utcDate.valueOf())) {
    return null;
  }

  utcDate.setUTCDate(utcDate.getUTCDate() + diffDays);
  return formatUtcDateAsIso(utcDate);
};

const previousIsoDate = (isoDate: string): string | null => shiftIsoDate(isoDate, -1);

const parseMonthKey = (
  monthKey: string,
): { year: number; month: number } | null => {
  if (!monthKeyPattern.test(monthKey)) {
    return null;
  }

  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
};

const formatMonthKey = (year: number, month: number): string =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

const shiftMonthKey = (monthKey: string, diffMonths: number): string => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return monthKey;
  }

  const base = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + diffMonths);
  return formatMonthKey(base.getUTCFullYear(), base.getUTCMonth() + 1);
};

const formatMonthLabel = (monthKey: string): string => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return monthKey;
  }

  return monthLabelFormatter.format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
};

const buildCalendarDays = (monthKey: string): readonly CalendarDay[] => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return [];
  }

  const firstDate = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  const startOffset = firstDate.getUTCDay();
  const gridStart = new Date(Date.UTC(parsed.year, parsed.month - 1, 1 - startOffset));
  const days: CalendarDay[] = [];

  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart);
    day.setUTCDate(gridStart.getUTCDate() + index);
    days.push({
      isoDate: formatUtcDateAsIso(day),
      dayOfMonth: day.getUTCDate(),
      inCurrentMonth: day.getUTCMonth() === parsed.month - 1,
    });
  }

  return days;
};

const mergeHistoryEntries = (
  current: readonly DiaryEntryWithBody[],
  incoming: readonly DiaryEntryWithBody[],
): readonly DiaryEntryWithBody[] => {
  const mergedById = new Map<string, DiaryEntryWithBody>();
  for (const entry of current) {
    mergedById.set(entry.id, entry);
  }
  for (const entry of incoming) {
    mergedById.set(entry.id, entry);
  }

  return [...mergedById.values()].sort((left, right) => right.date.localeCompare(left.date));
};

const nextHistoryCursorDate = (entries: readonly DiaryEntryWithBody[]): string | null => {
  if (entries.length === 0) {
    return null;
  }

  const oldestEntry = entries[entries.length - 1];
  if (!oldestEntry) {
    return null;
  }

  return previousIsoDate(oldestEntry.date);
};

const readLocalStorageString = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocalStorageString = (key: string, value: string): void => {
  try {
    if (value.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // ignore
  }
};

const formatDateInTimeZone = (date: Date, timeZone: string): string => {
  let parts: Intl.DateTimeFormatPart[] | null = null;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    parts = null;
  }

  const year = parts?.find((part) => part.type === "year")?.value;
  const month = parts?.find((part) => part.type === "month")?.value;
  const day = parts?.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    const localYear = String(date.getFullYear()).padStart(4, "0");
    const localMonth = String(date.getMonth() + 1).padStart(2, "0");
    const localDay = String(date.getDate()).padStart(2, "0");
    return `${localYear}-${localMonth}-${localDay}`;
  }

  return `${year}-${month}-${day}`;
};

const normalizeSnippet = (text: string, maxChars: number): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars) + "...";
};

const generationStatusLabel = (status: DraftGenerationStatus): string => {
  switch (status) {
    case "created":
      return "作成済み";
    case "processing":
      return "処理中";
    case "failed":
      return "失敗";
    case "completed":
      return "完了";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
};

const generationStatusPillClass = (status: DraftGenerationStatus): string => {
  switch (status) {
    case "created":
      return "pill--info";
    case "processing":
      return "pill--info";
    case "failed":
      return "pill--error";
    case "completed":
      return "pill--neutral";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
};

type ToastState = {
  kind: "info" | "error";
  message: string;
} | null;

type AuthUser = {
  id: string;
  timezone: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  authProvider: "legacy" | "google";
  migrationRequired: boolean;
};

type AuthSession = {
  kind: "legacy" | "google";
  expiresAt: string | null;
};

export const App = () => {
  const defaultTimezone = useMemo(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof resolved === "string" && resolved.length > 0 ? resolved : "Asia/Tokyo";
  }, []);

  const [timezone, setTimezone] = useState(() => readLocalStorageString(storageKeys.timezone) ?? defaultTimezone);
  const [selectedDate, setSelectedDate] = useState(() => formatDateInTimeZone(new Date(), timezone));

  const [accessToken, setAccessToken] = useState(() => readLocalStorageString(storageKeys.accessToken) ?? "");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [oauthProcessing, setOauthProcessing] = useState(false);

  const [userModel, setUserModel] = useState<UserModel | null>(null);
  const [userModelDraft, setUserModelDraft] = useState<UserModel | null>(null);
  const [userModelDirty, setUserModelDirty] = useState(false);
  const [userModelLoading, setUserModelLoading] = useState(false);
  const [userModelSaving, setUserModelSaving] = useState(false);
  const [userModelResetting, setUserModelResetting] = useState(false);

  const [autoLoadPending, setAutoLoadPending] = useState(true);

  const [entryId, setEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState<DiaryStatus | null>(null);
  const [title, setTitle] = useState<string>("未来日記");
  const [body, setBody] = useState<string>("");
  const [sourceFragmentIds, setSourceFragmentIds] = useState<readonly string[]>([]);
  const [generationKeywords, setGenerationKeywords] = useState<readonly string[]>([]);
  const [draftMeta, setDraftMeta] = useState<FutureDiaryDraftResponse["meta"] | null>(null);

  const [history, setHistory] = useState<readonly DiaryEntryWithBody[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursorDate, setHistoryCursorDate] = useState<string | null>(null);
  const [historyMonth, setHistoryMonth] = useState(() => selectedDate.slice(0, 7));

  const [draftLoading, setDraftLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [deleteEntryLoading, setDeleteEntryLoading] = useState(false);
  const [deleteUserLoading, setDeleteUserLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const draftRequestSeq = useRef(0);
  const timezoneTrim = timezone.trim();
  const accessTokenTrim = accessToken.trim();
  const isAuthenticated = accessTokenTrim.length > 0 && authUser !== null;
  const canCallApi = isAuthenticated && timezoneTrim.length > 0;
  const hasLoadedEntry = entryId !== null && status !== null;

  const todayDate = useMemo(() => formatDateInTimeZone(new Date(), timezoneTrim), [timezoneTrim]);
  const historyByDate = useMemo(() => {
    const byDate = new Map<string, DiaryEntryWithBody>();
    for (const entry of history) {
      byDate.set(entry.date, entry);
    }
    return byDate;
  }, [history]);
  const calendarDays = useMemo(() => buildCalendarDays(historyMonth), [historyMonth]);
  const historyMonthLabel = useMemo(() => formatMonthLabel(historyMonth), [historyMonth]);

  const resetEntryState = useCallback((): void => {
    setEntryId(null);
    setStatus(null);
    setTitle("未来日記");
    setBody("");
    setSourceFragmentIds([]);
    setGenerationKeywords([]);
    setDraftMeta(null);
    setDirty(false);
  }, []);

  const resetHistoryState = useCallback((): void => {
    setHistory([]);
    setHistoryHasMore(false);
    setHistoryCursorDate(null);
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
  }, []);

  const clearAuthState = useCallback((): void => {
    setAccessToken("");
    setAuthUser(null);
    setAuthSession(null);
    resetEntryState();
    resetHistoryState();
  }, [resetEntryState, resetHistoryState]);

  useEffect(() => {
    writeLocalStorageString(storageKeys.timezone, timezoneTrim);
  }, [timezoneTrim]);

  useEffect(() => {
    writeLocalStorageString(storageKeys.accessToken, accessTokenTrim);
  }, [accessTokenTrim]);

  useEffect(() => {
    // User boundary changed: clear state and allow a single auto-load again.
    draftRequestSeq.current += 1;
    resetEntryState();
    resetHistoryState();
    setUserModel(null);
    setUserModelDraft(null);
    setUserModelDirty(false);
    setAutoLoadPending(true);
  }, [accessTokenTrim, resetEntryState, resetHistoryState]);

  useEffect(() => {
    if (!isoDatePattern.test(selectedDate)) {
      return;
    }

    setHistoryMonth(selectedDate.slice(0, 7));
  }, [selectedDate]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    const clearAuthQuery = (): void => {
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      url.searchParams.delete("scope");
      url.searchParams.delete("authuser");
      url.searchParams.delete("prompt");
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", nextUrl);
    };

    if (error) {
      const redirectUriHint =
        error === "redirect_uri_mismatch"
          ? ` 承認済みリダイレクト URI に ${resolveGoogleAuthRedirectUri(url)} を追加してください。`
          : "";
      setToast({ kind: "error", message: `Googleログインに失敗しました: ${error}.${redirectUriHint}`.trim() });
      clearAuthQuery();
      return;
    }

    if (!code || !state) {
      return;
    }

    const redirectUri = resolveGoogleAuthRedirectUri(url);
    const legacyToken = readLocalStorageString(storageKeys.accessToken)?.trim() ?? "";

    setOauthProcessing(true);
    setAuthLoading(true);
    setToast({ kind: "info", message: "Googleログインを完了しています..." });

    void (async () => {
      try {
        const response = await exchangeGoogleAuth(apiBaseUrl, {
          code,
          state,
          redirectUri,
          timezone: timezoneTrim || defaultTimezone,
          legacyAccessToken: legacyToken.length > 0 ? legacyToken : undefined,
        });
        setAccessToken(response.accessToken);
        setAuthUser({
          ...response.user,
          migrationRequired: false,
        });
        setAuthSession(response.session);
        setToast({
          kind: "info",
          message: response.migrated ? "Googleログインへ移行し、既存データを引き継ぎました。" : "Googleでログインしました。",
        });
      } catch (exchangeError) {
        const errorMessage = exchangeError instanceof Error ? exchangeError.message : "unknown error";
        setToast({ kind: "error", message: `Googleログインの完了に失敗しました: ${errorMessage}` });
        clearAuthState();
      } finally {
        clearAuthQuery();
        setOauthProcessing(false);
        setAuthLoading(false);
      }
    })();
  }, [clearAuthState, defaultTimezone, timezoneTrim]);

  useEffect(() => {
    if (accessTokenTrim.length === 0) {
      setAuthUser(null);
      setAuthSession(null);
      setAuthLoading(false);
      return;
    }

    if (oauthProcessing) {
      return;
    }

    if (authUser !== null) {
      return;
    }

    setAuthLoading(true);
    void (async () => {
      try {
        const me = await fetchAuthMe(apiBaseUrl, accessTokenTrim);
        setAuthUser(me.user);
        setAuthSession(me.session);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        setToast({ kind: "error", message: `ログインに失敗しました: ${errorMessage}` });
        clearAuthState();
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [accessTokenTrim, authUser, clearAuthState, oauthProcessing]);

  const refreshUserModel = useCallback(async (): Promise<void> => {
    if (accessTokenTrim.length === 0) {
      setUserModel(null);
      setUserModelDraft(null);
      setUserModelDirty(false);
      return;
    }

    setUserModelLoading(true);
    try {
      const response = await fetchUserModel(apiBaseUrl, accessTokenTrim);
      setUserModel(response.model);
      setUserModelDraft(response.model);
      setUserModelDirty(false);

      if (response.parseError) {
        setToast({
          kind: "error",
          message: `ユーザーモデルの読み込みに失敗しました（デフォルトを使用します）: ${response.parseError.type}: ${response.parseError.message}`,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `ユーザーモデルの取得に失敗しました: ${errorMessage}` });
    } finally {
      setUserModelLoading(false);
    }
  }, [accessTokenTrim]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (userModel !== null) {
      return;
    }

    void refreshUserModel();
  }, [isAuthenticated, refreshUserModel, userModel]);

  const onSaveUserModel = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || accessTokenTrim.length === 0) {
      setToast({ kind: "error", message: "ログインしてください。" });
      return;
    }

    if (!userModelDraft) {
      return;
    }

    setUserModelSaving(true);
    setToast({ kind: "info", message: "ユーザーモデルを保存しています..." });
    try {
      const response = await updateUserModel(apiBaseUrl, accessTokenTrim, userModelDraft);
      setUserModel(response.model);
      setUserModelDraft(response.model);
      setUserModelDirty(false);
      setToast({ kind: "info", message: "ユーザーモデルを保存しました。" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `ユーザーモデルの保存に失敗しました: ${errorMessage}` });
    } finally {
      setUserModelSaving(false);
    }
  }, [accessTokenTrim, isAuthenticated, userModelDraft]);

  const onResetUserModel = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || accessTokenTrim.length === 0) {
      setToast({ kind: "error", message: "ログインしてください。" });
      return;
    }

    const confirmed = window.confirm("ユーザーモデルを初期化します。よろしいですか？");
    if (!confirmed) {
      return;
    }

    setUserModelResetting(true);
    setToast({ kind: "info", message: "ユーザーモデルを初期化しています..." });
    try {
      const response = await resetUserModel(apiBaseUrl, accessTokenTrim);
      setUserModel(response.model);
      setUserModelDraft(response.model);
      setUserModelDirty(false);
      setToast({ kind: "info", message: "ユーザーモデルを初期化しました。" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `ユーザーモデルの初期化に失敗しました: ${errorMessage}` });
    } finally {
      setUserModelResetting(false);
    }
  }, [accessTokenTrim, isAuthenticated]);

  const refreshHistory = useCallback(
    async (opts?: { onOrBeforeDate?: string; append?: boolean }): Promise<void> => {
      const append = opts?.append ?? false;
      if (!canCallApi) {
        resetHistoryState();
        return;
      }

      if (append) {
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
      }

      try {
        const response = await listDiaryEntries(apiBaseUrl, accessTokenTrim, {
          onOrBeforeDate: opts?.onOrBeforeDate,
          limit: historyPageSize,
        });
        const nextHistory = append ? mergeHistoryEntries(history, response.entries) : response.entries;
        setHistory(nextHistory);
        setHistoryHasMore(response.entries.length === historyPageSize);
        setHistoryCursorDate(nextHistoryCursorDate(nextHistory));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        setToast({ kind: "error", message: `履歴の取得に失敗しました: ${errorMessage}` });
      } finally {
        if (append) {
          setHistoryLoadingMore(false);
        } else {
          setHistoryLoading(false);
        }
      }
    },
    [accessTokenTrim, canCallApi, history, resetHistoryState],
  );

  const onLoadOlderHistory = useCallback(async (): Promise<void> => {
    if (!historyHasMore || !historyCursorDate || historyLoading || historyLoadingMore) {
      return;
    }

    await refreshHistory({
      onOrBeforeDate: historyCursorDate,
      append: true,
    });
  }, [historyCursorDate, historyHasMore, historyLoading, historyLoadingMore, refreshHistory]);

  const loadDraft = useCallback(
    async (opts: { date: string; reason: "auto" | "manual" }): Promise<void> => {
      if (!canCallApi) {
        setToast({ kind: "error", message: "ログインしてください。" });
        return;
      }

      setAutoLoadPending(false);
      const requestSeq = ++draftRequestSeq.current;
      setDraftLoading(true);
      setToast(opts.reason === "auto" ? null : { kind: "info", message: "未来日記を生成しています..." });
      try {
        const applyResponse = (response: FutureDiaryDraftResponse): void => {
          setSelectedDate(opts.date);
          setEntryId(response.meta.entryId);
          setStatus(response.meta.status);
          setTitle(response.draft.title);
          setBody(response.draft.body);
          setSourceFragmentIds(response.draft.sourceFragmentIds);
          setGenerationKeywords(response.draft.keywords);
          setDraftMeta(response.meta);
          setDirty(false);
        };

        let response = await fetchFutureDiaryDraft(apiBaseUrl, accessTokenTrim, {
          date: opts.date,
          timezone: timezoneTrim,
        });
        if (draftRequestSeq.current !== requestSeq) {
          return;
        }

        applyResponse(response);
        await refreshHistory();

        if (response.meta.generationStatus === "failed") {
          const errorMessage = response.meta.generationError ?? "unknown error";
          setToast({ kind: "error", message: `未来日記の生成に失敗しました: ${errorMessage}` });
          return;
        }

        if (response.meta.generationStatus === "completed") {
          setToast({
            kind: "info",
            message:
              response.meta.source === "cached" && response.meta.cached
                ? "既存の日記を読み込みました。"
                : "未来日記（下書き）を作成しました。",
          });
          return;
        }

        if (opts.reason === "manual") {
          setToast({ kind: "info", message: "生成ジョブを開始しました。完了まで待機します..." });
        }

        const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

        const maxPolls = 40;
        for (let poll = 0; poll < maxPolls; poll += 1) {
          const waitMs = Math.max(300, response.meta.pollAfterMs);
          await sleep(waitMs);

          if (draftRequestSeq.current !== requestSeq) {
            return;
          }

          response = await fetchFutureDiaryDraft(apiBaseUrl, accessTokenTrim, {
            date: opts.date,
            timezone: timezoneTrim,
          });
          if (draftRequestSeq.current !== requestSeq) {
            return;
          }

          applyResponse(response);

          if (response.meta.generationStatus === "completed") {
            await refreshHistory();
            setToast({ kind: "info", message: "未来日記の生成が完了しました。" });
            return;
          }

          if (response.meta.generationStatus === "failed") {
            const errorMessage = response.meta.generationError ?? "unknown error";
            setToast({ kind: "error", message: `未来日記の生成に失敗しました: ${errorMessage}` });
            return;
          }
        }

        setToast({ kind: "error", message: "未来日記の生成がタイムアウトしました。もう一度お試しください。" });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        setToast({ kind: "error", message: `未来日記の生成に失敗しました: ${errorMessage}` });
      } finally {
        if (draftRequestSeq.current === requestSeq) {
          setDraftLoading(false);
        }
      }
    },
    [accessTokenTrim, canCallApi, refreshHistory, timezoneTrim],
  );

  const onSave = useCallback(async (): Promise<void> => {
    if (!canCallApi) {
      setToast({ kind: "error", message: "ログインしてください。" });
      return;
    }

    if (!hasLoadedEntry) {
      setToast({ kind: "error", message: "保存する対象の日記がありません。" });
      return;
    }

    setSaveLoading(true);
    setToast({ kind: "info", message: "保存しています..." });
    try {
      const response = await saveDiaryEntry(apiBaseUrl, accessTokenTrim, { date: selectedDate, body });
      setStatus(response.entry.status);
      setBody(response.body);
      setDraftMeta((prev) =>
        prev
          ? {
              ...prev,
              status: response.entry.status,
              generationStatus: response.entry.generationStatus,
              generationError: response.entry.generationError,
            }
          : {
              userId: response.entry.userId,
              entryId: response.entry.id,
              status: response.entry.status,
              generationStatus: response.entry.generationStatus,
              generationError: response.entry.generationError,
              cached: true,
              source: "cached",
              pollAfterMs: 0,
            },
      );
      setDirty(false);
      await refreshHistory();
      setToast({ kind: "info", message: "保存しました。" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `保存に失敗しました: ${errorMessage}` });
    } finally {
      setSaveLoading(false);
    }
  }, [accessTokenTrim, body, canCallApi, hasLoadedEntry, refreshHistory, selectedDate]);

  const onConfirm = useCallback(async (): Promise<void> => {
    if (!canCallApi) {
      setToast({ kind: "error", message: "ログインしてください。" });
      return;
    }

    if (!hasLoadedEntry) {
      setToast({ kind: "error", message: "確定する対象の日記がありません。" });
      return;
    }

    setConfirmLoading(true);
    setToast({ kind: "info", message: "確定しています..." });
    try {
      const response = await confirmDiaryEntry(apiBaseUrl, accessTokenTrim, { date: selectedDate });
      setStatus(response.entry.status);
      setBody(response.body);
      setDraftMeta((prev) =>
        prev
          ? {
              ...prev,
              status: response.entry.status,
              generationStatus: response.entry.generationStatus,
              generationError: response.entry.generationError,
            }
          : {
              userId: response.entry.userId,
              entryId: response.entry.id,
              status: response.entry.status,
              generationStatus: response.entry.generationStatus,
              generationError: response.entry.generationError,
              cached: true,
              source: "cached",
              pollAfterMs: 0,
            },
      );
      setDirty(false);
      await refreshHistory();
      setToast({ kind: "info", message: "確定しました。" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `確定に失敗しました: ${errorMessage}` });
    } finally {
      setConfirmLoading(false);
    }
  }, [accessTokenTrim, canCallApi, hasLoadedEntry, refreshHistory, selectedDate]);

  const onDeleteEntry = useCallback(async (): Promise<void> => {
    if (!canCallApi) {
      setToast({ kind: "error", message: "ログインしてください。" });
      return;
    }

    if (!hasLoadedEntry) {
      setToast({ kind: "error", message: "削除する対象の日記がありません。" });
      return;
    }

    const confirmed = window.confirm(
      `${selectedDate} の日記を削除します。取り消しできません。\n\n本当に削除しますか？`,
    );
    if (!confirmed) {
      return;
    }

    setDeleteEntryLoading(true);
    setToast({ kind: "info", message: "削除しています..." });

    try {
      const response = await deleteDiaryEntry(apiBaseUrl, accessTokenTrim, { date: selectedDate });
      await refreshHistory();
      if (response.deleted) {
        resetEntryState();
        setToast({ kind: "info", message: "削除しました。" });
      } else {
        resetEntryState();
        setToast({ kind: "info", message: "削除対象が見つかりませんでした。" });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `削除に失敗しました: ${errorMessage}` });
    } finally {
      setDeleteEntryLoading(false);
    }
  }, [accessTokenTrim, canCallApi, hasLoadedEntry, refreshHistory, resetEntryState, selectedDate]);

  const onSelectHistoryEntry = useCallback((entry: DiaryEntryWithBody): void => {
    setAutoLoadPending(false);
    setSelectedDate(entry.date);
    setEntryId(entry.id);
    setStatus(entry.status);
    setTitle(`${entry.date} の未来日記`);
    setBody(entry.body);
    setSourceFragmentIds([]);
    setGenerationKeywords([]);
    setDraftMeta({
      userId: entry.userId,
      entryId: entry.id,
      status: entry.status,
      generationStatus: entry.generationStatus,
      generationError: entry.generationError,
      cached: true,
      source: "cached",
      pollAfterMs: 0,
    });
    setDirty(false);
    setToast({ kind: "info", message: `${entry.date} を読み込みました。` });
  }, []);

  const onSelectCalendarDate = useCallback(
    (date: string): void => {
      setAutoLoadPending(false);
      const entry = historyByDate.get(date);
      if (entry) {
        onSelectHistoryEntry(entry);
        return;
      }

      setSelectedDate(date);
    },
    [historyByDate, onSelectHistoryEntry],
  );

  const onShiftHistoryMonth = useCallback((diffMonths: number): void => {
    setHistoryMonth((prev) => shiftMonthKey(prev, diffMonths));
  }, []);

  const onStartGoogleLogin = useCallback(async (): Promise<void> => {
    if (typeof window === "undefined") {
      return;
    }

    setAuthLoading(true);
    setToast({ kind: "info", message: "Googleログインを開始します..." });

    try {
      const redirectUri = resolveGoogleAuthRedirectUri(new URL(window.location.href));
      const response = await startGoogleAuth(apiBaseUrl, { redirectUri });
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `Googleログインの開始に失敗しました: ${errorMessage}` });
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const onLogout = useCallback(async (): Promise<void> => {
    if (accessTokenTrim.length === 0) {
      clearAuthState();
      setToast(null);
      return;
    }

    setAuthLoading(true);
    try {
      await logout(apiBaseUrl, accessTokenTrim);
    } catch {
      // ignore (token might already be invalidated)
    } finally {
      setAuthLoading(false);
      clearAuthState();
      setToast(null);
    }
  }, [accessTokenTrim, clearAuthState]);

  const onDeleteAccount = useCallback(async (): Promise<void> => {
    if (!canCallApi) {
      setToast({ kind: "error", message: "ログインしてください。" });
      return;
    }

    const confirmed = window.confirm(
      "アカウントと日記データをすべて削除します。取り消しできません。\n\n本当に削除しますか？",
    );
    if (!confirmed) {
      return;
    }

    setDeleteUserLoading(true);
    setToast({ kind: "info", message: "アカウントを削除しています..." });

    try {
      await deleteUser(apiBaseUrl, accessTokenTrim);
      setToast({ kind: "info", message: "削除しました。" });
      clearAuthState();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `削除に失敗しました: ${errorMessage}` });
    } finally {
      setDeleteUserLoading(false);
    }
  }, [accessTokenTrim, canCallApi, clearAuthState]);

  useEffect(() => {
    if (!canCallApi) {
      return;
    }

    if (!autoLoadPending) {
      return;
    }

    if (entryId !== null) {
      setAutoLoadPending(false);
      return;
    }

    setAutoLoadPending(false);
    void loadDraft({ date: todayDate, reason: "auto" });
  }, [autoLoadPending, canCallApi, entryId, loadDraft, todayDate]);

  const header = (
    <header className="appHeader">
      <div className="appHeader__brand">
        <h1 className="appHeader__title">Future Diary</h1>
        <p className="appHeader__subtitle">当日初回の下書きを作り、編集して確定する。</p>
      </div>
      <div className="appHeader__meta">
        <div className="pill pill--neutral">API: {apiBaseUrl}</div>
        {authUser ? (
          <div className="pill pill--neutral">
            user: {(authUser.displayName ?? authUser.email ?? authUser.id).slice(0, 24)}
          </div>
        ) : null}
        {isAuthenticated ? (
          <button
            className="button button--ghost"
            onClick={() => void loadDraft({ date: todayDate, reason: "manual" })}
            type="button"
            disabled={!canCallApi || draftLoading}
          >
            今日を再読み込み
          </button>
        ) : null}
      </div>
    </header>
  );

  if (accessTokenTrim.length === 0) {
    return (
      <div className="app">
        {header}
        <div className="layout layout--single">
          <section className="main">
            <div className="card card--controls card--callout">
              <h2 className="cardTitle">Googleでログイン</h2>
              <p className="hint">
                Googleアカウントでサインインすると、同じアカウントで継続して日記データを利用できます。
              </p>

              <label className="field">
                <span className="field__label">timezone</span>
                <input
                  className="input"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="例: Asia/Tokyo"
                  autoComplete="off"
                />
              </label>

              <div className="actions">
                <button
                  className="button"
                  onClick={() => void onStartGoogleLogin()}
                  type="button"
                  disabled={authLoading || oauthProcessing || timezoneTrim.length === 0}
                >
                  {authLoading || oauthProcessing ? "処理中..." : "Googleでログイン"}
                </button>
              </div>

              <p className="hint">ログイン後はセッション期限内で自動ログインされます。共有PCでは必ずログアウトしてください。</p>
            </div>

            <div className="actions">
              <button className="button button--ghost" onClick={() => setToast(null)} type="button" disabled={!toast}>
                トーストを閉じる
              </button>
            </div>

            {toast ? <div className={`toast ${toast.kind === "error" ? "toast--error" : "toast--info"}`}>{toast.message}</div> : null}
          </section>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="app">
        {header}
        <div className="layout layout--single">
          <section className="main">
            <div className="card card--controls">
              <h2 className="editorHeader__title">Signing in...</h2>
              <p className="hint">ログインセッションを検証しています。</p>
              <div className="actions">
                <button className="button" type="button" disabled>
                  {authLoading ? "検証中..." : "待機中"}
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => {
                    clearAuthState();
                  }}
                >
                  やり直す
                </button>
              </div>
              {toast ? <div className={`toast ${toast.kind === "error" ? "toast--error" : "toast--info"}`}>{toast.message}</div> : null}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {header}

      <div className="layout">
        <section className="main">
          <div className="card card--controls">
            <div className="controls">
              <label className="field">
                <span className="field__label">user</span>
                <input className="input" value={authUser.id} readOnly autoComplete="off" />
              </label>
              <label className="field">
                <span className="field__label">timezone</span>
                <input
                  className="input"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="例: Asia/Tokyo"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span className="field__label">date</span>
                <input
                  className="input"
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
              </label>
            </div>

            <div className="actions actions--primary">
              <button
                className="button"
                onClick={() => void loadDraft({ date: selectedDate, reason: "manual" })}
                type="button"
                disabled={!canCallApi || draftLoading}
              >
                {draftLoading ? "生成中..." : "下書きを生成/読み込み"}
              </button>

              <button
                className="button button--secondary"
                onClick={() => void onSave()}
                type="button"
                disabled={!canCallApi || !hasLoadedEntry || saveLoading || draftLoading || confirmLoading || deleteEntryLoading || !dirty}
              >
                {saveLoading ? "保存中..." : "保存"}
              </button>

              <button
                className="button button--danger"
                onClick={() => void onConfirm()}
                type="button"
                disabled={!canCallApi || !hasLoadedEntry || confirmLoading || draftLoading || saveLoading || deleteEntryLoading || status === "confirmed"}
              >
                {confirmLoading ? "確定中..." : status === "confirmed" ? "確定済み" : "確定"}
              </button>

              <button
                className="button button--danger"
                onClick={() => void onDeleteEntry()}
                type="button"
                disabled={!canCallApi || !hasLoadedEntry || deleteEntryLoading || draftLoading || saveLoading || confirmLoading}
              >
                {deleteEntryLoading ? "削除中..." : "削除"}
              </button>

              <button
                className="button button--ghost"
                onClick={() => void refreshHistory()}
                type="button"
                disabled={!canCallApi || historyLoading || historyLoadingMore}
              >
                {historyLoading || historyLoadingMore ? "更新中..." : "履歴更新"}
              </button>
            </div>

            <p className="hint">
              アクセスキーはブラウザに保存されます。他人に共有しないでください。日付を変えると任意日の下書きを生成できます。生成は原則として「選択日付より前の日記」を参照し、選択日付より後の日記は参照しません。
            </p>
          </div>

          <div className="card card--editor">
            <div className="editorHeader">
              <div className="editorHeader__left">
                <h2 className="editorHeader__title">{title}</h2>
                <div className="editorHeader__pills">
                  {status ? (
                    <span className={`pill pill--${status}`}>{diaryStatusLabel(status)}</span>
                  ) : (
                    <span className="pill pill--neutral">未読込</span>
                  )}
                  {draftMeta ? (
                    <span className={`pill ${generationStatusPillClass(draftMeta.generationStatus)}`}>
                      gen: {generationStatusLabel(draftMeta.generationStatus)}
                    </span>
                  ) : null}
                  {draftMeta ? <span className="pill pill--neutral">source: {draftMeta.source}</span> : null}
                  {draftMeta ? (
                    <span className={`pill ${draftMeta.cached ? "pill--neutral" : "pill--info"}`}>
                      {draftMeta.cached ? "cached" : "fresh"}
                    </span>
                  ) : null}
                  {draftMeta?.generation?.source ? (
                    <span className="pill pill--neutral">genSource: {draftMeta.generation.source}</span>
                  ) : null}
                </div>
              </div>

              <div className="editorHeader__right">
                <span className={`saveState ${dirty ? "saveState--dirty" : "saveState--clean"}`}>{dirty ? "unsaved" : "saved"}</span>
              </div>
            </div>

            <textarea
              className="textarea textarea--entry"
              value={body}
              disabled={draftLoading}
              onChange={(event) => {
                setBody(event.target.value);
                setDirty(true);
              }}
              placeholder="ここに未来日記（下書き）が入ります。"
              rows={14}
              spellCheck={false}
            />

            {generationKeywords.length > 0 ? (
              <details className="details">
                <summary>keywords ({generationKeywords.length})</summary>
                <pre className="code">{generationKeywords.join(" / ")}</pre>
              </details>
            ) : null}

            {sourceFragmentIds.length > 0 ? (
              <details className="details">
                <summary>source fragments ({sourceFragmentIds.length})</summary>
                <pre className="code">{sourceFragmentIds.join("\n")}</pre>
              </details>
            ) : null}

            {draftMeta?.generation?.userModel ? (
              <details className="details">
                <summary>used model (v{draftMeta.generation.userModel.version})</summary>
                <pre className="code">{JSON.stringify(draftMeta.generation.userModel, null, 2)}</pre>
              </details>
            ) : null}
          </div>

          {toast ? <div className={`toast ${toast.kind === "error" ? "toast--error" : "toast--info"}`}>{toast.message}</div> : null}
        </section>

        <aside className="sidebar">
          <div className="card card--history">
            <div className="historyHeader">
              <h2 className="historyHeader__title">History</h2>
              <div className="historyHeader__meta">
                <span className="pill pill--neutral">{history.length} loaded</span>
                {historyHasMore ? <span className="pill pill--info">more</span> : null}
              </div>
            </div>

            <section className="historyCalendar">
              <div className="historyCalendar__header">
                <button
                  className="button button--ghost historyCalendar__navButton"
                  type="button"
                  onClick={() => onShiftHistoryMonth(-1)}
                >
                  {"<"}
                </button>
                <p className="historyCalendar__month">{historyMonthLabel}</p>
                <button
                  className="button button--ghost historyCalendar__navButton"
                  type="button"
                  onClick={() => onShiftHistoryMonth(1)}
                >
                  {">"}
                </button>
              </div>

              <div className="historyCalendar__weekdays">
                {calendarWeekdayLabels.map((label) => (
                  <span className="historyCalendar__weekday" key={label}>
                    {label}
                  </span>
                ))}
              </div>

              <ol className="historyCalendar__days">
                {calendarDays.map((day) => {
                  const isSelected = day.isoDate === selectedDate;
                  const hasEntry = historyByDate.has(day.isoDate);

                  return (
                    <li key={day.isoDate}>
                      <button
                        className={`historyCalendarDay ${day.inCurrentMonth ? "" : "historyCalendarDay--outside"} ${
                          isSelected ? "historyCalendarDay--selected" : ""
                        } ${hasEntry ? "historyCalendarDay--withEntry" : ""}`}
                        type="button"
                        onClick={() => onSelectCalendarDate(day.isoDate)}
                      >
                        <span className="historyCalendarDay__number">{day.dayOfMonth}</span>
                        {hasEntry ? <span className="historyCalendarDay__dot" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>

            <ol className="historyList">
              {history.map((entry) => (
                <li className="historyList__item" key={entry.id}>
                  <button
                    type="button"
                    className={`historyEntry ${entry.date === selectedDate ? "historyEntry--active" : ""}`}
                    onClick={() => onSelectHistoryEntry(entry)}
                  >
                    <div className="historyEntry__top">
                      <span className="historyEntry__date">{entry.date}</span>
                      <span className={`pill pill--${entry.status}`}>{diaryStatusLabel(entry.status)}</span>
                      {entry.generationStatus !== "completed" ? (
                        <span className={`pill ${generationStatusPillClass(entry.generationStatus)}`}>
                          gen: {generationStatusLabel(entry.generationStatus)}
                        </span>
                      ) : null}
                    </div>
                    <div className="historyEntry__snippet">{normalizeSnippet(entry.body, 110)}</div>
                  </button>
                </li>
              ))}
            </ol>

            {history.length === 0 && !historyLoading ? (
              <p className="hint">
                履歴はまだありません。カレンダーで日付を選択して「下書きを生成/読み込み」を押すと作成できます。
              </p>
            ) : null}
            {historyLoading ? <p className="hint">loading...</p> : null}

            <div className="actions actions--compact">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => void onLoadOlderHistory()}
                disabled={!canCallApi || historyLoading || historyLoadingMore || !historyHasMore || !historyCursorDate}
              >
                {historyLoadingMore ? "読み込み中..." : historyHasMore ? `さらに${historyPageSize}件読み込む` : "これ以上ありません"}
              </button>
            </div>
          </div>

          <div className="card">
            <h2 className="historyHeader__title">Account</h2>
            <p className="hint">
              Googleログインでアカウントを管理します。削除は取り消しできません。
            </p>

            <div className="controls">
              <label className="field">
                <span className="field__label">provider</span>
                <input className="input" value={authUser.authProvider} readOnly autoComplete="off" />
              </label>
              <label className="field">
                <span className="field__label">email</span>
                <input className="input" value={authUser.email ?? "(not set)"} readOnly autoComplete="off" />
              </label>
              <label className="field">
                <span className="field__label">session</span>
                <input
                  className="input"
                  value={authSession ? `${authSession.kind} / ${authSession.expiresAt ?? "no-expiry"}` : "unknown"}
                  readOnly
                  autoComplete="off"
                />
              </label>
            </div>

            {authUser.migrationRequired ? (
              <div className="actions">
                <button
                  className="button button--secondary"
                  onClick={() => void onStartGoogleLogin()}
                  type="button"
                  disabled={authLoading || oauthProcessing}
                >
                  {authLoading || oauthProcessing ? "処理中..." : "Googleアカウントを連携して移行"}
                </button>
              </div>
            ) : null}

            <details className="details">
              <summary>Profile (style/intent)</summary>
              <p className="hint">
                下書き生成に使うユーザーモデルです。ここで編集した内容は次回以降の生成に反映されます。
              </p>

              {userModelLoading ? <p className="hint">loading...</p> : null}

              {!userModelDraft ? (
                <p className="hint">未読み込みです。</p>
              ) : (
                <>
                  <label className="field">
                    <span className="field__label">intent</span>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={userModelDraft.intent}
                      onChange={(event) => {
                        const value = event.target.value;
                        setUserModelDraft((prev) => (prev ? { ...prev, intent: value } : prev));
                        setUserModelDirty(true);
                      }}
                      placeholder="例: 落ち着いて始めたい / 今日は優先度を見直したい"
                      spellCheck={false}
                    />
                  </label>

                  <label className="field">
                    <span className="field__label">opening phrase</span>
                    <input
                      className="input"
                      value={userModelDraft.styleHints.openingPhrases[0] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setUserModelDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                styleHints: {
                                  ...prev.styleHints,
                                  openingPhrases: [value],
                                },
                              }
                            : prev,
                        );
                        setUserModelDirty(true);
                      }}
                      placeholder="例: 今日は無理をせず、少しずつ整えていく一日にしたい。"
                      autoComplete="off"
                    />
                  </label>

                  <label className="field">
                    <span className="field__label">closing phrase</span>
                    <input
                      className="input"
                      value={userModelDraft.styleHints.closingPhrases[0] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setUserModelDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                styleHints: {
                                  ...prev.styleHints,
                                  closingPhrases: [value],
                                },
                              }
                            : prev,
                        );
                        setUserModelDirty(true);
                      }}
                      placeholder="例: 夜に事実を追記して、確定日記にする。"
                      autoComplete="off"
                    />
                  </label>

                  <label className="field">
                    <span className="field__label">max paragraphs</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={6}
                      value={userModelDraft.styleHints.maxParagraphs}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) {
                          return;
                        }
                        setUserModelDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                styleHints: {
                                  ...prev.styleHints,
                                  maxParagraphs: Math.max(1, Math.min(6, Math.trunc(next))),
                                },
                              }
                            : prev,
                        );
                        setUserModelDirty(true);
                      }}
                    />
                  </label>

                  <label className="field">
                    <span className="field__label">avoid copying</span>
                    <div className="checkboxLine">
                      <input
                        type="checkbox"
                        checked={userModelDraft.preferences.avoidCopyingFromFragments}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setUserModelDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  preferences: { ...prev.preferences, avoidCopyingFromFragments: checked },
                                }
                              : prev,
                          );
                          setUserModelDirty(true);
                        }}
                      />
                      <span>過去断片の文章を引用/要約せず、今日の下書きを新規に書く。</span>
                    </div>
                  </label>

                  <div className="actions">
                    <button
                      className="button"
                      onClick={() => void onSaveUserModel()}
                      type="button"
                      disabled={!isAuthenticated || !userModelDirty || userModelSaving || userModelResetting}
                    >
                      {userModelSaving ? "保存中..." : "保存"}
                    </button>
                    <button
                      className="button button--ghost"
                      onClick={() => void refreshUserModel()}
                      type="button"
                      disabled={!isAuthenticated || userModelLoading || userModelSaving || userModelResetting}
                    >
                      再読み込み
                    </button>
                    <button
                      className="button button--secondary"
                      onClick={() => void onResetUserModel()}
                      type="button"
                      disabled={!isAuthenticated || userModelSaving || userModelResetting}
                    >
                      {userModelResetting ? "初期化中..." : "初期化"}
                    </button>
                  </div>

                  <p className="hint">
                    現在のモデルはローカルではなく API 側に保存されます。保存したくない場合はログアウトしてください。
                  </p>
                </>
              )}
            </details>

            <div className="actions">
              <button
                className="button button--secondary"
                onClick={() => void onStartGoogleLogin()}
                type="button"
                disabled={authLoading || oauthProcessing}
              >
                {authLoading || oauthProcessing ? "処理中..." : "Googleで再ログイン"}
              </button>
              <button className="button button--ghost" onClick={() => void onLogout()} type="button" disabled={authLoading || deleteUserLoading}>
                ログアウト
              </button>
            </div>

            <div className="actions">
              <button className="button button--danger" onClick={() => void onDeleteAccount()} type="button" disabled={deleteUserLoading || authLoading}>
                {deleteUserLoading ? "削除中..." : "アカウント削除"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
