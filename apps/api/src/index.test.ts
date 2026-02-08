import { describe, expect, test } from "bun:test";
import { app } from "./index";

const createInMemoryD1 = () => {
  type DiaryRow = {
    id: string;
    user_id: string;
    date: string;
    status: "draft" | "confirmed";
    generated_text: string;
    final_text: string | null;
    created_at: string;
    updated_at: string;
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
            const [id, userId, date, generatedText] = bound as [string, string, string, string];
            const key = entryKey(userId, date);

            if (!entries.has(key)) {
              entries.set(key, {
                id,
                user_id: userId,
                date,
                status: "draft",
                generated_text: generatedText,
                final_text: null,
                created_at: now(),
                updated_at: now(),
              });
            }

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
      draft?: { title: string; body: string };
      meta?: { cached: boolean };
    };

    expect(response1.status).toBe(200);
    expect(json1.ok).toBe(true);
    expect(json1.draft?.title).toBe("2026-02-07 の未来日記");
    expect(json1.meta?.cached).toBe(false);

    const response2 = await app.request("/v1/future-diary/draft", requestInit, env);
    const json2 = (await response2.json()) as {
      ok: boolean;
      draft?: { title: string; body: string };
      meta?: { cached: boolean };
    };

    expect(response2.status).toBe(200);
    expect(json2.ok).toBe(true);
    expect(json2.draft?.body).toBe(json1.draft?.body);
    expect(json2.meta?.cached).toBe(true);
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
