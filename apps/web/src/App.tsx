import { diaryStatusLabel } from "@future-diary/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiaryEntryWithBody, DiaryStatus, DraftGenerationStatus, FutureDiaryDraftResponse } from "./api";
import {
  confirmDiaryEntry,
  createAuthSession,
  deleteDiaryEntry,
  deleteUser,
  fetchAuthMe,
  fetchFutureDiaryDraft,
  listDiaryEntries,
  logout,
  saveDiaryEntry,
} from "./api";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

const storageKeys = {
  accessToken: "futureDiary.accessToken",
  timezone: "futureDiary.timezone",
} as const;

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

const maskAccessToken = (token: string): string => {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed.length <= 12) {
    return "*".repeat(trimmed.length);
  }

  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const copyTextToClipboard = async (text: string): Promise<void> => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("nothing to copy");
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(trimmed);
      return;
    }
  } catch {
    // fall through to execCommand fallback
  }

  const body = typeof document === "undefined" ? null : document.body;
  if (!body) {
    throw new Error("clipboard is not available");
  }

  const textarea = document.createElement("textarea");
  textarea.value = trimmed;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();

    const ok = document.execCommand("copy");
    if (!ok) {
      throw new Error("execCommand copy failed");
    }
  } finally {
    body.removeChild(textarea);
  }
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
};

