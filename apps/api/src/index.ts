import { buildFutureDiaryDraft } from "@future-diary/core";
import { Hono } from "hono";
import { z } from "zod";

const draftRequestSchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).default("Asia/Tokyo"),
});

type WorkerBindings = {
  APP_ENV?: string;
};

const app = new Hono<{ Bindings: WorkerBindings }>();

app.get("/health", (context) =>
  context.json({
    ok: true,
    env: context.env?.APP_ENV ?? "development",
    service: "future-diary-api",
  }),
);

app.post("/v1/future-diary/draft", async (context) => {
  const payload = await context.req.json().catch(() => null);
  const parsed = draftRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return context.json(
      {
        ok: false,
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    );
  }

  const draftResult = buildFutureDiaryDraft({
    date: parsed.data.date,
    userTimezone: parsed.data.timezone,
    recentFragments: [
      {
        id: "fragment-1",
        date: parsed.data.date,
        relevance: 0.8,
        text: "朝は少し早く起きて、昨日より落ち着いて仕事に向き合えそうだ。",
      },
      {
        id: "fragment-2",
        date: parsed.data.date,
        relevance: 0.6,
        text: "夜は短い振り返りを書いて、できたことを一つだけ言葉にしたい。",
      },
    ],
    styleHints: {
      openingPhrases: ["今日は無理をせず、少しずつ整えていく一日にしたい。"],
      closingPhrases: ["夜に事実を追記して、確定日記にする。"],
      maxParagraphs: 2,
    },
  });

  if (!draftResult.ok) {
    return context.json(
      {
        ok: false,
        error: draftResult.error,
      },
      422,
    );
  }

  return context.json({
    ok: true,
    draft: draftResult.value,
    meta: {
      userId: parsed.data.userId,
    },
  });
});

export { app };

export default {
  fetch: app.fetch,
};
