import { describe, expect, test } from "bun:test";
import {
  buildFutureDiaryDraftLlmSystemPrompt,
  buildFutureDiaryDraftLlmUserPrompt,
  futureDiaryDraftBodyJsonSchema,
} from "./futureDiaryLlm";

describe("futureDiaryLlm", () => {
  test("buildFutureDiaryDraftLlmSystemPrompt returns constraints", () => {
    const prompt = buildFutureDiaryDraftLlmSystemPrompt();
    expect(prompt).toContain("未来日記");
    expect(prompt).toContain("断定しない");
  });

  test("buildFutureDiaryDraftLlmUserPrompt includes input context", () => {
    const prompt = buildFutureDiaryDraftLlmUserPrompt({
      date: "2026-02-07",
      userTimezone: "Asia/Tokyo",
      draftIntent: "落ち着いて始める",
      preferences: { avoidCopyingFromFragments: true },
      styleHints: {
        openingPhrases: ["今日は無理をせず、少しずつ整えていく一日にしたい。"],
        closingPhrases: ["夜に事実を追記して、確定日記にする。"],
        maxParagraphs: 2,
      },
      recentFragments: [{ id: "f1", date: "2026-02-06", relevance: 0.9, text: "朝に散歩した。" }],
    });

    expect(prompt).toContain("日付: 2026-02-07");
    expect(prompt).toContain("タイムゾーン: Asia/Tokyo");
    expect(prompt).toContain("id=f1");
    expect(prompt).toContain("maxParagraphs: 2");
    expect(prompt).toContain("avoidCopyingFromFragments");
  });

  test("futureDiaryDraftBodyJsonSchema requires body", () => {
    expect(futureDiaryDraftBodyJsonSchema.type).toBe("object");
    expect(futureDiaryDraftBodyJsonSchema.required).toEqual(["body"]);
  });
});
