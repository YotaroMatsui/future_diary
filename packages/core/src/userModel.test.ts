import { describe, expect, test } from "bun:test";
import {
  buildGenerationIntentFromUserModel,
  buildUserModelPromptContext,
  defaultStyleHints,
  defaultUserModel,
  parseUserModelInput,
  parseUserModelJson,
  serializeUserModelJson,
} from "./userModel";

describe("userModel", () => {
  test("parseUserModelJson returns default when empty", () => {
    const parsed = parseUserModelJson("{}");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value).toEqual(defaultUserModel);
  });

  test("parseUserModelJson returns error on invalid JSON", () => {
    const parsed = parseUserModelJson("{");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error.type).toBe("INVALID_JSON");
  });

  test("parseUserModelInput normalizes and applies defaults", () => {
    const parsed = parseUserModelInput({
      intent: "  仕事のペースを整える  ",
      styleHints: {
        openingPhrases: ["  今日は静かに始める。  "],
        closingPhrases: [],
        maxParagraphs: 3,
      },
      preferences: {
        avoidCopyingFromFragments: false,
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.intent).toBe("仕事のペースを整える");
    expect(parsed.value.styleHints.openingPhrases[0]).toBe("今日は静かに始める。");
    // closing is empty -> default is applied
    expect(parsed.value.styleHints.closingPhrases).toEqual(defaultStyleHints.closingPhrases);
    expect(parsed.value.styleHints.maxParagraphs).toBe(3);
    expect(parsed.value.preferences.avoidCopyingFromFragments).toBe(false);
    expect(parsed.value.reflection.idealSelfImage).toBe("");
  });

  test("serializeUserModelJson roundtrips", () => {
    const json = serializeUserModelJson(defaultUserModel);
    const parsed = parseUserModelJson(json);
    expect(parsed.ok).toBe(true);
  });

  test("buildGenerationIntentFromUserModel uses diary purpose", () => {
    const parsed = parseUserModelInput({
      intent: "落ち着いて進める",
      reflection: {
        idealSelfImage: "誠実で軽やかな自分",
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(buildGenerationIntentFromUserModel(parsed.value)).toBe("落ち着いて進める");
  });

  test("buildUserModelPromptContext uses simplified defaults", () => {
    const context = buildUserModelPromptContext(defaultUserModel);
    expect(context).toContain("日記の目的:");
    expect(context).toContain("日記の特徴(筆致):");
  });

  test("buildUserModelPromptContext includes purpose/style/knowledge", () => {
    const parsed = parseUserModelInput({
      intent: "予実を見える化する",
      reflection: {
        writingStyle: "箇条書き中心で短く書く",
        inferredProfile: "実行後の振り返りを1行残すと改善が進みやすい。",
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const context = buildUserModelPromptContext(parsed.value);
    expect(context).toContain("日記の目的:");
    expect(context).toContain("日記の特徴(筆致):");
    expect(context).toContain("日々の実践ナレッジ:");
  });
});
