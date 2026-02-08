import type { DiaryEntry } from "@future-diary/core";
import type { AuthSessionRow, DiaryEntryRevisionKind, DiaryRow, UserRow } from "./schema";

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

export type User = {
  id: string;
  timezone: string;
  preferencesJson: string;
  createdAt: string;
  updatedAt: string;
};

const toUser = (row: UserRow): User => ({
  id: row.id,
  timezone: row.timezone,
  preferencesJson: row.preferences_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt: string;
};

const toAuthSession = (row: AuthSessionRow): AuthSession => ({
  id: row.id,
  userId: row.user_id,
  tokenHash: row.token_hash,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
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
  deleteByUserAndDate(userId: string, date: string): Promise<boolean>;
  deleteByUser(userId: string): Promise<void>;
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

  const deleteByUserAndDate = async (userId: string, date: string): Promise<boolean> => {
    const existing = await findByUserAndDate(userId, date);
    if (existing === null) {
      return false;
    }

    await db.prepare("DELETE FROM diary_entries WHERE user_id = ? AND date = ?").bind(userId, date).run();
    return true;
  };

  const deleteByUser = async (userId: string): Promise<void> => {
    await db.prepare("DELETE FROM diary_entries WHERE user_id = ?").bind(userId).run();
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
    deleteByUserAndDate,
    deleteByUser,
  };
};

export interface DiaryEntryRevision {
  id: string;
  entryId: string;
  kind: DiaryEntryRevisionKind;
  body: string;
  createdAt: string;
}

export interface DiaryRevisionRepository {
  appendRevision(revision: Pick<DiaryEntryRevision, "id" | "entryId" | "kind" | "body">): Promise<void>;
}

export const createDiaryRevisionRepository = (db: D1DatabaseLike): DiaryRevisionRepository => ({
  async appendRevision(revision) {
    await db
      .prepare(
        `INSERT INTO diary_entry_revisions (id, entry_id, kind, body, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .bind(revision.id, revision.entryId, revision.kind, revision.body)
      .run();
  },
});

export interface UserRepository {
  upsertUser(user: { id: string; timezone: string }): Promise<void>;
  findById(userId: string): Promise<User | null>;
  deleteUser(userId: string): Promise<boolean>;
}

export const createUserRepository = (db: D1DatabaseLike): UserRepository => {
  const upsertUser = async (user: { id: string; timezone: string }): Promise<void> => {
    await db
      .prepare(
        `INSERT INTO users (id, timezone, preferences_json, created_at, updated_at)
         VALUES (?, ?, '{}', datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET timezone = excluded.timezone, updated_at = datetime('now')`,
      )
      .bind(user.id, user.timezone)
      .run();
  };

  const findById = async (userId: string): Promise<User | null> => {
    const row = await db
      .prepare("SELECT id, timezone, preferences_json, created_at, updated_at FROM users WHERE id = ?")
      .bind(userId)
      .first<UserRow>();

    return row === null ? null : toUser(row);
  };

  const deleteUser = async (userId: string): Promise<boolean> => {
    const existing = await findById(userId);
    if (existing === null) {
      return false;
    }

    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    return true;
  };

  return {
    upsertUser,
    findById,
    deleteUser,
  };
};

export interface AuthSessionRepository {
  findByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  createSession(input: { id: string; userId: string; tokenHash: string }): Promise<void>;
  touchSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
}

export const createAuthSessionRepository = (db: D1DatabaseLike): AuthSessionRepository => {
  const findByTokenHash = async (tokenHash: string): Promise<AuthSession | null> => {
    const row = await db
      .prepare("SELECT id, user_id, token_hash, created_at, last_used_at FROM auth_sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<AuthSessionRow>();

    return row === null ? null : toAuthSession(row);
  };

  const createSession = async (input: { id: string; userId: string; tokenHash: string }): Promise<void> => {
    await db
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_used_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .bind(input.id, input.userId, input.tokenHash)
      .run();
  };

  const touchSession = async (sessionId: string): Promise<void> => {
    await db.prepare("UPDATE auth_sessions SET last_used_at = datetime('now') WHERE id = ?").bind(sessionId).run();
  };

  const deleteSession = async (sessionId: string): Promise<void> => {
    await db.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(sessionId).run();
  };

  const deleteByUserId = async (userId: string): Promise<void> => {
    await db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId).run();
  };

  return {
    findByTokenHash,
    createSession,
    touchSession,
    deleteSession,
    deleteByUserId,
  };
};
