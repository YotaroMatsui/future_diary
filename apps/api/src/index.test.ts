import { describe, expect, test } from "bun:test";
import { app } from "./index";
import { processGenerationQueueBatch } from "./generationQueueConsumer";

const createInMemoryD1 = () => {
  type DiaryRow = {
    id: string;
    user_id: string;
    date: string;
    status: "draft" | "confirmed";
    generation_status: "created" | "processing" | "failed" | "completed";
    generation_error: string | null;
    generation_source: "llm" | "deterministic" | "fallback" | null;
    generation_user_model_json: string | null;
    generation_source_fragment_ids_json: string;
    generation_keywords_json: string;
    generated_text: string;
    final_text: string | null;
    created_at: string;
    updated_at: string;
  };

  type DiaryEntryRevisionRow = {
    id: string;
    entry_id: string;
    kind: "generated" | "saved" | "confirmed";
    body: string;
    created_at: string;
  };

  type UserRow = {
    id: string;
    timezone: string;
    preferences_json: string;
    created_at: string;
    updated_at: string;
  };

  type AuthSessionRow = {
    id: string;
    user_id: string;
    token_hash: string;
    created_at: string;
    last_used_at: string;
  };

  const now = () => new Date().toISOString();
  const users = new Map<string, UserRow>();
  const entries = new Map<string, DiaryRow>();
  const sessions = new Map<string, AuthSessionRow>();
  const sessionIdByTokenHash = new Map<string, string>();
  const revisions: DiaryEntryRevisionRow[] = [];

  const entryKey = (userId: string, date: string) => `${userId}:${date}`;

  return {
    prepare(query: string) {
      let bound: unknown[] = [];

      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async first<T>() {
          if (
            query.includes("FROM diary_entries") &&
            query.includes("WHERE user_id = ? AND date = ?")
          ) {
            const [userId, date] = bound as [string, string];
            return (entries.get(entryKey(userId, date)) ?? null) as T | null;
          }
          if (query.includes("FROM users") && query.includes("WHERE id = ?")) {
            const [id] = bound as [string];
            return (users.get(id) ?? null) as T | null;
          }
          if (query.includes("FROM auth_sessions") && query.includes("WHERE token_hash = ?")) {
            const [tokenHash] = bound as [string];
            const sessionId = sessionIdByTokenHash.get(tokenHash);
            return (sessionId ? sessions.get(sessionId) ?? null : null) as T | null;
          }
          return null;
        },
        async all<T>() {
          if (
            query.includes("FROM diary_entries") &&
            query.includes("WHERE user_id = ? AND date < ?")
          ) {
            const [userId, beforeDate, limit] = bound as [string, string, number];

            const results = [...entries.values()]
              .filter((row) => row.user_id === userId && row.date < beforeDate)
              .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
              .slice(0, limit);

            return { results } as { results: T[] };
          }
          if (
            query.includes("FROM diary_entries") &&
            query.includes("WHERE user_id = ? AND date <= ?")
          ) {
            const [userId, onOrBeforeDate, limit] = bound as [string, string, number];

            const results = [...entries.values()]
              .filter((row) => row.user_id === userId && row.date <= onOrBeforeDate)
              .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
              .slice(0, limit);

            return { results } as { results: T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (query.includes("INSERT INTO users")) {
            const [id, timezone] = bound as [string, string];
            const existing = users.get(id);

            users.set(id, {
              id,
              timezone,
              preferences_json: existing?.preferences_json ?? "{}",
              created_at: existing?.created_at ?? now(),
              updated_at: now(),
            });

            return { success: true };
          }

          if (query.includes("INSERT INTO auth_sessions")) {
            const [id, userId, tokenHash] = bound as [string, string, string];

            sessions.set(id, {
              id,
              user_id: userId,
              token_hash: tokenHash,
              created_at: now(),
              last_used_at: now(),
            });
            sessionIdByTokenHash.set(tokenHash, id);

            return { success: true };
          }

          if (query.includes("INSERT INTO diary_entries")) {
            const [id, userId, date, generatedText] = bound as [string, string, string, string?];
            const key = entryKey(userId, date);

            if (!entries.has(key)) {
              entries.set(key, {
                id,
                user_id: userId,
                date,
                status: "draft",
                generation_status: bound.length >= 4 ? "completed" : "created",
                generation_error: null,
                generation_source: null,
                generation_user_model_json: null,
                generation_source_fragment_ids_json: "[]",
                generation_keywords_json: "[]",
                generated_text: generatedText ?? "",
                final_text: null,
                created_at: now(),
                updated_at: now(),
              });
            }

            return { success: true };
          }

          if (query.includes("INSERT INTO diary_entry_revisions")) {
            const [id, entryId, kind, body] = bound as [string, string, DiaryEntryRevisionRow["kind"], string];

            revisions.push({
              id,
              entry_id: entryId,
              kind,
              body,
              created_at: now(),
            });

            return { success: true };
          }

          if (query.includes("UPDATE auth_sessions SET last_used_at")) {
            const [sessionId] = bound as [string];
            const existing = sessions.get(sessionId);

            if (existing) {
              sessions.set(sessionId, {
                ...existing,
                last_used_at: now(),
              });
            }

            return { success: true };
          }

          if (query.includes("UPDATE users SET preferences_json")) {
            const [preferencesJson, userId] = bound as [string, string];
            const existing = users.get(userId);

            if (existing) {
              users.set(userId, {
                ...existing,
                preferences_json: preferencesJson,
                updated_at: now(),
              });
            }

            return { success: true };
          }

          if (
            query.includes("UPDATE diary_entries SET generation_status = 'created'") &&
            query.includes("generation_error = ?")
          ) {
            const [generationError, userId, date] = bound as [string, string, string];
            const key = entryKey(userId, date);
            const existing = entries.get(key);

            if (existing) {
              entries.set(key, {
                ...existing,
                generation_status: "created",
                generation_error: generationError,
                updated_at: now(),
              });
            }

            return { success: true };
          }

          if (
            query.includes("UPDATE diary_entries SET generation_status = 'created'") &&
            query.includes("generation_error = NULL")
          ) {
            const [userId, date] = bound as [string, string];
            const key = entryKey(userId, date);
            const existing = entries.get(key);

            if (existing) {
              entries.set(key, {
                ...existing,
                generation_status: "created",
                generation_error: null,
                updated_at: now(),
              });
            }

            return { success: true };
          }

          if (query.includes("UPDATE diary_entries SET generation_status = 'processing'")) {
            const [userId, date] = bound as [string, string];
            const key = entryKey(userId, date);
            const existing = entries.get(key);

            if (existing) {
              entries.set(key, {
                ...existing,
                generation_status: "processing",
                generation_error: null,
                updated_at: now(),
              });
            }

            return { success: true };
          }

          if (query.includes("UPDATE diary_entries SET generation_status = 'failed'")) {
            const [generationError, userId, date] = bound as [string, string, string];
            const key = entryKey(userId, date);
            const existing = entries.get(key);

            if (existing) {
              entries.set(key, {
                ...existing,
                generation_status: "failed",
                generation_error: generationError,
                updated_at: now(),
              });
            }

            return { success: true };
          }

          if (
            query.includes("UPDATE diary_entries SET generation_status = 'completed'") &&
            query.includes("generated_text = ?")
          ) {
            const [
              generationSource,
              generationUserModelJson,
              sourceFragmentIdsJson,
              keywordsJson,
              generatedText,
              userId,
              date,
            ] = bound as [DiaryRow["generation_source"], DiaryRow["generation_user_model_json"], string, string, string, string, string];
            const key = entryKey(userId, date);
            const existing = entries.get(key);

            if (existing) {
              entries.set(key, {
                ...existing,
                generation_status: "completed",
                generation_error: null,
                generation_source: generationSource,
                generation_user_model_json: generationUserModelJson,
                generation_source_fragment_ids_json: sourceFragmentIdsJson,
                generation_keywords_json: keywordsJson,
                generated_text: generatedText,
                updated_at: now(),
              });
            }

            return { success: true };
          }

          if (query.includes("UPDATE diary_entries SET final_text")) {
            const [finalText, userId, date] = bound as [string | null, string, string];
            const key = entryKey(userId, date);
            const existing = entries.get(key);

            if (existing) {
              entries.set(key, {
                ...existing,
                final_text: finalText,
                updated_at: now(),
              });
            }

            return { success: true };
          }

          if (query.includes("DELETE FROM auth_sessions") && query.includes("WHERE id = ?")) {
            const [sessionId] = bound as [string];
            const existing = sessions.get(sessionId);

            if (existing) {
              sessions.delete(sessionId);
              sessionIdByTokenHash.delete(existing.token_hash);
            }

            return { success: true };
          }

          if (query.includes("DELETE FROM auth_sessions") && query.includes("WHERE user_id = ?")) {
            const [userId] = bound as [string];

            for (const session of sessions.values()) {
              if (session.user_id === userId) {
                sessions.delete(session.id);
                sessionIdByTokenHash.delete(session.token_hash);
              }
            }

            return { success: true };
          }

          if (query.includes("DELETE FROM diary_entries") && query.includes("WHERE user_id = ? AND date = ?")) {
            const [userId, date] = bound as [string, string];
            entries.delete(entryKey(userId, date));
            return { success: true };
          }

          if (query.includes("DELETE FROM diary_entries") && query.includes("WHERE user_id = ?")) {
            const [userId] = bound as [string];

            for (const key of entries.keys()) {
              if (key.startsWith(`${userId}:`)) {
                entries.delete(key);
              }
            }

            return { success: true };
          }

          if (query.includes("DELETE FROM users") && query.includes("WHERE id = ?")) {
            const [userId] = bound as [string];
            users.delete(userId);
            return { success: true };
          }

          if (query.includes("UPDATE diary_entries SET status = 'confirmed'")) {
            const [userId, date] = bound as [string, string];
            const key = entryKey(userId, date);
            const existing = entries.get(key);

            if (existing) {
              entries.set(key, {
                ...existing,
                status: "confirmed",
                final_text: existing.final_text ?? existing.generated_text,
                updated_at: now(),
              });
            }

            return { success: true };
          }

          return { success: true };
        },
      };

      return statement;
    },
    __data: { users, entries, revisions },
  };
};

const createAuthSession = async (env: { DB: D1Database }, timezone = "Asia/Tokyo"): Promise<string> => {
  const response = await app.request(
    "/v1/auth/session",
    {
      method: "POST",
      body: JSON.stringify({ timezone }),
      headers: { "content-type": "application/json" },
    },
    env,
  );

  const json = (await response.json()) as { ok?: boolean; accessToken?: string };

  if (!response.ok || json.ok !== true || typeof json.accessToken !== "string") {
    throw new Error(`Failed to create auth session: ${response.status}`);
  }

  return json.accessToken;
};

const authJsonHeaders = (accessToken: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${accessToken}`,
});

describe("future-diary-api", () => {
  test("GET /health returns ok", async () => {
    const response = await app.request("/health");
    const json = (await response.json()) as { ok: boolean; service: string };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.service).toBe("future-diary-api");
  });

  test("POST /v1/auth/session creates session and GET /v1/auth/me returns user", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };

    const createResponse = await app.request(
      "/v1/auth/session",
      {
        method: "POST",
        body: JSON.stringify({ timezone: "Asia/Tokyo" }),
        headers: { "content-type": "application/json" },
      },
      env,
    );

    const createJson = (await createResponse.json()) as {
      ok: boolean;
      accessToken?: string;
      user?: { id?: string; timezone?: string };
    };

    expect(createResponse.status).toBe(200);
    expect(createJson.ok).toBe(true);
    expect(typeof createJson.accessToken).toBe("string");
    expect(typeof createJson.user?.id).toBe("string");
    expect(createJson.user?.timezone).toBe("Asia/Tokyo");

    const accessToken = createJson.accessToken as string;

    const meResponse = await app.request(
      "/v1/auth/me",
      {
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const meJson = (await meResponse.json()) as { ok: boolean; user?: { id?: string; timezone?: string } };

    expect(meResponse.status).toBe(200);
    expect(meJson.ok).toBe(true);
    expect(meJson.user?.id).toBe(createJson.user?.id);
    expect(meJson.user?.timezone).toBe("Asia/Tokyo");
  });

  test("POST /v1/future-diary/draft returns generated draft and caches it", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    const requestInit = {
      method: "POST",
      body: JSON.stringify({
        date: "2026-02-07",
        timezone: "Asia/Tokyo",
      }),
      headers: authJsonHeaders(accessToken),
    } as const;

    const response1 = await app.request("/v1/future-diary/draft", requestInit, env);
    const json1 = (await response1.json()) as {
      ok: boolean;
      draft?: { title: string; body: string; sourceFragmentIds?: readonly string[]; keywords?: readonly string[] };
      meta?: {
        cached: boolean;
        entryId: string;
        generationStatus?: string;
        generation?: {
          source?: "llm" | "deterministic" | "fallback" | null;
          userModel?: { version?: number } | null;
          keywords?: readonly string[];
          sourceFragmentIds?: readonly string[];
        };
      };
    };

    expect(response1.status).toBe(200);
    expect(json1.ok).toBe(true);
    expect(json1.draft?.title).toBe("2026-02-07 の未来日記");
    expect(json1.meta?.cached).toBe(false);
    expect(json1.meta?.generationStatus).toBe("completed");
    expect(json1.meta?.generation?.source).toBe("fallback");
    expect(json1.meta?.generation?.userModel?.version).toBe(1);
    expect(Array.isArray(json1.draft?.sourceFragmentIds)).toBe(true);
    expect(Array.isArray(json1.draft?.keywords)).toBe(true);
    expect(json1.draft?.sourceFragmentIds).toEqual(json1.meta?.generation?.sourceFragmentIds);
    expect(json1.draft?.keywords).toEqual(json1.meta?.generation?.keywords);
    expect(db.__data.revisions.length).toBe(1);
    expect(db.__data.revisions[0]?.kind).toBe("generated");
    expect(db.__data.revisions[0]?.entry_id).toBe(json1.meta?.entryId);
    expect(db.__data.revisions[0]?.body).toBe(json1.draft?.body);

    const response2 = await app.request("/v1/future-diary/draft", requestInit, env);
    const json2 = (await response2.json()) as {
      ok: boolean;
      draft?: { title: string; body: string; sourceFragmentIds?: readonly string[]; keywords?: readonly string[] };
      meta?: {
        cached: boolean;
        entryId: string;
        generationStatus?: string;
        generation?: {
          source?: "llm" | "deterministic" | "fallback" | null;
          userModel?: { version?: number } | null;
          keywords?: readonly string[];
          sourceFragmentIds?: readonly string[];
        };
      };
    };

    expect(response2.status).toBe(200);
    expect(json2.ok).toBe(true);
    expect(json2.draft?.body).toBe(json1.draft?.body);
    expect(json2.meta?.cached).toBe(true);
    expect(json2.meta?.generationStatus).toBe("completed");
    expect(json2.meta?.generation?.source).toBe("fallback");
    expect(json2.meta?.generation?.userModel?.version).toBe(1);
    expect(json2.draft?.sourceFragmentIds).toEqual(json1.draft?.sourceFragmentIds);
    expect(json2.draft?.keywords).toEqual(json1.draft?.keywords);
    expect(db.__data.revisions.length).toBe(1);
  });

  test("POST /v1/future-diary/draft enqueues async generation when queue binding exists", async () => {
    const db = createInMemoryD1();
    const sent: unknown[] = [];

    const env = {
      DB: db as unknown as D1Database,
      GENERATION_QUEUE: {
        async send(message: unknown) {
          sent.push(message);
        },
      } as unknown as Queue<unknown>,
    };

    const accessToken = await createAuthSession(env);

    const requestInit = {
      method: "POST",
      body: JSON.stringify({
        date: "2026-02-07",
        timezone: "Asia/Tokyo",
      }),
      headers: authJsonHeaders(accessToken),
    } as const;

    const response1 = await app.request("/v1/future-diary/draft", requestInit, env);
    const json1 = (await response1.json()) as {
      ok: boolean;
      draft?: { body: string };
      meta?: { userId?: string; generationStatus?: string; source?: string };
    };

    expect(response1.status).toBe(200);
    expect(json1.ok).toBe(true);
    expect(json1.meta?.generationStatus).toBe("created");
    expect(json1.meta?.source).toBe("queued");
    expect(typeof json1.draft?.body).toBe("string");

    const userId = json1.meta?.userId;
    expect(typeof userId).toBe("string");

    expect(
      sent.some(
        (message) => {
          if (typeof message !== "object" || message === null) {
            return false;
          }

          const record = message as { kind?: unknown; userId?: unknown };
          return record.kind === "future_draft_generate" && record.userId === userId;
        },
      ),
    ).toBe(true);

    const batch = {
      messages: sent.map((body) => ({
        body,
        ack: () => {},
        retry: () => {},
      })),
    } as unknown as MessageBatch<unknown>;

    await processGenerationQueueBatch(batch, env as unknown as any, {} as ExecutionContext);

    const response2 = await app.request("/v1/future-diary/draft", requestInit, env);
    const json2 = (await response2.json()) as {
      ok: boolean;
      draft?: { body: string; sourceFragmentIds?: readonly string[]; keywords?: readonly string[] };
      meta?: {
        generationStatus?: string;
        generation?: { source?: "llm" | "deterministic" | "fallback" | null; userModel?: { version?: number } | null };
      };
    };

    expect(response2.status).toBe(200);
    expect(json2.ok).toBe(true);
    expect(json2.meta?.generationStatus).toBe("completed");
    expect(json2.meta?.generation?.source).toBe("fallback");
    expect(json2.meta?.generation?.userModel?.version).toBe(1);
    expect(json2.draft?.body.length).toBeGreaterThan(0);
    expect(Array.isArray(json2.draft?.sourceFragmentIds)).toBe(true);
    expect(Array.isArray(json2.draft?.keywords)).toBe(true);
    expect(db.__data.revisions.length).toBe(1);
    expect(db.__data.revisions[0]?.kind).toBe("generated");
  });

  test("GET/POST /v1/user/model returns and updates user model", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    const get1 = await app.request(
      "/v1/user/model",
      {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      },
      env,
    );
    const json1 = (await get1.json()) as { ok: boolean; model?: any; parseError?: any };
    expect(get1.status).toBe(200);
    expect(json1.ok).toBe(true);
    expect(json1.model?.version).toBe(1);

    const update = await app.request(
      "/v1/user/model",
      {
        method: "POST",
        headers: authJsonHeaders(accessToken),
        body: JSON.stringify({
          model: {
            intent: "落ち着いて始める",
            styleHints: { maxParagraphs: 3 },
            preferences: { avoidCopyingFromFragments: false },
          },
        }),
      },
      env,
    );
    const updateJson = (await update.json()) as { ok: boolean; model?: any };
    expect(update.status).toBe(200);
    expect(updateJson.ok).toBe(true);
    expect(updateJson.model?.intent).toBe("落ち着いて始める");
    expect(updateJson.model?.styleHints?.maxParagraphs).toBe(3);
    expect(updateJson.model?.preferences?.avoidCopyingFromFragments).toBe(false);

    const get2 = await app.request(
      "/v1/user/model",
      {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      },
      env,
    );
    const json2 = (await get2.json()) as { ok: boolean; model?: any };
    expect(get2.status).toBe(200);
    expect(json2.ok).toBe(true);
    expect(json2.model?.intent).toBe("落ち着いて始める");
  });

  test("POST /v1/user/model/reset resets model", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    const updated = await app.request(
      "/v1/user/model",
      {
        method: "POST",
        headers: authJsonHeaders(accessToken),
        body: JSON.stringify({
          model: {
            intent: "test",
            preferences: { avoidCopyingFromFragments: false },
          },
        }),
      },
      env,
    );
    expect(updated.status).toBe(200);

    const reset = await app.request(
      "/v1/user/model/reset",
      {
        method: "POST",
        headers: authJsonHeaders(accessToken),
        body: JSON.stringify({}),
      },
      env,
    );
    const resetJson = (await reset.json()) as { ok: boolean; model?: any };
    expect(reset.status).toBe(200);
    expect(resetJson.ok).toBe(true);
    expect(resetJson.model?.version).toBe(1);

    const get = await app.request(
      "/v1/user/model",
      {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      },
      env,
    );
    const json = (await get.json()) as { ok: boolean; model?: any };
    expect(get.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.model?.intent).toBe("");
  });

  test("POST /v1/diary/entry/delete deletes an entry", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07", timezone: "Asia/Tokyo" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const deleteResponse = await app.request(
      "/v1/diary/entry/delete",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const deleteJson = (await deleteResponse.json()) as { ok: boolean; deleted?: boolean };
    expect(deleteResponse.status).toBe(200);
    expect(deleteJson.ok).toBe(true);
    expect(deleteJson.deleted).toBe(true);

    const getResponse = await app.request(
      "/v1/diary/entry/get",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    expect(getResponse.status).toBe(404);
  });

  test("POST /v1/user/delete deletes user data and invalidates token", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07", timezone: "Asia/Tokyo" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const deleteResponse = await app.request(
      "/v1/user/delete",
      {
        method: "POST",
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const deleteJson = (await deleteResponse.json()) as { ok: boolean };
    expect(deleteResponse.status).toBe(200);
    expect(deleteJson.ok).toBe(true);

    const meResponse = await app.request(
      "/v1/auth/me",
      {
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    expect(meResponse.status).toBe(401);
  });

  test("POST /v1/future-diary/draft uses OpenAI when OPENAI_API_KEY is set", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);

      if (!url.endsWith("/v1/responses")) {
        return originalFetch(input, init);
      }

      const requestJson = JSON.parse(String(init?.body ?? "null")) as { model?: string };
      if (requestJson.model !== "gpt-4o-mini") {
        return new Response("unexpected model", { status: 400 });
      }

      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    body: "今日は少しずつ整えていく一日にしたい。\n\n（ここに今日の出来事を追記する）\n\n夜に事実を追記して、確定日記にする。",
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      const db = createInMemoryD1();
      const env = {
        DB: db as unknown as D1Database,
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: "https://example.test/v1",
        OPENAI_MODEL: "gpt-4o-mini",
      };

      const accessToken = await createAuthSession(env);

      const response = await app.request(
        "/v1/future-diary/draft",
        {
          method: "POST",
          body: JSON.stringify({
            date: "2026-02-07",
            timezone: "Asia/Tokyo",
          }),
          headers: authJsonHeaders(accessToken),
        },
        env,
      );

      const json = (await response.json()) as {
        ok: boolean;
        meta?: { source?: string };
        draft?: { body: string };
      };

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.meta?.source).toBe("llm");
      expect(json.draft?.body).toContain("今日は少しずつ整えていく一日にしたい。");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("POST /v1/diary/entry/save persists edits and GET returns the edited body", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07", timezone: "Asia/Tokyo" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const saveResponse = await app.request(
      "/v1/diary/entry/save",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07", body: "edited body" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    expect(saveResponse.status).toBe(200);
    expect(db.__data.revisions.length).toBe(2);
    expect(db.__data.revisions[1]?.kind).toBe("saved");
    expect(db.__data.revisions[1]?.body).toBe("edited body");

    const getResponse = await app.request(
      "/v1/diary/entry/get",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const json = (await getResponse.json()) as { ok: boolean; body?: string };
    expect(getResponse.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.body).toBe("edited body");
  });

  test("POST /v1/future-diary/draft returns edited body when entry was saved", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    const requestInit = {
      method: "POST",
      body: JSON.stringify({
        date: "2026-02-07",
        timezone: "Asia/Tokyo",
      }),
      headers: authJsonHeaders(accessToken),
    } as const;

    await app.request("/v1/future-diary/draft", requestInit, env);

    await app.request(
      "/v1/diary/entry/save",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07", body: "edited body" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const response = await app.request("/v1/future-diary/draft", requestInit, env);
    const json = (await response.json()) as {
      ok: boolean;
      draft?: { body: string };
      meta?: { cached?: boolean };
    };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.draft?.body).toBe("edited body");
    expect(json.meta?.cached).toBe(true);
  });

  test("POST /v1/diary/entry/confirm marks entry as confirmed and keeps body editable", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    const draftResponse = await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07", timezone: "Asia/Tokyo" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const draftJson = (await draftResponse.json()) as { ok: boolean; draft?: { body: string } };
    expect(draftResponse.status).toBe(200);
    expect(draftJson.ok).toBe(true);
    expect(db.__data.revisions.length).toBe(1);
    expect(db.__data.revisions[0]?.kind).toBe("generated");

    const confirmResponse = await app.request(
      "/v1/diary/entry/confirm",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const confirmJson = (await confirmResponse.json()) as {
      ok: boolean;
      entry?: { status: "draft" | "confirmed"; finalText: string | null };
      body?: string;
    };

    expect(confirmResponse.status).toBe(200);
    expect(confirmJson.ok).toBe(true);
    expect(confirmJson.entry?.status).toBe("confirmed");
    expect(confirmJson.entry?.finalText).toBe(draftJson.draft?.body ?? null);
    expect(confirmJson.body).toBe(draftJson.draft?.body);
    expect(db.__data.revisions.length).toBe(2);
    expect(db.__data.revisions[1]?.kind).toBe("confirmed");
    expect(db.__data.revisions[1]?.body).toBe(draftJson.draft?.body);
  });

  test("POST /v1/diary/entries/list returns recent entries", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };
    const accessToken = await createAuthSession(env);

    await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-07", timezone: "Asia/Tokyo" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-02-06", timezone: "Asia/Tokyo" }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const response = await app.request(
      "/v1/diary/entries/list",
      {
        method: "POST",
        body: JSON.stringify({ onOrBeforeDate: "2026-02-07", limit: 10 }),
        headers: authJsonHeaders(accessToken),
      },
      env,
    );

    const json = (await response.json()) as {
      ok: boolean;
      entries?: Array<{ date: string; body: string }>;
    };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.entries?.map((entry) => entry.date)).toEqual(["2026-02-07", "2026-02-06"]);
    expect(json.entries?.[0]?.body).toContain("今日は無理をせず");
  });
});
