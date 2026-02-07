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
});