export const App = () => {
  const defaultTimezone = useMemo(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof resolved === "string" && resolved.length > 0 ? resolved : "Asia/Tokyo";
  }, []);

  const [timezone, setTimezone] = useState(() => readLocalStorageString(storageKeys.timezone) ?? defaultTimezone);
  const [selectedDate, setSelectedDate] = useState(() => formatDateInTimeZone(new Date(), timezone));

  const [accessToken, setAccessToken] = useState(() => readLocalStorageString(storageKeys.accessToken) ?? "");
  const [accessTokenInput, setAccessTokenInput] = useState("");
  const [issuedAccessToken, setIssuedAccessToken] = useState<string | null>(null);
  const [accessKeyRevealed, setAccessKeyRevealed] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [autoLoadPending, setAutoLoadPending] = useState(true);

  const [entryId, setEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState<DiaryStatus | null>(null);
  const [title, setTitle] = useState<string>("未来日記");
  const [body, setBody] = useState<string>("");
  const [sourceFragmentIds, setSourceFragmentIds] = useState<readonly string[]>([]);
  const [draftMeta, setDraftMeta] = useState<FutureDiaryDraftResponse["meta"] | null>(null);

  const [history, setHistory] = useState<readonly DiaryEntryWithBody[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const resetEntryState = useCallback((): void => {
    setEntryId(null);
    setStatus(null);
    setTitle("未来日記");
    setBody("");
    setSourceFragmentIds([]);
    setDraftMeta(null);
    setDirty(false);
  }, []);

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
    setHistory([]);
    setAutoLoadPending(true);
  }, [accessTokenTrim, resetEntryState]);

  useEffect(() => {
    if (accessTokenTrim.length === 0) {
      setAuthUser(null);
      setAuthLoading(false);
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        setToast({ kind: "error", message: `ログインに失敗しました: ${errorMessage}` });
        setAccessToken("");
        setAuthUser(null);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [accessTokenTrim, authUser]);

  const refreshHistory = useCallback(
    async (opts?: { onOrBeforeDate?: string }): Promise<void> => {
      if (!canCallApi) {
        setHistory([]);
        return;
      }

      setHistoryLoading(true);
      try {
        const response = await listDiaryEntries(apiBaseUrl, accessTokenTrim, {
          onOrBeforeDate: opts?.onOrBeforeDate,
          limit: 30,
        });
        setHistory(response.entries);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        setToast({ kind: "error", message: `履歴の取得に失敗しました: ${errorMessage}` });
      } finally {
        setHistoryLoading(false);
      }
    },
    [accessTokenTrim, canCallApi],
  );

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

  const copyAccessKeyToClipboard = useCallback(async (token: string): Promise<void> => {
    const tokenTrim = token.trim();
    if (tokenTrim.length === 0) {
      return;
    }

    try {
      await copyTextToClipboard(tokenTrim);
      setToast({ kind: "info", message: "アクセスキーをコピーしました。" });
    } catch (error) {
      console.warn("Access key copy failed", { message: error instanceof Error ? error.message : String(error) });
      setToast({ kind: "error", message: "コピーに失敗しました（ブラウザの権限をご確認ください）。" });
    }
  }, []);

  const onCopyAccessKey = useCallback(async (): Promise<void> => {
    await copyAccessKeyToClipboard(accessTokenTrim);
  }, [accessTokenTrim, copyAccessKeyToClipboard]);

  const onCreateSession = useCallback(async (): Promise<void> => {
    setAuthLoading(true);
    setToast({ kind: "info", message: "認証セッションを作成しています..." });

    try {
      const response = await createAuthSession(apiBaseUrl, { timezone: timezoneTrim || defaultTimezone });
      setAccessToken(response.accessToken);
      setAuthUser(response.user);
      setIssuedAccessToken(response.accessToken);
      setAccessKeyRevealed(false);
      setAccessTokenInput("");
      setToast({ kind: "info", message: "アクセスキーを発行しました。安全な場所に保存してください。" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `ログインに失敗しました: ${errorMessage}` });
    } finally {
      setAuthLoading(false);
    }
  }, [defaultTimezone, timezoneTrim]);

  const onLoginWithToken = useCallback(async (): Promise<void> => {
    const tokenTrim = accessTokenInput.trim();
    if (tokenTrim.length === 0) {
      setToast({ kind: "error", message: "アクセスキーを入力してください。" });
      return;
    }

    setAuthLoading(true);
    setToast({ kind: "info", message: "ログインしています..." });

    try {
      const me = await fetchAuthMe(apiBaseUrl, tokenTrim);
      setIssuedAccessToken(null);
      setAccessKeyRevealed(false);
      setAccessToken(tokenTrim);
      setAuthUser(me.user);
      setAccessTokenInput("");
      setToast({ kind: "info", message: "ログインしました。" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `ログインに失敗しました: ${errorMessage}` });
    } finally {
      setAuthLoading(false);
    }
  }, [accessTokenInput]);

  const onLogout = useCallback(async (): Promise<void> => {
    if (accessTokenTrim.length === 0) {
      setIssuedAccessToken(null);
      setAccessKeyRevealed(false);
      setAccessToken("");
      setAuthUser(null);
      setAccessTokenInput("");
      resetEntryState();
      setHistory([]);
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
      setIssuedAccessToken(null);
      setAccessKeyRevealed(false);
      setAccessToken("");
      setAuthUser(null);
      setAccessTokenInput("");
      resetEntryState();
      setHistory([]);
      setToast(null);
    }
  }, [accessTokenTrim, resetEntryState]);

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
      setIssuedAccessToken(null);
      setAccessKeyRevealed(false);
      setAccessToken("");
      setAuthUser(null);
      setAccessTokenInput("");
      resetEntryState();
      setHistory([]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `削除に失敗しました: ${errorMessage}` });
    } finally {
      setDeleteUserLoading(false);
    }
  }, [accessTokenTrim, canCallApi, resetEntryState]);

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
        {authUser ? <div className="pill pill--neutral">user: {authUser.id.slice(0, 8)}</div> : null}
        {isAuthenticated ? (
          <button className="button button--ghost" onClick={() => void loadDraft({ date: todayDate, reason: "manual" })} type="button" disabled={!canCallApi || draftLoading}>
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
            <div className="onboarding">
              <div className="card card--controls card--callout">
                <h2 className="cardTitle">初めての方</h2>
                <p className="hint">
                  まずアクセスキーを発行して開始します。アクセスキーはログイン情報です。紛失すると復旧できません。
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
                    onClick={() => void onCreateSession()}
                    type="button"
                    disabled={authLoading || timezoneTrim.length === 0}
                  >
                    {authLoading ? "処理中..." : "アクセスキーを発行して始める"}
                  </button>
                </div>

                <details className="details">
                  <summary>アクセスキーについて</summary>
                  <p className="hint">
                    発行後にアクセスキーを表示します。別の端末でも使う場合は、コピーして安全な場所に保存してください。
                  </p>
                </details>
              </div>

              <div className="card card--controls">
                <h2 className="cardTitle">アクセスキーを持っている</h2>
                <p className="hint">以前発行したアクセスキーを貼り付けてログインします。</p>

                <label className="field">
                  <span className="field__label">access key</span>
                  <input
                    className="input input--mono"
                    value={accessTokenInput}
                    onChange={(event) => setAccessTokenInput(event.target.value)}
                    placeholder="例: xxxx-xxxx-xxxx-xxxx"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <div className="actions">
                  <button
                    className="button button--secondary"
                    onClick={() => void onLoginWithToken()}
                    type="button"
                    disabled={authLoading || accessTokenInput.trim().length === 0}
                  >
                    {authLoading ? "処理中..." : "アクセスキーでログイン"}
                  </button>
                </div>

                <p className="hint">timezone はログイン後に変更できます。共有PCではログアウトしてください。</p>
              </div>
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
              <p className="hint">アクセスキーを検証しています。</p>
              <div className="actions">
                <button className="button" type="button" disabled>
                  {authLoading ? "検証中..." : "待機中"}
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => {
                    setAccessToken("");
                    setAuthUser(null);
                    setAccessTokenInput("");
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
      {issuedAccessToken ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Access key issued">
          <div className="modal">
            <h2 className="modal__title">アクセスキーを保存してください</h2>
            <p className="hint">
              このアクセスキーがログイン情報です。紛失すると復旧できません。安全な場所に保存してください。
            </p>

            <div className="secretBox">
              <div className="secretBox__label">access key</div>
              <div className="secretBox__value">
                <code>{accessKeyRevealed ? issuedAccessToken : maskAccessToken(issuedAccessToken)}</code>
              </div>
            </div>

            <div className="actions">
              <button
                className="button"
                onClick={() => void copyAccessKeyToClipboard(issuedAccessToken)}
                type="button"
              >
                コピー
              </button>
              <button
                className="button button--ghost"
                onClick={() => setAccessKeyRevealed((prev) => !prev)}
                type="button"
              >
                {accessKeyRevealed ? "隠す" : "表示"}
              </button>
              <button
                className="button button--secondary"
                onClick={() => {
                  setIssuedAccessToken(null);
                  setAccessKeyRevealed(false);
                }}
                type="button"
              >
                保存した
              </button>
            </div>

            <p className="hint">
              コピーが失敗した場合は「表示」を押して手動でコピーしてください。後からは Account からも表示/コピーできます。
            </p>
          </div>
        </div>
      ) : null}
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

            <div className="actions">
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
                disabled={!canCallApi || historyLoading}
              >
                {historyLoading ? "更新中..." : "履歴更新"}
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
                </div>
              </div>

              <div className="editorHeader__right">
                <span className={`saveState ${dirty ? "saveState--dirty" : "saveState--clean"}`}>{dirty ? "unsaved" : "saved"}</span>
              </div>
            </div>

            <textarea
              className="textarea"
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

            {sourceFragmentIds.length > 0 ? (
              <details className="details">
                <summary>source fragments ({sourceFragmentIds.length})</summary>
                <pre className="code">{sourceFragmentIds.join("\n")}</pre>
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
                <span className="pill pill--neutral">{history.length} entries</span>
              </div>
            </div>

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

            {historyLoading ? <p className="hint">loading...</p> : null}
          </div>

          <div className="card">
            <h2 className="historyHeader__title">Account</h2>
            <p className="hint">
              アクセスキーはログイン情報です。別の端末でも使う場合はコピーして安全な場所に保存してください。削除は取り消しできません。
            </p>

            <label className="field">
              <span className="field__label">access key</span>
              <div className="secretRow">
                <input
                  className="input input--mono"
                  value={accessKeyRevealed ? accessTokenTrim : maskAccessToken(accessTokenTrim)}
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="button button--ghost"
                  onClick={() => setAccessKeyRevealed((prev) => !prev)}
                  type="button"
                  disabled={accessTokenTrim.length === 0}
                >
                  {accessKeyRevealed ? "隠す" : "表示"}
                </button>
              </div>
            </label>

            <div className="actions">
              <button className="button button--secondary" onClick={() => void onCopyAccessKey()} type="button" disabled={accessTokenTrim.length === 0}>
                アクセスキーをコピー
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
