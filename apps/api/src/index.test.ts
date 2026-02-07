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

  const now = () => new Date().toISOString();
  const users = new Map<string, UserRow>();
  const entries = new Map<string, DiaryRow>();

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

describe("future-diary-api", () => {
  test("GET /health returns ok", async () => {
    const response = await app.request("/health");
    const json = (await response.json()) as { ok: boolean; service: string };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.service).toBe("future-diary-api");
  });

  test("POST /v1/future-diary/draft returns generated draft and caches it", async () => {
    const db = createInMemoryD1();
    const env = { DB: db as unknown as D1Database };

    const requestInit = {
      method: "POST",
      body: JSON.stringify({
        userId: "user-1",
        date: "2026-02-07",
        timezone: "Asia/Tokyo",
      }),
      headers: {
        "content-type": "application/json",
      },
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

      const response = await app.request(
        "/v1/future-diary/draft",
        {
          method: "POST",
          body: JSON.stringify({
            userId: "user-1",
            date: "2026-02-07",
            timezone: "Asia/Tokyo",
          }),
          headers: { "content-type": "application/json" },
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

    await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-1", date: "2026-02-07", timezone: "Asia/Tokyo" }),
        headers: { "content-type": "application/json" },
      },
      env,
    );

    const saveResponse = await app.request(
      "/v1/diary/entry/save",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-1", date: "2026-02-07", body: "edited body" }),
        headers: { "content-type": "application/json" },
      },
      env,
    );

    expect(saveResponse.status).toBe(200);

    const getResponse = await app.request(
      "/v1/diary/entry/get",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-1", date: "2026-02-07" }),
        headers: { "content-type": "application/json" },
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

    const requestInit = {
      method: "POST",
      body: JSON.stringify({
        userId: "user-1",
        date: "2026-02-07",
        timezone: "Asia/Tokyo",
      }),
      headers: {
        "content-type": "application/json",
      },
    } as const;

    await app.request("/v1/future-diary/draft", requestInit, env);

    await app.request(
      "/v1/diary/entry/save",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-1", date: "2026-02-07", body: "edited body" }),
        headers: { "content-type": "application/json" },
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

    const draftResponse = await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-1", date: "2026-02-07", timezone: "Asia/Tokyo" }),
        headers: { "content-type": "application/json" },
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
        body: JSON.stringify({ userId: "user-1", date: "2026-02-07" }),
        headers: { "content-type": "application/json" },
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

    await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-1", date: "2026-02-07", timezone: "Asia/Tokyo" }),
        headers: { "content-type": "application/json" },
      },
      env,
    );

    await app.request(
      "/v1/future-diary/draft",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-1", date: "2026-02-06", timezone: "Asia/Tokyo" }),
        headers: { "content-type": "application/json" },
      },
      env,
    );

    const response = await app.request(
      "/v1/diary/entries/list",
      {
        method: "POST",
        body: JSON.stringify({ userId: "user-1", onOrBeforeDate: "2026-02-07", limit: 10 }),
        headers: { "content-type": "application/json" },
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
