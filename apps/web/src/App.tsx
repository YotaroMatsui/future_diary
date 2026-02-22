import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AuthMeResponse,
  deleteDiaryEntry,
  exchangeGoogleAuth,
  fetchAuthMe,
  fetchFutureDiaryDraft,
  listDiaryEntries,
  logout,
  saveDiaryEntry,
  startGoogleAuth,
} from "./api";
import { Button } from "./ui-button";
import { Textarea } from "./ui-textarea";
import { cn } from "./utils";
import { ChevronLeft, ChevronRight, LoaderCircle, LogOut, PencilLine, RefreshCw, Sparkles, WandSparkles } from "lucide-react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";
const googleAuthRedirectUriFromEnv =
  typeof import.meta.env.VITE_GOOGLE_AUTH_REDIRECT_URI === "string"
    ? import.meta.env.VITE_GOOGLE_AUTH_REDIRECT_URI.trim()
    : "";

const appPaths = {
  login: "#/login",
  diary: "#/diary",
} as const;

type AppPath = (typeof appPaths)[keyof typeof appPaths];

type GenerationState = "idle" | "creating" | "processing" | "failed" | "completed";

const storageKeys = {
  accessToken: "futureDiary.accessToken",
  timezone: "futureDiary.timezone",
} as const;

const monthKeyPattern = /^\d{4}-\d{2}$/;
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

type SessionState = {
  accessToken: string;
  timezone: string;
  user: AuthMeResponse["user"];
  session: AuthMeResponse["session"];
};

type CalendarDay = {
  isoDate: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
};

const normalizeAppPath = (hash: string): AppPath =>
  hash === appPaths.diary ? appPaths.diary : appPaths.login;

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
      return;
    }

    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

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

const clearOauthParamsInUrl = (url: URL): void => {
  const keys = ["code", "state", "scope", "authuser", "prompt"] as const;

  for (const key of keys) {
    url.searchParams.delete(key);
  }
};

const detectBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";
  } catch {
    return "Asia/Tokyo";
  }
};

const formatDateInTimeZone = (date: Date, timeZone: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (!year || !month || !day) {
      throw new Error("Invalid date parts");
    }

    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

const previousIsoDate = (isoDate: string): string | null => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const parseMonthKey = (monthKey: string): { year: number; month: number } | null => {
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
      isoDate: day.toISOString().slice(0, 10),
      dayOfMonth: day.getUTCDate(),
      inCurrentMonth: day.getUTCMonth() === parsed.month - 1,
    });
  }

  return days;
};

const monthLabelFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
});

const formatMonthLabel = (monthKey: string): string => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return monthKey;
  }

  return monthLabelFormatter.format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
};

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown error");

