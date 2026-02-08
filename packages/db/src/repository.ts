import type { DiaryEntry } from "@future-diary/core";
import type { DiaryRow } from "./schema";

interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T>(columnName?: keyof T): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
}

const toDiaryEntry = (row: DiaryRow): DiaryEntry => ({
  id: row.id,
  userId: row.user_id,
  date: row.date,
  status: row.status,
  generationStatus: row.generation_status,
  generationError: row.generation_error,
  generatedText: row.generated_text,
  finalText: row.final_text,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface DiaryRepository {
  findByUserAndDate(userId: string, date: string): Promise<DiaryEntry | null>;
  listRecentByUserBeforeDate(userId: string, beforeDate: string, limit: number): Promise<DiaryEntry[]>;
  listRecentByUserOnOrBeforeDate(userId: string, onOrBeforeDate: string, limit: number): Promise<DiaryEntry[]>;
  createDraftIfMissing(entry: Pick<DiaryEntry, "id" | "userId" | "date" | "generatedText">): Promise<void>;
  createDraftGenerationPlaceholderIfMissing(entry: Pick<DiaryEntry, "id" | "userId" | "date">): Promise<void>;
  markDraftGenerationCreated(userId: string, date: string): Promise<DiaryEntry | null>;
  markDraftGenerationCreatedWithError(userId: string, date: string, errorMessage: string): Promise<DiaryEntry | null>;
  markDraftGenerationProcessing(userId: string, date: string): Promise<DiaryEntry | null>;
  markDraftGenerationFailed(userId: string, date: string, errorMessage: string): Promise<DiaryEntry | null>;
  completeDraftGeneration(userId: string, date: string, generatedText: string): Promise<DiaryEntry | null>;
  updateFinalText(userId: string, date: string, finalText: string | null): Promise<DiaryEntry | null>;
  confirmEntry(userId: string, date: string): Promise<DiaryEntry | null>;
}

export const createDiaryRepository = (db: D1DatabaseLike): DiaryRepository => {
  const findByUserAndDate = async (userId: string, date: string): Promise<DiaryEntry | null> => {
    const row = await db
      .prepare(
        "SELECT id, user_id, date, status, generation_status, generation_error, generated_text, final_text, created_at, updated_at FROM diary_entries WHERE user_id = ? AND date = ?",
      )
      .bind(userId, date)
      .first<DiaryRow>();

    return row === null ? null : toDiaryEntry(row);
  };

  const listRecentByUserBeforeDate = async (userId: string, beforeDate: string, limit: number): Promise<DiaryEntry[]> => {
    const response = await db
      .prepare(
        "SELECT id, user_id, date, status, generation_status, generation_error, generated_text, final_text, created_at, updated_at FROM diary_entries WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT ?",
      )
      .bind(userId, beforeDate, limit)
      .all<DiaryRow>();

    return response.results.map(toDiaryEntry);
  };

  const listRecentByUserOnOrBeforeDate = async (
    userId: string,
    onOrBeforeDate: string,
    limit: number,
  ): Promise<DiaryEntry[]> => {
    const response = await db
      .prepare(
        "SELECT id, user_id, date, status, generation_status, generation_error, generated_text, final_text, created_at, updated_at FROM diary_entries WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT ?",
      )
      .bind(userId, onOrBeforeDate, limit)
      .all<DiaryRow>();

    return response.results.map(toDiaryEntry);
  };

  const createDraftIfMissing = async (
    entry: Pick<DiaryEntry, "id" | "userId" | "date" | "generatedText">,
  ): Promise<void> => {
    await db
      .prepare(
        `INSERT INTO diary_entries (id, user_id, date, status, generation_status, generation_error, generated_text, final_text, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', 'completed', NULL, ?, NULL, datetime('now'), datetime('now'))
         ON CONFLICT(user_id, date) DO NOTHING`,
      )
      .bind(entry.id, entry.userId, entry.date, entry.generatedText)
      .run();
  };

  const createDraftGenerationPlaceholderIfMissing = async (
    entry: Pick<DiaryEntry, "id" | "userId" | "date">,
  ): Promise<void> => {
    await db
      .prepare(
        `INSERT INTO diary_entries (id, user_id, date, status, generation_status, generation_error, generated_text, final_text, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', 'created', NULL, '', NULL, datetime('now'), datetime('now'))
         ON CONFLICT(user_id, date) DO NOTHING`,
      )
      .bind(entry.id, entry.userId, entry.date)
      .run();
  };

  const markDraftGenerationCreated = async (userId: string, date: string): Promise<DiaryEntry | null> => {
    const existing = await findByUserAndDate(userId, date);
    if (existing === null) {
      return null;
    }

    await db
      .prepare(
        "UPDATE diary_entries SET generation_status = 'created', generation_error = NULL, updated_at = datetime('now') WHERE user_id = ? AND date = ?",
      )
      .bind(userId, date)
      .run();

    return await findByUserAndDate(userId, date);
  };

  const markDraftGenerationCreatedWithError = async (
    userId: string,
    date: string,
    errorMessage: string,
  ): Promise<DiaryEntry | null> => {
    const existing = await findByUserAndDate(userId, date);
    if (existing === null) {
      return null;
    }

    await db
      .prepare(
        "UPDATE diary_entries SET generation_status = 'created', generation_error = ?, updated_at = datetime('now') WHERE user_id = ? AND date = ?",
      )
      .bind(errorMessage, userId, date)
      .run();

    return await findByUserAndDate(userId, date);
  };

  const markDraftGenerationProcessing = async (userId: string, date: string): Promise<DiaryEntry | null> => {
    const existing = await findByUserAndDate(userId, date);
    if (existing === null) {
      return null;
    }

    await db
      .prepare(
        "UPDATE diary_entries SET generation_status = 'processing', generation_error = NULL, updated_at = datetime('now') WHERE user_id = ? AND date = ?",
      )
      .bind(userId, date)
      .run();

    return await findByUserAndDate(userId, date);
  };

  const markDraftGenerationFailed = async (
    userId: string,
    date: string,
    errorMessage: string,
  ): Promise<DiaryEntry | null> => {
    const existing = await findByUserAndDate(userId, date);
    if (existing === null) {
      return null;
    }

    await db
      .prepare(
        "UPDATE diary_entries SET generation_status = 'failed', generation_error = ?, updated_at = datetime('now') WHERE user_id = ? AND date = ?",
      )
      .bind(errorMessage, userId, date)
      .run();

    return await findByUserAndDate(userId, date);
  };

  const completeDraftGeneration = async (userId: string, date: string, generatedText: string): Promise<DiaryEntry | null> => {
    const existing = await findByUserAndDate(userId, date);
    if (existing === null) {
      return null;
    }

    await db
      .prepare(
        "UPDATE diary_entries SET generation_status = 'completed', generation_error = NULL, generated_text = ?, updated_at = datetime('now') WHERE user_id = ? AND date = ?",
      )
      .bind(generatedText, userId, date)
      .run();

    return await findByUserAndDate(userId, date);
  };

  const updateFinalText = async (userId: string, date: string, finalText: string | null): Promise<DiaryEntry | null> => {
    const existing = await findByUserAndDate(userId, date);
    if (existing === null) {
      return null;
    }

    await db
      .prepare("UPDATE diary_entries SET final_text = ?, updated_at = datetime('now') WHERE user_id = ? AND date = ?")
      .bind(finalText, userId, date)
      .run();

    return await findByUserAndDate(userId, date);
  };

  const confirmEntry = async (userId: string, date: string): Promise<DiaryEntry | null> => {
    const existing = await findByUserAndDate(userId, date);
    if (existing === null) {
      return null;
    }

    await db
      .prepare(
        "UPDATE diary_entries SET status = 'confirmed', final_text = COALESCE(final_text, generated_text), updated_at = datetime('now') WHERE user_id = ? AND date = ?",
      )
      .bind(userId, date)
      .run();

    return await findByUserAndDate(userId, date);
  };

  return {
    findByUserAndDate,
    listRecentByUserBeforeDate,
    listRecentByUserOnOrBeforeDate,
    createDraftIfMissing,
    createDraftGenerationPlaceholderIfMissing,
    markDraftGenerationCreated,
    markDraftGenerationCreatedWithError,
    markDraftGenerationProcessing,
    markDraftGenerationFailed,
    completeDraftGeneration,
    updateFinalText,
    confirmEntry,
  };
};

export interface UserRepository {
  upsertUser(user: { id: string; timezone: string }): Promise<void>;
}

export const createUserRepository = (db: D1DatabaseLike): UserRepository => ({
  async upsertUser(user) {
    await db
      .prepare(
        `INSERT INTO users (id, timezone, preferences_json, created_at, updated_at)
         VALUES (?, ?, '{}', datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET timezone = excluded.timezone, updated_at = datetime('now')`,
      )
      .bind(user.id, user.timezone)
      .run();
  },
});
