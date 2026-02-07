import { describe, expect, test } from "bun:test";
import { app } from "./index";

describe("future-diary-api", () => {
  test("GET /health returns ok", async () => {
    const response = await app.request("/health");
    const json = (await response.json()) as { ok: boolean; service: string };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.service).toBe("future-diary-api");
  });

  test("POST /v1/future-diary/draft returns generated draft", async () => {
    const response = await app.request("/v1/future-diary/draft", {
      method: "POST",
      body: JSON.stringify({
        userId: "user-1",
        date: "2026-02-07",
        timezone: "Asia/Tokyo",
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    const json = (await response.json()) as { ok: boolean; draft?: { title: string } };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.draft?.title).toBe("2026-02-07 の未来日記");
  });
});
