import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AuthMeResponse,
  deleteDiaryEntry,
  exchangeGoogleAuth,
  fetchAuthMe,
  fetchFutureDiaryDraft,
  listDiaryEntries,
  logout as logoutApi,
  saveDiaryEntry,
  startGoogleAuth,
} from "./api";
import {
  clearOauthParamsInUrl,
  normalizeAppPath,
  readLocalStorageString,
  resolveGoogleAuthRedirectUri,
  writeLocalStorageString,
} from "./future-diary-browser";
import {
  buildCalendarDays,
  detectBrowserTimezone,
  formatDateInTimeZone,
  formatMonthLabel,
  parseMonthKey,
  previousIsoDate,
  shiftMonthKey,
} from "./future-diary-date";
import { appPaths, storageKeys, type AppPath, type CalendarDay, type GenerationState, type SessionState } from "./future-diary-types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

type GoogleAuthExchangePayload = {
  code: string;
  state: string;
  redirectUri: string;
  timezone: string;
  legacyAccessToken?: string;
};

type GoogleAuthExchangeResult = Awaited<ReturnType<typeof exchangeGoogleAuth>>;

const inFlightGoogleAuthExchange = new Map<string, Promise<GoogleAuthExchangeResult>>();

const exchangeGoogleAuthOnce = async (payload: GoogleAuthExchangePayload): Promise<GoogleAuthExchangeResult> => {
  const key = `${payload.state}:${payload.code}:${payload.redirectUri}`;
  const existing = inFlightGoogleAuthExchange.get(key);
  if (existing) {
    return await existing;
  }

  const request = exchangeGoogleAuth(apiBaseUrl, payload).finally(() => {
    inFlightGoogleAuthExchange.delete(key);
  });
  inFlightGoogleAuthExchange.set(key, request);
  return await request;
};

export type FutureDiaryAppModel = {
  appPath: AppPath;
  session: SessionState | null;
  bootstrapping: boolean;
  authLoading: boolean;
  selectedDate: string;
  editorDate: string;
  draftBody: string;
  draftLoading: boolean;
  saving: boolean;
  deleting: boolean;
  errorMessage: string | null;
  calendarDays: readonly CalendarDay[];
  monthLabel: string;
  todayIso: string;
  filledDates: ReadonlySet<string>;
  indicatorText: string;
  indicatorBusy: boolean;
  startGoogleAuth: () => Promise<void>;
  logout: () => Promise<void>;
  focusEditor: () => void;
  blurEditor: () => Promise<void>;
  changeDraftBody: (value: string) => void;
  regenerateEntry: () => Promise<void>;
  refreshDraft: () => Promise<void>;
  selectDate: (isoDate: string) => void;
  goPrevMonth: () => void;
  goNextMonth: () => void;
};

