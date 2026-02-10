import { describe, expect, test } from "bun:test";
import { buildFallbackFutureDiaryDraft, buildFutureDiaryDraft } from "./futureDiary";

describe("buildFutureDiaryDraft", () => {
  test("returns draft from ranked source fragments", () => {
    const result = buildFutureDiaryDraft({
      date: "2026-02-07",
      userTimezone: "Asia/Tokyo",
      draftIntent: "",
      preferences: { avoidCopyingFromFragments: true },
      styleHints: {
        openingPhrases: ["朝の段階で、今日は落ち着いて進める気配がある。"],
        closingPhrases: ["夜には事実ベースで追記して確定する。"],
        maxParagraphs: 2,
      },
      recentFragments: [
        { id: "f1", date: "2026-02-06", relevance: 0.9, text: "朝に散歩した。頭がすっきりした。" },
        { id: "f2", date: "2026-02-05", relevance: 0.4, text: "仕事でレビューが進んだ。" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.sourceFragmentIds).toEqual(["f1", "f2"]);
    expect(result.value.body).toContain("夜には事実ベースで追記して確定する。");
  });

  test("returns error when no source exists", () => {
    const result = buildFutureDiaryDraft({
      date: "2026-02-07",
      userTimezone: "Asia/Tokyo",
      draftIntent: "",
      preferences: { avoidCopyingFromFragments: true },
      styleHints: {
        openingPhrases: [],
        closingPhrases: [],
        maxParagraphs: 2,
      },
      recentFragments: [],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        type: "NO_SOURCE",
        message: "No eligible source fragments were found",
      },
    });
  });
});

describe("buildFallbackFutureDiaryDraft", () => {
  test("returns editable draft even when no source exists", () => {
    const draft = buildFallbackFutureDiaryDraft({
      date: "2026-02-07",
      draftIntent: "",
      styleHints: {
        openingPhrases: [],
        closingPhrases: [],
        maxParagraphs: 2,
      },
    });

    expect(draft.title).toBe("2026-02-07 の未来日記");
    expect(draft.sourceFragmentIds).toEqual([]);
    expect(draft.body).toContain("（ここに、今日の予定・やりたいこと・気づきを追記する）");
  });
});
