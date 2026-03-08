import { describe, expect, test } from "bun:test";
import type { UserModel } from "./api";
import {
  applySimpleReflectionPromptDefaults,
  buildGenerationPromptPreview,
  simpleReflectionPromptDefaults,
} from "./reflection-prompt";

const createModel = (): UserModel => ({
  version: 1,
  intent: "",
  styleHints: {
    openingPhrases: [""],
    closingPhrases: [""],
    maxParagraphs: 2,
  },
  preferences: {
    avoidCopyingFromFragments: true,
  },
  reflection: {
    diaryCharacterization: "",
    writingStyle: "",
    inferredProfile: "実践知メモ",
    idealSelfImage: "",
    realityPlan: "",
  },
});

describe("reflection-prompt", () => {
  test("applySimpleReflectionPromptDefaults fills simple defaults", () => {
    const next = applySimpleReflectionPromptDefaults(createModel());
    expect(next.intent).toBe(simpleReflectionPromptDefaults.intent);
    expect(next.styleHints.openingPhrases[0]).toBe(simpleReflectionPromptDefaults.openingPhrase);
    expect(next.styleHints.closingPhrases[0]).toBe(simpleReflectionPromptDefaults.closingPhrase);
    expect(next.styleHints.maxParagraphs).toBe(simpleReflectionPromptDefaults.maxParagraphs);
    expect(next.reflection.writingStyle).toBe(simpleReflectionPromptDefaults.writingStyle);
  });

  test("buildGenerationPromptPreview renders full prompt sections", () => {
    const preview = buildGenerationPromptPreview(
      applySimpleReflectionPromptDefaults({
        ...createModel(),
        reflection: {
          ...createModel().reflection,
          inferredProfile: "夜に振り返ると改善が続きやすい。",
        },
      }),
    );
    expect(preview).toContain("未来日記（下書き）");
    expect(preview).toContain("自己モデル（SSOT）:");
    expect(preview).toContain("日記の目的:");
    expect(preview).toContain("日記の特徴(筆致):");
    expect(preview).toContain("当日の予定（Google Calendar連携）:");
  });
});