export const useFutureDiaryApp = (): FutureDiaryAppModel => {
  const [appPath, setAppPath] = useState<AppPath>(() => normalizeAppPath(window.location.hash));
  const [session, setSession] = useState<SessionState | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string>(() => formatDateInTimeZone(new Date(), detectBrowserTimezone()));
  const [editorDate, setEditorDate] = useState<string>(() => formatDateInTimeZone(new Date(), detectBrowserTimezone()));
  const [visibleMonthKey, setVisibleMonthKey] = useState<string>(() =>
    formatDateInTimeZone(new Date(), detectBrowserTimezone()).slice(0, 7),
  );

  const [draftBody, setDraftBody] = useState("");
  const [savedBody, setSavedBody] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTypewriting, setIsTypewriting] = useState(false);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [generationState, setGenerationState] = useState<GenerationState>("idle");
  const [filledDates, setFilledDates] = useState<ReadonlySet<string>>(new Set());

  const draftRequestIdRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const monthRequestIdRef = useRef(0);

  const pollTimerRef = useRef<number | null>(null);
  const typewriterTimerRef = useRef<number | null>(null);

  const draftBodyRef = useRef(draftBody);
  const savedBodyRef = useRef(savedBody);
  const editorDateRef = useRef(editorDate);
  const generationStateRef = useRef(generationState);

  useEffect(() => {
    draftBodyRef.current = draftBody;
  }, [draftBody]);

  useEffect(() => {
    savedBodyRef.current = savedBody;
  }, [savedBody]);

  useEffect(() => {
    editorDateRef.current = editorDate;
  }, [editorDate]);

  useEffect(() => {
    generationStateRef.current = generationState;
  }, [generationState]);

  const navigate = useCallback((path: AppPath, clearOauthParams = false): void => {
    const url = new URL(window.location.href);
    url.hash = path;

    if (clearOauthParams) {
      clearOauthParamsInUrl(url);
    }

    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setAppPath(path);
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setAppPath(normalizeAppPath(window.location.hash));
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current === null) {
      return;
    }

    window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const clearTypewriter = useCallback(() => {
    if (typewriterTimerRef.current !== null) {
      window.clearTimeout(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }

    setIsTypewriting(false);
  }, []);

  useEffect(() => {
    return () => {
      clearPollTimer();
      clearTypewriter();
    };
  }, [clearPollTimer, clearTypewriter]);

  const resetDraftState = useCallback(() => {
    clearPollTimer();
    clearTypewriter();
    setIsEditorFocused(false);
    setDraftBody("");
    setSavedBody("");
    setGenerationState("idle");
  }, [clearPollTimer, clearTypewriter]);

  const markDateFilled = useCallback((date: string) => {
    setFilledDates((current) => {
      if (current.has(date)) {
        return current;
      }

      const next = new Set(current);
      next.add(date);
      return next;
    });
  }, []);

  const markDateUnfilled = useCallback((date: string) => {
    setFilledDates((current) => {
      if (!current.has(date)) {
        return current;
      }

      const next = new Set(current);
      next.delete(date);
      return next;
    });
  }, []);

  const persistSession = useCallback((accessToken: string, timezone: string) => {
    writeLocalStorageString(storageKeys.accessToken, accessToken);
    writeLocalStorageString(storageKeys.timezone, timezone);
  }, []);

  const clearSession = useCallback(() => {
    writeLocalStorageString(storageKeys.accessToken, "");
    writeLocalStorageString(storageKeys.timezone, "");
    setSession(null);
    setFilledDates(new Set());
    resetDraftState();
    navigate(appPaths.login, true);
  }, [navigate, resetDraftState]);

  const hydrateSessionByAccessToken = useCallback(
    async (accessToken: string, timezone: string): Promise<boolean> => {
      try {
        const me = await fetchAuthMe(apiBaseUrl, accessToken);
        const nextTimezone = me.user.timezone?.trim() || timezone;
        persistSession(accessToken, nextTimezone);
        setSession({
          accessToken,
          timezone: nextTimezone,
          user: me.user,
          session: me.session,
        });

        const today = formatDateInTimeZone(new Date(), nextTimezone);
        setSelectedDate(today);
        setEditorDate(today);
        setVisibleMonthKey(today.slice(0, 7));
        return true;
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
        clearSession();
        return false;
      }
    },
    [clearSession, persistSession],
  );

  const loadMonthFilledState = useCallback(
    async (monthKey: string) => {
      if (!session) {
        return;
      }

      const parsed = parseMonthKey(monthKey);
      if (!parsed) {
        setFilledDates(new Set());
        return;
      }

      const startIso = `${monthKey}-01`;
      const endDate = new Date(Date.UTC(parsed.year, parsed.month, 0));
      const endIso = endDate.toISOString().slice(0, 10);

      const requestId = monthRequestIdRef.current + 1;
      monthRequestIdRef.current = requestId;

      let cursor: string | undefined = endIso;
      let page = 0;
      let reachedOlder = false;
      const filled = new Set<string>();

      while (cursor && !reachedOlder && page < 6) {
        const listed = await listDiaryEntries(apiBaseUrl, session.accessToken, {
          onOrBeforeDate: cursor,
          limit: 100,
        });

        if (monthRequestIdRef.current !== requestId) {
          return;
        }

        if (listed.entries.length === 0) {
          break;
        }

        for (const entry of listed.entries) {
          if (entry.date < startIso) {
            reachedOlder = true;
            break;
          }

          if (entry.date <= endIso && entry.body.trim().length > 0) {
            filled.add(entry.date);
          }
        }

        const oldest = listed.entries[listed.entries.length - 1];
        if (!oldest || oldest.date < startIso) {
          break;
        }

        cursor = previousIsoDate(oldest.date) ?? undefined;
        page += 1;
      }

      if (editorDateRef.current.slice(0, 7) === monthKey && savedBodyRef.current.trim().length > 0) {
        filled.add(editorDateRef.current);
      }

      if (monthRequestIdRef.current === requestId) {
        setFilledDates(filled);
      }
    },
    [session],
  );

  const startTypewriter = useCallback(
    (text: string, date: string) => {
      clearTypewriter();

      setIsTypewriting(true);
      setEditorDate(date);
      setSavedBody(text);
      setDraftBody("");

      if (text.length === 0) {
        setIsTypewriting(false);
        return;
      }

      let index = 0;

      const tick = () => {
        index = Math.min(text.length, index + 1);
        setDraftBody(text.slice(0, index));

        if (index < text.length) {
          typewriterTimerRef.current = window.setTimeout(tick, 14);
          return;
        }

        typewriterTimerRef.current = null;
        setIsTypewriting(false);
      };

      typewriterTimerRef.current = window.setTimeout(tick, 24);
    },
    [clearTypewriter],
  );

  const persistDraft = useCallback(
    async (date: string, body: string) => {
      if (!session) {
        return;
      }

      const requestId = saveRequestIdRef.current + 1;
      saveRequestIdRef.current = requestId;
      setSaving(true);

      try {
        const saved = await saveDiaryEntry(apiBaseUrl, session.accessToken, {
          date,
          body,
        });

        if (saveRequestIdRef.current !== requestId) {
          return;
        }

        if (draftBodyRef.current === body) {
          setDraftBody(saved.body);
        }
        setSavedBody(saved.body);
        setEditorDate(date);
        markDateFilled(date);
        setErrorMessage(null);
      } catch (error) {
        if (saveRequestIdRef.current !== requestId) {
          return;
        }

        setErrorMessage(toErrorMessage(error));
      } finally {
        if (saveRequestIdRef.current === requestId) {
          setSaving(false);
        }
      }
    },
    [markDateFilled, session],
  );

  const loadDraft = useCallback(
    async (targetDate: string, mode: "active" | "poll" = "active") => {
      if (!session) {
        return;
      }

      const requestId = draftRequestIdRef.current + 1;
      draftRequestIdRef.current = requestId;
      clearPollTimer();

      if (mode === "active") {
        setDraftLoading(true);
      }

      try {
        const response = await fetchFutureDiaryDraft(apiBaseUrl, session.accessToken, {
          date: targetDate,
          timezone: session.timezone,
        });

        if (draftRequestIdRef.current !== requestId) {
          return;
        }

        const nextGenerationState: GenerationState =
          response.meta.generationStatus === "created"
            ? "creating"
            : response.meta.generationStatus === "processing"
              ? "processing"
              : response.meta.generationStatus === "failed"
                ? "failed"
                : "completed";

        const previousGenerationState = generationStateRef.current;
        setGenerationState(nextGenerationState);
        generationStateRef.current = nextGenerationState;

        const preserveEditingBody = mode === "poll" && draftBodyRef.current !== savedBodyRef.current;
        const responseBody = response.draft.body;
        const bodyChanged = responseBody !== savedBodyRef.current || editorDateRef.current !== targetDate;

        if (responseBody.trim().length > 0) {
          markDateFilled(targetDate);
        } else {
          markDateUnfilled(targetDate);
        }

        const transitionedToCompleted = previousGenerationState !== "completed" && nextGenerationState === "completed";

        const shouldTypewrite =
          !preserveEditingBody &&
          nextGenerationState === "completed" &&
          bodyChanged &&
          (transitionedToCompleted || response.meta.source !== "cached");

        if (shouldTypewrite) {
          startTypewriter(responseBody, targetDate);
        } else if (!preserveEditingBody) {
          clearTypewriter();
          setDraftBody(responseBody);
          setSavedBody(responseBody);
          setEditorDate(targetDate);
        }

        if (nextGenerationState === "failed" && response.meta.generationError) {
          setErrorMessage(response.meta.generationError);
        }

        if (response.meta.generationStatus !== "completed" && response.meta.pollAfterMs > 0) {
          pollTimerRef.current = window.setTimeout(() => {
            void loadDraft(targetDate, "poll");
          }, response.meta.pollAfterMs);
        }
      } catch (error) {
        if (draftRequestIdRef.current !== requestId) {
          return;
        }

        setErrorMessage(toErrorMessage(error));
      } finally {
        if (draftRequestIdRef.current === requestId && mode === "active") {
          setDraftLoading(false);
        }
      }
    },
    [clearPollTimer, clearTypewriter, markDateFilled, markDateUnfilled, session, startTypewriter],
  );

  useEffect(() => {
    let alive = true;

    const initialize = async () => {
      setBootstrapping(true);
      setErrorMessage(null);

      const storedToken = readLocalStorageString(storageKeys.accessToken);
      const storedTimezone = readLocalStorageString(storageKeys.timezone) ?? detectBrowserTimezone();
      const currentUrl = new URL(window.location.href);
      const code = currentUrl.searchParams.get("code");
      const state = currentUrl.searchParams.get("state");

      try {
        if (code && state) {
          setAuthLoading(true);

          const redirectUri = resolveGoogleAuthRedirectUri(currentUrl);
          const exchanged = await exchangeGoogleAuthOnce({
            code,
            state,
            redirectUri,
            timezone: storedTimezone,
            legacyAccessToken: storedToken ?? undefined,
          });

          if (!alive) {
            return;
          }

          const timezone = exchanged.user.timezone?.trim() || storedTimezone;
          const user: AuthMeResponse["user"] = {
            id: exchanged.user.id,
            timezone,
            email: exchanged.user.email,
            displayName: exchanged.user.displayName,
            avatarUrl: exchanged.user.avatarUrl,
            authProvider: exchanged.user.authProvider,
            migrationRequired: false,
          };

          persistSession(exchanged.accessToken, timezone);
          setSession({
            accessToken: exchanged.accessToken,
            timezone,
            user,
            session: exchanged.session,
          });

          const today = formatDateInTimeZone(new Date(), timezone);
          setSelectedDate(today);
          setEditorDate(today);
          setVisibleMonthKey(today.slice(0, 7));
          navigate(appPaths.diary, true);
          return;
        }

        if (storedToken) {
          const ok = await hydrateSessionByAccessToken(storedToken, storedTimezone);
          if (!alive) {
            return;
          }

          if (ok) {
            navigate(appPaths.diary, true);
            return;
          }
        }

        navigate(appPaths.login, true);
      } catch (error) {
        if (alive) {
          setErrorMessage(toErrorMessage(error));
          navigate(appPaths.login, true);
        }
      } finally {
        if (alive) {
          setAuthLoading(false);
          setBootstrapping(false);
        }
      }
    };

    void initialize();

    return () => {
      alive = false;
    };
  }, [hydrateSessionByAccessToken, navigate, persistSession]);

  useEffect(() => {
    if (bootstrapping) {
      return;
    }

    if (!session) {
      if (appPath !== appPaths.login) {
        navigate(appPaths.login, true);
      }
      return;
    }

    if (appPath !== appPaths.diary) {
      navigate(appPaths.diary, true);
    }
  }, [appPath, bootstrapping, navigate, session]);

  useEffect(() => {
    if (!session || selectedDate.length === 0) {
      return;
    }

    setVisibleMonthKey(selectedDate.slice(0, 7));
    void loadDraft(selectedDate, "active");
  }, [loadDraft, selectedDate, session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    void loadMonthFilledState(visibleMonthKey);
  }, [loadMonthFilledState, session, visibleMonthKey]);

  const blurEditor = useCallback(async () => {
    setIsEditorFocused(false);

    if (!session || bootstrapping || draftLoading || isTypewriting || saving) {
      return;
    }

    if (editorDate.length === 0 || draftBody === savedBody) {
      return;
    }

    if (draftBody.trim().length === 0) {
      return;
    }

    await persistDraft(editorDate, draftBody);
  }, [bootstrapping, draftBody, draftLoading, editorDate, isTypewriting, persistDraft, savedBody, saving, session]);

  const focusEditor = useCallback(() => {
    setIsEditorFocused(true);
  }, []);

  const changeDraftBody = useCallback(
    (value: string) => {
      if (isTypewriting) {
        clearTypewriter();
      }
      setDraftBody(value);
      setEditorDate(selectedDate);
    },
    [clearTypewriter, isTypewriting, selectedDate],
  );

  const startGoogleAuthFlow = useCallback(async () => {
    setAuthLoading(true);
    setErrorMessage(null);

    try {
      const redirectUri = resolveGoogleAuthRedirectUri(new URL(window.location.href));
      const started = await startGoogleAuth(apiBaseUrl, { redirectUri });
      window.location.assign(started.authorizationUrl);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      setAuthLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (!session) {
      return;
    }

    setAuthLoading(true);
    setErrorMessage(null);

    try {
      await logoutApi(apiBaseUrl, session.accessToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      clearSession();
      setAuthLoading(false);
    }
  }, [clearSession, session]);

  const regenerateEntry = useCallback(async () => {
    if (!session || selectedDate.length === 0 || selectedDate !== editorDate) {
      return;
    }

    const approved = window.confirm("この日記を再生成しますか？");
    if (!approved) {
      return;
    }

    setDeleting(true);
    setErrorMessage(null);

    try {
      await deleteDiaryEntry(apiBaseUrl, session.accessToken, {
        date: selectedDate,
      });
      markDateUnfilled(selectedDate);
      resetDraftState();
      await loadDraft(selectedDate, "active");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  }, [editorDate, loadDraft, markDateUnfilled, resetDraftState, selectedDate, session]);

  const refreshDraft = useCallback(async () => {
    if (!session || selectedDate.length === 0) {
      return;
    }

    setErrorMessage(null);
    await loadDraft(selectedDate, "active");
  }, [loadDraft, selectedDate, session]);

  const selectDate = useCallback((isoDate: string) => {
    setSelectedDate(isoDate);
    setErrorMessage(null);
  }, []);

  const goPrevMonth = useCallback(() => {
    setVisibleMonthKey((current) => shiftMonthKey(current, -1));
  }, []);

  const goNextMonth = useCallback(() => {
    setVisibleMonthKey((current) => shiftMonthKey(current, 1));
  }, []);

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonthKey), [visibleMonthKey]);
  const monthLabel = useMemo(() => formatMonthLabel(visibleMonthKey), [visibleMonthKey]);
  const todayIso = useMemo(() => {
    const timezone = session?.timezone ?? detectBrowserTimezone();
    return formatDateInTimeZone(new Date(), timezone);
  }, [session?.timezone]);

  const indicatorText =
    generationState === "creating" || generationState === "processing" || draftLoading
      ? "生成中"
      : isTypewriting
        ? "表示中"
        : saving
          ? "自動保存中"
          : isEditorFocused
            ? "編集中"
            : draftBody === savedBody
              ? "保存済み"
              : "未保存";

  const indicatorBusy =
    generationState === "creating" || generationState === "processing" || draftLoading || isTypewriting || saving;

  return {
    appPath,
    session,
    bootstrapping,
    authLoading,
    selectedDate,
    editorDate,
    draftBody,
    draftLoading,
    saving,
    deleting,
    errorMessage,
    calendarDays,
    monthLabel,
    todayIso,
    filledDates,
    indicatorText,
    indicatorBusy,
    startGoogleAuth: startGoogleAuthFlow,
    logout,
    focusEditor,
    blurEditor,
    changeDraftBody,
    regenerateEntry,
    refreshDraft,
    selectDate,
    goPrevMonth,
    goNextMonth,
  };
};