export const App = () => {
  const [appPath, setAppPath] = useState<AppPath>(() => normalizeAppPath(window.location.hash));
  const [session, setSession] = useState<SessionState | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string>(() =>
    formatDateInTimeZone(new Date(), detectBrowserTimezone()),
  );
  const [editorDate, setEditorDate] = useState<string>(() =>
    formatDateInTimeZone(new Date(), detectBrowserTimezone()),
  );
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

        const transitionedToCompleted =
          previousGenerationState !== "completed" && nextGenerationState === "completed";

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
          const exchanged = await exchangeGoogleAuth(apiBaseUrl, {
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

  const handleEditorBlur = useCallback(async () => {
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

  const handleStartGoogleAuth = useCallback(async () => {
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

  const handleLogout = useCallback(async () => {
    if (!session) {
      return;
    }

    setAuthLoading(true);
    setErrorMessage(null);

    try {
      await logout(apiBaseUrl, session.accessToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      clearSession();
      setAuthLoading(false);
    }
  }, [clearSession, session]);

  const handleDeleteEntry = useCallback(async () => {
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

  const handleManualRefresh = useCallback(async () => {
    if (!session || selectedDate.length === 0) {
      return;
    }

    setErrorMessage(null);
    await loadDraft(selectedDate, "active");
  }, [loadDraft, selectedDate, session]);

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

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_0%_0%,oklch(0.96_0.02_239),transparent_46%),radial-gradient(circle_at_100%_0%,oklch(0.98_0.03_230),transparent_40%),linear-gradient(to_bottom,oklch(0.99_0_0),oklch(0.97_0_0))]">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-4">
        <header className="rounded-2xl border border-border/80 bg-card/90 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
              <Sparkles className="h-4 w-4 text-primary" />
              Future Diary
            </h1>
            {session ? (
              <Button variant="ghost" size="sm" onClick={() => void handleLogout()} disabled={authLoading}>
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            ) : (
              <Button size="sm" onClick={() => void handleStartGoogleAuth()} disabled={authLoading || bootstrapping}>
                {authLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Login
              </Button>
            )}
          </div>
        </header>

        {!session && (
          <div className="flex min-h-[58dvh] items-center justify-center text-sm text-muted-foreground">
            Google ログインで編集を開始
          </div>
        )}

        {session && (
          <section className="overflow-hidden rounded-3xl border border-border/80 bg-card/95 shadow-[0_20px_70px_-42px_rgba(10,20,60,0.45)]">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="border-border/70 border-b p-3 sm:p-4 lg:border-r lg:border-b-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full bg-muted/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {indicatorBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PencilLine className="h-3.5 w-3.5" />}
                    <span>{indicatorText}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary hover:bg-primary/10 hover:text-primary"
                    onClick={() => void handleDeleteEntry()}
                    disabled={deleting || draftLoading || selectedDate !== editorDate}
                    aria-label="日記を再生成"
                  >
                    {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                  </Button>
                </div>

                {errorMessage && (
                  <p className="mb-2 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs leading-relaxed text-destructive">
                    {errorMessage}
                  </p>
                )}

                <Textarea
                  value={draftBody}
                  onFocus={() => {
                    setIsEditorFocused(true);
                  }}
                  onBlur={() => {
                    void handleEditorBlur();
                  }}
                  onChange={(event) => {
                    if (isTypewriting) {
                      clearTypewriter();
                    }
                    setDraftBody(event.target.value);
                    setEditorDate(selectedDate);
                  }}
                  placeholder="ここに書く"
                  disabled={draftLoading || bootstrapping}
                  className="min-h-[56dvh] border-border/0 bg-transparent text-[15px] leading-7 shadow-none focus-visible:ring-0"
                />
              </div>

              <aside className="p-3 sm:p-4">
                <div className="mb-2 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setVisibleMonthKey((current) => shiftMonthKey(current, -1))}
                    aria-label="前月"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <p className="flex-1 text-center text-sm font-semibold tracking-tight">{monthLabel}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => void handleManualRefresh()}
                    disabled={draftLoading}
                    aria-label="再取得"
                  >
                    {draftLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setVisibleMonthKey((current) => shiftMonthKey(current, 1))}
                    aria-label="翌月"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
                  {weekdayLabels.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day) => {
                    const selected = day.isoDate === selectedDate;
                    const isToday = day.isoDate === todayIso;
                    const isFilled = filledDates.has(day.isoDate);

                    return (
                      <button
                        key={day.isoDate}
                        type="button"
                        onClick={() => {
                          setSelectedDate(day.isoDate);
                          setErrorMessage(null);
                        }}
                        className={cn(
                          "relative h-9 rounded-xl border text-xs font-medium transition-colors",
                          day.inCurrentMonth ? "border-border text-foreground" : "border-border/50 text-muted-foreground",
                          selected && "border-primary bg-primary text-primary-foreground",
                          isToday && !selected && "border-primary/60",
                        )}
                      >
                        <span>{day.dayOfMonth}</span>
                        <span
                          className={cn(
                            "pointer-events-none absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full",
                            isFilled ? "bg-emerald-500" : "bg-transparent ring-1 ring-border/70",
                            selected && (isFilled ? "bg-primary-foreground/90" : "ring-primary-foreground/70"),
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </aside>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
