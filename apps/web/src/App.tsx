import { diaryStatusLabel } from "@future-diary/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiaryEntryWithBody, DiaryStatus, FutureDiaryDraftResponse } from "./api";
import { confirmDiaryEntry, fetchFutureDiaryDraft, listDiaryEntries, saveDiaryEntry } from "./api";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

const storageKeys = {
  userId: "futureDiary.userId",
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

type ToastState = {
  kind: "info" | "error";
  message: string;
} | null;

export const App = () => {
  const defaultTimezone = useMemo(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof resolved === "string" && resolved.length > 0 ? resolved : "Asia/Tokyo";
  }, []);

  const [userId, setUserId] = useState(() => readLocalStorageString(storageKeys.userId) ?? "");
  const [timezone, setTimezone] = useState(() => readLocalStorageString(storageKeys.timezone) ?? defaultTimezone);
  const [selectedDate, setSelectedDate] = useState(() => formatDateInTimeZone(new Date(), timezone));

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
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const todayDate = useMemo(() => formatDateInTimeZone(new Date(), timezone), [timezone]);

  const userIdTrim = userId.trim();
  const timezoneTrim = timezone.trim();
  const canCallApi = userIdTrim.length > 0 && timezoneTrim.length > 0;
  const hasLoadedEntry = entryId !== null && status !== null;

  const refreshHistory = useCallback(
    async (opts?: { onOrBeforeDate?: string }): Promise<void> => {
      if (!canCallApi) {
        setHistory([]);
        return;
      }

      setHistoryLoading(true);
      try {
        const response = await listDiaryEntries(apiBaseUrl, {
          userId: userIdTrim,
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
    [canCallApi, userIdTrim],
  );

  const loadDraft = useCallback(
    async (opts: { date: string; reason: "auto" | "manual" }): Promise<void> => {
      if (!canCallApi) {
        setToast({ kind: "error", message: "userId と timezone を入力してください。" });
        return;
      }

      setDraftLoading(true);
      setToast(opts.reason === "auto" ? null : { kind: "info", message: "未来日記を生成しています..." });
      try {
        const response = await fetchFutureDiaryDraft(apiBaseUrl, {
          userId: userIdTrim,
          date: opts.date,
          timezone: timezoneTrim,
        });

        setSelectedDate(opts.date);
        setEntryId(response.meta.entryId);
        setStatus(response.meta.status);
        setTitle(response.draft.title);
        setBody(response.draft.body);
        setSourceFragmentIds(response.draft.sourceFragmentIds);
        setDraftMeta(response.meta);
        setDirty(false);

        await refreshHistory();

        setToast({
          kind: "info",
          message:
            response.meta.source === "cached"
              ? "既存の日記を読み込みました。"
              : "新しい未来日記（下書き）を作成しました。",
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        setToast({ kind: "error", message: `未来日記の生成に失敗しました: ${errorMessage}` });
      } finally {
        setDraftLoading(false);
      }
    },
    [canCallApi, refreshHistory, timezoneTrim, userIdTrim],
  );

  const onSave = useCallback(async (): Promise<void> => {
    if (!canCallApi) {
      setToast({ kind: "error", message: "userId と timezone を入力してください。" });
      return;
    }

    if (!hasLoadedEntry) {
      setToast({ kind: "error", message: "保存する対象の日記がありません。" });
      return;
    }

    setSaveLoading(true);
    setToast({ kind: "info", message: "保存しています..." });
    try {
      const response = await saveDiaryEntry(apiBaseUrl, { userId: userIdTrim, date: selectedDate, body });
      setStatus(response.entry.status);
      setBody(response.body);
      setDirty(false);
      await refreshHistory();
      setToast({ kind: "info", message: "保存しました。" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `保存に失敗しました: ${errorMessage}` });
    } finally {
      setSaveLoading(false);
    }
  }, [body, canCallApi, hasLoadedEntry, refreshHistory, selectedDate, userIdTrim]);

  const onConfirm = useCallback(async (): Promise<void> => {
    if (!canCallApi) {
      setToast({ kind: "error", message: "userId と timezone を入力してください。" });
      return;
    }

    if (!hasLoadedEntry) {
      setToast({ kind: "error", message: "確定する対象の日記がありません。" });
      return;
    }

    setConfirmLoading(true);
    setToast({ kind: "info", message: "確定しています..." });
    try {
      const response = await confirmDiaryEntry(apiBaseUrl, { userId: userIdTrim, date: selectedDate });
      setStatus(response.entry.status);
      setBody(response.body);
      setDirty(false);
      await refreshHistory();
      setToast({ kind: "info", message: "確定しました。" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setToast({ kind: "error", message: `確定に失敗しました: ${errorMessage}` });
    } finally {
      setConfirmLoading(false);
    }
  }, [canCallApi, hasLoadedEntry, refreshHistory, selectedDate, userIdTrim]);

  const onSelectHistoryEntry = useCallback((entry: DiaryEntryWithBody): void => {
    setSelectedDate(entry.date);
    setEntryId(entry.id);
    setStatus(entry.status);
    setTitle(`${entry.date} の未来日記`);
    setBody(entry.body);
    setSourceFragmentIds([]);
    setDraftMeta(null);
    setDirty(false);
    setToast({ kind: "info", message: `${entry.date} を読み込みました。` });
  }, []);

  useEffect(() => {
    writeLocalStorageString(storageKeys.userId, userIdTrim);
  }, [userIdTrim]);

  useEffect(() => {
    writeLocalStorageString(storageKeys.timezone, timezoneTrim);
  }, [timezoneTrim]);

  useEffect(() => {
    if (!canCallApi) {
      return;
    }

    // 当日初回オープンの draft 生成（API 側で冪等化される）。
    if (entryId !== null) {
      return;
    }

    void loadDraft({ date: todayDate, reason: "auto" });
  }, [canCallApi, entryId, loadDraft, todayDate]);

  return (
    <div className="app">
      <header className="appHeader">
        <div className="appHeader__brand">
          <h1 className="appHeader__title">Future Diary</h1>
          <p className="appHeader__subtitle">当日初回の下書きを作り、編集して確定する。</p>
        </div>
        <div className="appHeader__meta">
          <div className="pill pill--neutral">API: {apiBaseUrl}</div>
          <button
            className="button button--ghost"
            onClick={() => void loadDraft({ date: todayDate, reason: "manual" })}
            type="button"
            disabled={!canCallApi || draftLoading}
          >
            今日を再読み込み
          </button>
        </div>
      </header>

      <div className="layout">
        <section className="main">
          <div className="card card--controls">
            <div className="controls">
              <label className="field">
                <span className="field__label">userId</span>
                <input
                  className="input"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  placeholder="例: u1"
                  autoComplete="username"
                />
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
                disabled={!canCallApi || !hasLoadedEntry || saveLoading || draftLoading || confirmLoading || !dirty}
              >
                {saveLoading ? "保存中..." : "保存"}
              </button>

              <button
                className="button button--danger"
                onClick={() => void onConfirm()}
                type="button"
                disabled={
                  !canCallApi || !hasLoadedEntry || confirmLoading || draftLoading || saveLoading || status === "confirmed"
                }
              >
                {confirmLoading ? "確定中..." : status === "confirmed" ? "確定済み" : "確定"}
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
              userId は認証の代替です。ここで入力した値はブラウザに保存されます。日付を変えると任意日の下書きを生成できます。
              生成は原則として「選択日付より前の日記」を参照し、選択日付より後の日記は参照しません。
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
                  {draftMeta ? <span className="pill pill--neutral">source: {draftMeta.source}</span> : null}
                  {draftMeta ? (
                    <span className={`pill ${draftMeta.cached ? "pill--neutral" : "pill--info"}`}>
                      {draftMeta.cached ? "cached" : "fresh"}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="editorHeader__right">
                <span className={`saveState ${dirty ? "saveState--dirty" : "saveState--clean"}`}>
                  {dirty ? "unsaved" : "saved"}
                </span>
              </div>
            </div>

            <textarea
              className="textarea"
              value={body}
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

          {toast ? (
            <div className={`toast ${toast.kind === "error" ? "toast--error" : "toast--info"}`}>{toast.message}</div>
          ) : null}
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
                    </div>
                    <div className="historyEntry__snippet">{normalizeSnippet(entry.body, 110)}</div>
                  </button>
                </li>
              ))}
            </ol>

            {historyLoading ? <p className="hint">loading...</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
};
