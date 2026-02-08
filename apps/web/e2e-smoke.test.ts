import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { app as apiApp } from "../api/src/index";
import {
  confirmDiaryEntry,
  fetchFutureDiaryDraft,
  fetchHealth,
  listDiaryEntries,
  saveDiaryEntry,
} from "./src/api";

type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
};

type D1DatabaseLike = {
  prepare(query: string): D1StatementLike;
};

const createSqliteD1 = (db: Database): D1DatabaseLike => ({
  prepare(query: string) {
    const stmt = db.query(query);
    let bound: unknown[] = [];

    const statement: D1StatementLike = {
      bind(...values) {
        bound = values;
        return statement;
      },
      async first<T>() {
        const row = stmt.get(...bound) as T | undefined;
        return row ?? null;
      },
      async all<T>() {
        const results = stmt.all(...bound) as T[];
        return { results };
      },
      async run() {
        stmt.run(...bound);
        return { success: true };
      },
    };

    return statement;
  },
});

const applyMigrations = async (db: Database) => {
  const migrationsDirUrl = new URL("../../packages/db/src/migrations/", import.meta.url);
  const migrationsDirPath = Bun.fileURLToPath(migrationsDirUrl);
  const glob = new Bun.Glob("*.sql");
  const migrationFiles: string[] = [];

  for await (const filename of glob.scan(migrationsDirPath)) {
    migrationFiles.push(filename);
  }

  migrationFiles.sort();

  db.exec("PRAGMA foreign_keys = ON;");

  if (migrationFiles.length === 0) {
    throw new Error("No D1 migration files found");
  }

  for (const filename of migrationFiles) {
    const sql = await Bun.file(`${migrationsDirPath}/${filename}`).text();
    db.exec(sql);
  }
};

test("E2E smoke (web -> api -> d1): draft -> save -> confirm -> list", async () => {
  const sqlite = new Database(":memory:");
  const d1 = createSqliteD1(sqlite);
  await applyMigrations(sqlite);

  const env = { DB: d1 } as unknown as { DB: D1Database };

  const originalFetch = globalThis.fetch;
  const baseUrl = "https://future-diary.local";

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(baseUrl)) {
      return await originalFetch(input as any, init as any);
    }

    const requestUrl = new URL(url);
    const path = `${requestUrl.pathname}${requestUrl.search}`;
    return await apiApp.request(path, init as RequestInit, env);
  };

  try {
    const health = await fetchHealth(baseUrl);
    expect(health.ok).toBe(true);

    const userId = `e2e-${crypto.randomUUID()}`;
    const date = "2026-02-07";
    const timezone = "Asia/Tokyo";

    const draft = await fetchFutureDiaryDraft(baseUrl, { userId, date, timezone });
    expect(draft.ok).toBe(true);
    expect(draft.meta.userId).toBe(userId);
    expect(draft.meta.status).toBe("draft");
    expect(draft.draft.body.length).toBeGreaterThan(0);

    const editedBody = "edited body (e2e smoke)";
    const saved = await saveDiaryEntry(baseUrl, { userId, date, body: editedBody });
    expect(saved.ok).toBe(true);
    expect(saved.body).toBe(editedBody);

    const confirmed = await confirmDiaryEntry(baseUrl, { userId, date });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.entry.status).toBe("confirmed");
    expect(confirmed.body).toBe(editedBody);

    const listed = await listDiaryEntries(baseUrl, { userId, onOrBeforeDate: date, limit: 30 });
    expect(listed.ok).toBe(true);
    expect(listed.entries.length).toBeGreaterThanOrEqual(1);
    expect(listed.entries[0]?.date).toBe(date);
    expect(listed.entries[0]?.status).toBe("confirmed");
    expect(listed.entries[0]?.body).toBe(editedBody);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
